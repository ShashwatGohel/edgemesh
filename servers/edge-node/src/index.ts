import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import pino from 'pino';
import Redis from 'ioredis';

// ── Types ─────────────────────────────────────────────────────────────────────
interface EdgeNodeConfig {
  id: string; name: string; region: string;
  lat: number; lng: number; port: number;
  baseUrl: string; redisUrl: string;
}
interface NodeHeartbeat {
  nodeId: string; name: string; region: string;
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  loadPercentage: number; redisMemoryUsedMb: number;
  storageUsedBytes: number; activeConnections: number;
  cacheHitCount: number; cacheMissCount: number;
  lastHeartbeatTimestamp: number;
}
interface StepLogEvent {
  id: string; requestId?: string; timestamp: number;
  service: string; stepNumber?: number;
  title: string; details: string;
  level: 'info' | 'warn' | 'error' | 'success';
  metadata?: Record<string, unknown>;
}

// ── Mock Redis Client for Standalone Dev Cache L1 Simulation ────────────────
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
    let expiry = 0;
    if (mode === 'EX' && duration) {
      expiry = Date.now() + duration * 1000;
    }
    this.store.set(key, { value, expiry });
    return 'OK';
  }
  async keys(_pattern: string): Promise<string[]> {
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
  async type(_key: string): Promise<string> {
    return 'string';
  }
}

// ── Config from environment variables ─────────────────────────────────────────
const NODE_ID   = (process.env.NODE_ID   || 'edge-mumbai').trim();
const NODE_NAME = (process.env.NODE_NAME || 'Edge Mumbai').trim();
const REGION    = (process.env.REGION    || 'Mumbai, India').trim();
const LATITUDE  = parseFloat((process.env.LATITUDE  || '19.0760').trim());
const LONGITUDE = parseFloat((process.env.LONGITUDE || '72.8777').trim());
const PORT      = parseInt((process.env.PORT || '4001').trim(), 10);
const BASE_URL  = (process.env.BASE_URL  || `http://localhost:${PORT}`).trim();
const REDIS_URL    = (process.env.REDIS_URL    || 'redis://localhost:6379').trim();
const ORIGIN_URL   = (process.env.ORIGIN_URL   || 'http://localhost:5000').trim();
const REGISTRY_URL = (process.env.REGISTRY_URL || 'http://localhost:3002').trim();

// ── Redis Client (real ioredis -> falls back to MockRedis) ────────────────────
let redisClient: MockRedis | InstanceType<typeof Redis> = new MockRedis();
let usingRealRedis = false;

async function initRedis(): Promise<void> {
  const realRedis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    lazyConnect: true,
    retryStrategy: (times) => (times > 2 ? null : Math.min(times * 500, 1000)),
  });

  try {
    await realRedis.connect();
    redisClient = realRedis;
    usingRealRedis = true;
    console.log(`  Redis             : ${REDIS_URL} [REAL]`);
  } catch {
    realRedis.disconnect();
    console.log(`  Redis             : Unavailable -- using MockRedis [MOCK]`);
  }

  realRedis.on('error', () => {
    if (usingRealRedis) {
      usingRealRedis = false;
      redisClient = new MockRedis();
      console.log(`  Redis             : Lost connection -- switched to MockRedis [MOCK]`);
    }
  });
}

const logger = pino({ name: `edge-node-${NODE_ID}`, level: 'info' });
const app    = express();

// ── Local Disk Cache Storage ───────────────────────────────────────────────────
const STORAGE_DIR = path.resolve(process.cwd(), 'storage', NODE_ID);
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// ── Metrics State ─────────────────────────────────────────────────────────────
let cacheHitCount   = 0;
let cacheMissCount  = 0;
let activeConnections = 0;

app.use(cors({
  origin: '*',
  exposedHeaders: ['X-Cache', 'X-Edge-Node-ID', 'X-Response-Time-Ms', 'X-Distance-Km', 'X-Selected-Node-Name', 'X-Selected-Node-ID', 'X-Request-ID']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Track active connections middleware
app.use((_req, res, next) => {
  activeConnections++;
  res.on('finish', () => {
    activeConnections = Math.max(0, activeConnections - 1);
  });
  next();
});

// Helper to broadcast step logs to Service Registry
async function emitStepLog(
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
    title: `[${NODE_NAME}] ${title}`,
    details,
    level,
    metadata: { nodeId: NODE_ID, region: REGION },
  };
  try {
    await axios.post(`${REGISTRY_URL}/api/logs/emit`, logEvent, { timeout: 1000 });
  } catch {
    // Ignore logging failures if registry is offline
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.json({
    status: 'UP',
    nodeId: NODE_ID,
    name: NODE_NAME,
    region: REGION,
    description: 'EdgeMesh Edge Node server',
    endpoints: {
      health: '/health',
      files: '/api/files',
      redisKeys: '/api/redis/keys'
    }
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'UP',
    nodeId: NODE_ID,
    name: NODE_NAME,
    region: REGION,
    redisConnected: redisClient.status === 'ready',
  });
});

// GET /api/files — local storage listing
app.get('/api/files', (_req, res) => {
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

// GET /api/redis/keys — Redis L1 keys listing (for Admin Dashboard)
app.get('/api/redis/keys', async (_req, res) => {
  if (!redisClient || redisClient.status !== 'ready') {
    return res.json({ keys: [], count: 0, status: 'REDIS_DISCONNECTED' });
  }
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
    res.status(500).json({ error: 'Failed to inspect Redis keys' });
  }
});

// Proactive File Broadcast / Pre-warm API (triggered by Origin server on upload)
app.post('/api/files/broadcast', async (req, res) => {
  try {
    const { fileId, originalName, mimeType, fileBase64, requestId } = req.body;
    if (!fileId || !fileBase64) {
      return res.status(400).json({ error: 'fileId and fileBase64 are required' });
    }

    const fileBuffer = Buffer.from(fileBase64, 'base64');
    const ext = path.extname(originalName || '') || '.bin';
    const diskPath = path.join(STORAGE_DIR, `${fileId}${ext}`);

    // Save to Level 2 Local Disk Storage
    fs.writeFileSync(diskPath, fileBuffer);

    // Save to Level 1 Redis Cache
    const redisKey = `file:${fileId}`;
    const redisMetaKey = `file:meta:${fileId}`;
    if (redisClient && redisClient.status === 'ready') {
      await redisClient.set(redisKey, fileBase64, 'EX', 300);
      await redisClient.set(redisMetaKey, JSON.stringify({ fileId, originalName, mimeType: mimeType || 'application/octet-stream' }), 'EX', 300);
    }

    logger.info({ fileId, nodeId: NODE_ID }, '⚡ Broadcasted file received and pre-warmed in L2 Disk & L1 Redis');

    await emitStepLog(
      requestId,
      0,
      'Proactive Broadcast Received',
      `Edge Node '${NODE_NAME}' received broadcast for '${originalName || fileId}'. Pre-warmed into L2 Disk & L1 Redis.`,
      'success'
    );

    res.json({ success: true, nodeId: NODE_ID, message: 'File pre-warmed successfully' });
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Failed to process file broadcast');
    res.status(500).json({ error: 'Failed to process file broadcast' });
  }
});

// Main Waterfall Cache File Fetch API
app.get('/files/:fileId', async (req, res) => {
  const { fileId } = req.params;
  const requestId = (req.headers['x-request-id'] as string) || (req.query.gatewayRequestId as string) || undefined;
  const startTime = Date.now();

  // Set metrics headers if redirect occurred
  const distanceKm = req.query.distanceKm as string;
  const selectedNodeName = req.query.selectedNodeName as string;
  if (distanceKm) res.setHeader('X-Distance-Km', distanceKm);
  if (selectedNodeName) {
    res.setHeader('X-Selected-Node-Name', selectedNodeName);
    res.setHeader('X-Selected-Node-ID', NODE_ID);
  }
  if (requestId) res.setHeader('X-Request-ID', requestId);

  logger.info({ fileId, requestId }, 'Received file request at Edge Node');

  // STEP 1: Level 1 Redis Cache Check
  const redisKey = `file:${fileId}`;
  const redisMetaKey = `file:meta:${fileId}`;

  if (redisClient && redisClient.status === 'ready') {
    try {
      const cachedBase64 = await redisClient.get(redisKey);
      const cachedMetaJson = await redisClient.get(redisMetaKey);

      if (cachedBase64 && cachedMetaJson) {
        cacheHitCount++;
        const meta = JSON.parse(cachedMetaJson);
        const fileBuffer = Buffer.from(cachedBase64, 'base64');
        const latencyMs = Date.now() - startTime;

        logger.info({ fileId, latencyMs }, '[HIT] Level 1 REDIS CACHE HIT');

        await emitStepLog(
          requestId, 4,
          'Level 1 Redis Cache HIT',
          `Found cached file '${meta.originalName}' in Redis. Serving directly to client (${latencyMs}ms).`,
          'success'
        );

        res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
        res.setHeader('X-Cache', 'HIT-REDIS');
        res.setHeader('X-Edge-Node-ID', NODE_ID);
        res.setHeader('X-Response-Time-Ms', latencyMs.toString());
        return res.send(fileBuffer);
      }
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Error checking Redis cache');
    }
  }

  await emitStepLog(
    requestId, 4,
    'Level 1 Redis Cache MISS',
    `Key '${redisKey}' not found in Redis cache. Checking Level 2 Local Disk Storage...`,
    'warn'
  );

  // STEP 2: Level 2 Local Disk Storage Check
  const filesOnDisk = fs.readdirSync(STORAGE_DIR);
  const matchedDiskFile = filesOnDisk.find((f) => path.parse(f).name === fileId);

  if (matchedDiskFile) {
    try {
      cacheHitCount++;
      const filePath = path.join(STORAGE_DIR, matchedDiskFile);
      const fileBuffer = fs.readFileSync(filePath);
      const latencyMs = Date.now() - startTime;

      logger.info({ fileId, latencyMs }, '[HIT] Level 2 DISK CACHE HIT');

      await emitStepLog(
        requestId, 5,
        'Level 2 Local Disk HIT',
        `Found file '${matchedDiskFile}' on Local Disk. Writing back to Redis L1 cache and serving client (${latencyMs}ms).`,
        'success'
      );

      // Asynchronously store back in Redis L1 Cache
      if (redisClient && redisClient.status === 'ready') {
        const mimeType = 'application/octet-stream';
        redisClient.set(redisKey, fileBuffer.toString('base64'), 'EX', 300);
        redisClient.set(redisMetaKey, JSON.stringify({ fileId, originalName: matchedDiskFile, mimeType }), 'EX', 300);
      }

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-Cache', 'HIT-DISK');
      res.setHeader('X-Edge-Node-ID', NODE_ID);
      res.setHeader('X-Response-Time-Ms', latencyMs.toString());
      return res.send(fileBuffer);
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Error reading local disk cache');
    }
  }

  await emitStepLog(
    requestId, 5,
    'Level 2 Local Disk MISS',
    `File '${fileId}' not cached on Local Disk. Fetching from Origin Server at ${ORIGIN_URL}...`,
    'warn'
  );

  // STEP 3: Level 3 Cache Miss -> Fetch from Origin Server
  try {
    const originResponse = await axios.get(`${ORIGIN_URL}/api/files/${fileId}`, {
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

    // Save file to L2 Local Disk Storage
    const diskPath = path.join(STORAGE_DIR, `${fileId}${path.extname(originalName) || '.bin'}`);
    fs.writeFileSync(diskPath, fileBuffer);

    // Save file to L1 Redis Cache
    if (redisClient && redisClient.status === 'ready') {
      await redisClient.set(redisKey, fileBuffer.toString('base64'), 'EX', 300);
      await redisClient.set(redisMetaKey, JSON.stringify({ fileId, originalName, mimeType }), 'EX', 300);
    }

    const latencyMs = Date.now() - startTime;
    logger.info({ fileId, latencyMs }, '[ORIGIN] Fetch success - Saved to Disk & Redis Cache');

    await emitStepLog(
      requestId, 6,
      'Origin Fetch Completed',
      `Fetched file '${originalName}' from Origin Server (${fileBuffer.length} bytes). Cached into L2 Disk & L1 Redis.`,
      'success'
    );

    res.setHeader('Content-Type', mimeType);
    res.setHeader('X-Cache', 'MISS-FETCHED-FROM-ORIGIN');
    res.setHeader('X-Edge-Node-ID', NODE_ID);
    res.setHeader('X-Response-Time-Ms', latencyMs.toString());
    return res.send(fileBuffer);
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    logger.error({ fileId, error: (err as Error).message }, 'Failed to fetch file from Origin');

    await emitStepLog(
      requestId, 6,
      'Origin Fetch Failed',
      `Could not retrieve file '${fileId}' from Origin Server: ${(err as Error).message}`,
      'error'
    );

    return res.status(404).json({
      error: `File not found on Edge Node cache nor Origin Server`,
      nodeId: NODE_ID,
      latencyMs,
    });
  }
});

// ── Disk Storage Stats ────────────────────────────────────────────────────────
function getStorageUsageBytes(): number {
  try {
    return fs.readdirSync(STORAGE_DIR).reduce((total, f) => {
      const stat = fs.statSync(path.join(STORAGE_DIR, f));
      return total + (stat.isFile() ? stat.size : 0);
    }, 0);
  } catch {
    return 0;
  }
}

// ── Registry: Register + Heartbeat ───────────────────────────────────────────
async function registerWithRegistry() {
  const config: EdgeNodeConfig = {
    id: NODE_ID, name: NODE_NAME, region: REGION,
    lat: LATITUDE, lng: LONGITUDE, port: PORT,
    baseUrl: BASE_URL, redisUrl: '',
  };
  try {
    await axios.post(`${REGISTRY_URL}/api/nodes/register`, config);
    logger.info({ registryUrl: REGISTRY_URL }, 'Registered with Service Registry');
  } catch (err) {
    logger.warn({ error: (err as Error).message }, 'Could not register — will retry via heartbeats');
  }
}

async function sendHeartbeat() {
  const loadPercentage = activeConnections === 0 ? 0 : Math.min(100, Math.round(activeConnections * 15 + Math.random() * 5));
  const heartbeat: NodeHeartbeat = {
    nodeId: NODE_ID, name: NODE_NAME, region: REGION,
    status: loadPercentage > 90 ? 'DEGRADED' : 'HEALTHY',
    loadPercentage,
    redisMemoryUsedMb: 0,
    storageUsedBytes: getStorageUsageBytes(),
    activeConnections,
    cacheHitCount,
    cacheMissCount,
    lastHeartbeatTimestamp: Date.now(),
  };
  try {
    await axios.post(`${REGISTRY_URL}/api/nodes/heartbeat`, heartbeat);
  } catch (err: any) {
    // If registry says node not registered (404), auto re-register
    if (err?.response?.status === 404) {
      logger.warn({ nodeId: NODE_ID }, 'Node not registered in registry — re-registering...');
      await registerWithRegistry();
    }
    // All other errors (network, etc.) silently ignored
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Try to connect to real Redis
  await initRedis();

  // 2. Start the HTTP server
  app.listen(PORT, async () => {
    logger.info({ nodeId: NODE_ID, region: REGION, port: PORT }, '[EDGE-NODE] Started successfully');
    console.log(`\n  EdgeMesh Edge Node | ${NODE_NAME} | ${REGION}`);
    console.log(`  Listening on       : http://localhost:${PORT}`);
    console.log(`  Origin Server      : ${ORIGIN_URL}`);
    console.log(`  Service Registry   : ${REGISTRY_URL}`);
    console.log(`  Storage Dir        : ${STORAGE_DIR}`);
    console.log(`  Redis Mode         : ${usingRealRedis ? '[REAL] ' + REDIS_URL : '[MOCK] In-memory'}\n`);
    await registerWithRegistry();
    setInterval(sendHeartbeat, 3000);
  });
}

main().catch((err) => {
  console.error('[EDGE-NODE] Fatal startup error:', err);
  process.exit(1);
});
