import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { Server as SocketIOServer } from 'socket.io';
import { createLogger, calculateHaversineDistance, EdgeNodeConfig, NodeHeartbeat, StepLogEvent } from './shared';

// Import sub-app routers
import { createOriginRouter } from './origin';
import { createRegistryRouter } from './registry';
import { createRoutingRouter } from './routing';
import { createGatewayRouter } from './gateway';

const logger = createLogger('unified-monolith');

// ── Mock Redis for Unified Edge Nodes ───────────────────────────────────────
class MockRedis {
  private store = new Map<string, { value: string; expiry: number }>();
  public status = 'ready';

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiry && item.expiry < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: string, mode?: string, duration?: number): Promise<string> {
    let expiry = mode === 'EX' && duration ? Date.now() + duration * 1000 : 0;
    this.store.set(key, { value, expiry });
    return 'OK';
  }

  async keys(pattern: string): Promise<string[]> {
    const now = Date.now();
    const result: string[] = [];
    for (const [key, item] of this.store.entries()) {
      if (item.expiry && item.expiry < now) {
        this.store.delete(key);
        continue;
      }
      result.push(key);
    }
    return result;
  }

  async ttl(key: string): Promise<number> {
    const item = this.store.get(key);
    if (!item) return -2;
    if (item.expiry === 0) return -1;
    const remaining = Math.round((item.expiry - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
  }

  async type(key: string): Promise<string> {
    return 'string';
  }
}

// ── Edge Node Router Creator ────────────────────────────────────────────────
function createEdgeNodeRouter(config: EdgeNodeConfig, registryUrl: string, originUrl: string) {
  const nodeApp = express();
  const redisClient = new MockRedis();
  const STORAGE_DIR = path.resolve(process.cwd(), 'storage', config.id);

  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }

  let cacheHitCount = 0;
  let cacheMissCount = 0;
  let activeConnections = 0;

  nodeApp.use(cors({
    origin: '*',
    exposedHeaders: ['X-Cache', 'X-Edge-Node-ID', 'X-Response-Time-Ms', 'X-Distance-Km', 'X-Selected-Node-Name', 'X-Selected-Node-ID', 'X-Request-ID']
  }));
  nodeApp.use(express.json());

  nodeApp.use((req, res, next) => {
    activeConnections++;
    res.on('finish', () => {
      activeConnections = Math.max(0, activeConnections - 1);
    });
    next();
  });

  async function emitNodeStepLog(
    requestId: string | undefined,
    stepNumber: number,
    title: string,
    details: string,
    level: 'info' | 'warn' | 'error' | 'success' = 'info'
  ) {
    const logEvent: StepLogEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      requestId,
      timestamp: Date.now(),
      service: 'EDGE-NODE',
      stepNumber,
      title: `[${config.name}] ${title}`,
      details,
      level,
      metadata: { nodeId: config.id, region: config.region },
    };
    try {
      await axios.post(`${registryUrl}/api/logs/emit`, logEvent, { timeout: 1000 });
    } catch {}
  }

  nodeApp.get('/health', (_req, res) => {
    res.json({
      status: 'UP',
      nodeId: config.id,
      name: config.name,
      region: config.region,
      redisConnected: true,
    });
  });

  nodeApp.get('/api/files', (_req, res) => {
    try {
      const files = fs.readdirSync(STORAGE_DIR).map(f => {
        const stat = fs.statSync(path.join(STORAGE_DIR, f));
        return { name: f, sizeBytes: stat.size, createdAt: stat.birthtime };
      });
      res.json({ files });
    } catch {
      res.status(500).json({ error: 'Failed to read local files' });
    }
  });

  nodeApp.get('/api/redis/keys', async (_req, res) => {
    try {
      const keys = await redisClient.keys('*');
      const result = [];
      for (const key of keys) {
        const ttl = await redisClient.ttl(key);
        const type = await redisClient.type(key);
        result.push({ key, ttl, type });
      }
      res.json({ keys: result, count: result.length, status: 'CONNECTED' });
    } catch {
      res.status(500).json({ error: 'Failed to inspect Redis' });
    }
  });

  nodeApp.post('/api/files/broadcast', async (req, res) => {
    try {
      const { fileId, originalName, mimeType, fileBase64, requestId } = req.body;
      if (!fileId || !fileBase64) {
        return res.status(400).json({ error: 'fileId and fileBase64 required' });
      }
      const fileBuffer = Buffer.from(fileBase64, 'base64');
      const ext = path.extname(originalName || '') || '.bin';
      const diskPath = path.join(STORAGE_DIR, `${fileId}${ext}`);

      fs.writeFileSync(diskPath, fileBuffer);
      await redisClient.set(`file:${fileId}`, fileBase64, 'EX', 300);
      await redisClient.set(`file:meta:${fileId}`, JSON.stringify({ fileId, originalName, mimeType: mimeType || 'application/octet-stream' }), 'EX', 300);

      await emitNodeStepLog(
        requestId,
        0,
        'Proactive Broadcast Received',
        `Edge Node '${config.name}' received broadcast for '${originalName || fileId}'. Pre-warmed into L2 Disk & L1 Redis.`,
        'success'
      );
      res.json({ success: true, nodeId: config.id });
    } catch (err) {
      res.status(500).json({ error: 'Failed to process broadcast' });
    }
  });

  nodeApp.get('/files/:fileId', async (req, res) => {
    const { fileId } = req.params;
    const requestId = (req.headers['x-request-id'] as string) || (req.query.gatewayRequestId as string) || undefined;
    const startTime = Date.now();

    const distanceKm = req.query.distanceKm as string;
    const selectedNodeName = req.query.selectedNodeName as string;
    if (distanceKm) res.setHeader('X-Distance-Km', distanceKm);
    if (selectedNodeName) {
      res.setHeader('X-Selected-Node-Name', selectedNodeName);
      res.setHeader('X-Selected-Node-ID', config.id);
    }
    if (requestId) res.setHeader('X-Request-ID', requestId);

    // L1 Cache Check
    const redisKey = `file:${fileId}`;
    const redisMetaKey = `file:meta:${fileId}`;
    const cachedBase64 = await redisClient.get(redisKey);
    const cachedMetaJson = await redisClient.get(redisMetaKey);

    if (cachedBase64 && cachedMetaJson) {
      cacheHitCount++;
      const meta = JSON.parse(cachedMetaJson);
      const fileBuffer = Buffer.from(cachedBase64, 'base64');
      const latencyMs = Date.now() - startTime;

      await emitNodeStepLog(
        requestId,
        4,
        'Level 1 Redis Cache HIT',
        `Found cached file '${meta.originalName}' in Redis. Serving directly to client (${latencyMs}ms).`,
        'success'
      );
      res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
      res.setHeader('X-Cache', 'HIT-REDIS');
      res.setHeader('X-Edge-Node-ID', config.id);
      res.setHeader('X-Response-Time-Ms', latencyMs.toString());
      return res.send(fileBuffer);
    }

    await emitNodeStepLog(
      requestId,
      4,
      'Level 1 Redis Cache MISS',
      `Key '${redisKey}' not found in Redis cache. Checking Level 2 Local Disk Storage...`,
      'warn'
    );

    // L2 Cache Check
    const filesOnDisk = fs.existsSync(STORAGE_DIR) ? fs.readdirSync(STORAGE_DIR) : [];
    const matchedDiskFile = filesOnDisk.find((f) => path.parse(f).name === fileId);

    if (matchedDiskFile) {
      try {
        cacheHitCount++;
        const filePath = path.join(STORAGE_DIR, matchedDiskFile);
        const fileBuffer = fs.readFileSync(filePath);
        const latencyMs = Date.now() - startTime;

        await emitNodeStepLog(
          requestId,
          5,
          'Level 2 Local Disk HIT',
          `Found file '${matchedDiskFile}' on Local Disk. Writing back to Redis L1 cache and serving client (${latencyMs}ms).`,
          'success'
        );

        await redisClient.set(redisKey, fileBuffer.toString('base64'), 'EX', 300);
        await redisClient.set(redisMetaKey, JSON.stringify({ fileId, originalName: matchedDiskFile, mimeType: 'application/octet-stream' }), 'EX', 300);

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('X-Cache', 'HIT-DISK');
        res.setHeader('X-Edge-Node-ID', config.id);
        res.setHeader('X-Response-Time-Ms', latencyMs.toString());
        return res.send(fileBuffer);
      } catch {}
    }

    // L3 Cache Miss -> Fetch from Origin
    await emitNodeStepLog(
      requestId,
      5,
      'Level 2 Local Disk MISS',
      `File '${fileId}' not cached on Local Disk. Fetching from Origin Server at ${originUrl}...`,
      'warn'
    );

    try {
      const originResponse = await axios.get(`${originUrl}/api/files/${fileId}`, {
        responseType: 'arraybuffer',
        timeout: 5000,
      });

      cacheMissCount++;
      const fileBuffer = Buffer.from(originResponse.data);
      const rawMime = originResponse.headers['content-type'];
      const mimeType = typeof rawMime === 'string' ? rawMime : 'application/octet-stream';
      const rawDisp = originResponse.headers['content-disposition'];
      const dispStr = typeof rawDisp === 'string' ? rawDisp : '';
      const originalName = dispStr.split('filename=')[1]?.replace(/"/g, '') || `${fileId}.bin`;

      const diskPath = path.join(STORAGE_DIR, `${fileId}${path.extname(originalName) || '.bin'}`);
      fs.writeFileSync(diskPath, fileBuffer);

      await redisClient.set(redisKey, fileBuffer.toString('base64'), 'EX', 300);
      await redisClient.set(redisMetaKey, JSON.stringify({ fileId, originalName, mimeType }), 'EX', 300);

      const latencyMs = Date.now() - startTime;
      await emitNodeStepLog(
        requestId,
        6,
        'Origin Fetch Completed',
        `Fetched file '${originalName}' from Origin Server. Cached into L2 Disk & L1 Redis.`,
        'success'
      );

      res.setHeader('Content-Type', mimeType);
      res.setHeader('X-Cache', 'MISS-FETCHED-FROM-ORIGIN');
      res.setHeader('X-Edge-Node-ID', config.id);
      res.setHeader('X-Response-Time-Ms', latencyMs.toString());
      return res.send(fileBuffer);
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      await emitNodeStepLog(
        requestId,
        6,
        'Origin Fetch Failed',
        `Could not retrieve file '${fileId}' from Origin: ${(err as Error).message}`,
        'error'
      );
      res.status(404).json({ error: 'File not found on cache or Origin', nodeId: config.id, latencyMs });
    }
  });

  // Loop heartbeat
  async function sendHeartbeat() {
    function getStorageUsageBytes(): number {
      try {
        const files = fs.readdirSync(STORAGE_DIR);
        let total = 0;
        for (const f of files) {
          const stat = fs.statSync(path.join(STORAGE_DIR, f));
          if (stat.isFile()) total += stat.size;
        }
        return total;
      } catch { return 0; }
    }

    const heartbeat: NodeHeartbeat = {
      nodeId: config.id,
      name: config.name,
      region: config.region,
      status: 'HEALTHY',
      loadPercentage: Math.round(activeConnections * 10),
      redisMemoryUsedMb: 0,
      storageUsedBytes: getStorageUsageBytes(),
      activeConnections,
      cacheHitCount,
      cacheMissCount,
      lastHeartbeatTimestamp: Date.now(),
    };

    try {
      await axios.post(`${registryUrl}/api/nodes/heartbeat`, heartbeat, { timeout: 1000 });
    } catch {}
  }

  async function register() {
    try {
      await axios.post(`${registryUrl}/api/nodes/register`, config, { timeout: 1000 });
    } catch {}
  }

  // Register and start heartbeats
  setTimeout(async () => {
    await register();
    setInterval(sendHeartbeat, 3000);
  }, 1000);

  return nodeApp;
}

// ── Unified Launcher ────────────────────────────────────────────────────────
export function startUnifiedServer(port: number, publicBackendUrl?: string) {
  const expressApp = express();
  const server = http.createServer(expressApp);
  const io = new SocketIOServer(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  const localHostUrl = `http://localhost:${port}`;
  const registryUrl = `${localHostUrl}/registry`;
  const routingUrl = `${localHostUrl}/routing`;
  const originUrl = `${localHostUrl}/origin`;

  // Mount primary subsystems
  expressApp.use('/registry', createRegistryRouter(io));
  expressApp.use('/routing', createRoutingRouter(registryUrl));
  expressApp.use('/origin', createOriginRouter());
  expressApp.use('/gateway', createGatewayRouter(routingUrl, originUrl, registryUrl));

  // Mount 8 Edge Nodes
  const edgeNodesConfig: EdgeNodeConfig[] = [
    { id: 'edge-mumbai', name: 'Edge Mumbai', region: 'Mumbai, India', lat: 19.0760, lng: 72.8777, port: 4001, baseUrl: `${publicBackendUrl || localHostUrl}/edge/edge-mumbai`, redisUrl: '' },
    { id: 'edge-delhi', name: 'Edge Delhi', region: 'Delhi, India', lat: 28.7041, lng: 77.1025, port: 4002, baseUrl: `${publicBackendUrl || localHostUrl}/edge/edge-delhi`, redisUrl: '' },
    { id: 'edge-singapore', name: 'Edge Singapore', region: 'Singapore', lat: 1.3521, lng: 103.8198, port: 4003, baseUrl: `${publicBackendUrl || localHostUrl}/edge/edge-singapore`, redisUrl: '' },
    { id: 'edge-london', name: 'Edge London', region: 'London, UK', lat: 51.5074, lng: -0.1278, port: 4004, baseUrl: `${publicBackendUrl || localHostUrl}/edge/edge-london`, redisUrl: '' },
    { id: 'edge-frankfurt', name: 'Edge Frankfurt', region: 'Frankfurt, Germany', lat: 50.1109, lng: 8.6821, port: 4005, baseUrl: `${publicBackendUrl || localHostUrl}/edge/edge-frankfurt`, redisUrl: '' },
    { id: 'edge-newyork', name: 'Edge New York', region: 'New York, USA', lat: 40.7128, lng: -74.0060, port: 4006, baseUrl: `${publicBackendUrl || localHostUrl}/edge/edge-newyork`, redisUrl: '' },
    { id: 'edge-tokyo', name: 'Edge Tokyo', region: 'Tokyo, Japan', lat: 35.6762, lng: 139.6503, port: 4007, baseUrl: `${publicBackendUrl || localHostUrl}/edge/edge-tokyo`, redisUrl: '' },
    { id: 'edge-sydney', name: 'Edge Sydney', region: 'Sydney, Australia', lat: -33.8688, lng: 151.2093, port: 4008, baseUrl: `${publicBackendUrl || localHostUrl}/edge/edge-sydney`, redisUrl: '' },
  ];

  edgeNodesConfig.forEach(nodeConfig => {
    expressApp.use(`/edge/${nodeConfig.id}`, createEdgeNodeRouter(nodeConfig, registryUrl, originUrl));
  });

  server.listen(port, () => {
    logger.info({ port }, '🚀 EdgeMesh UNIFIED Monolith Server running on a single port');
    console.log(`\n======================================================`);
    console.log(`  EdgeMesh UNIFIED MONOLITH`);
    console.log(`======================================================`);
    console.log(`  Unified Port      → ${port}`);
    console.log(`  Public Backend    → ${publicBackendUrl || 'Not specified (localhost fallback)'}`);
    console.log(`======================================================\n`);
  });
}
