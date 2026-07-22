import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createLogger, EdgeNodeConfig, NodeHeartbeat, NodeStatus, StepLogEvent } from './shared';

const logger = createLogger('service-registry');

// In-memory registry maps
const registeredNodes = new Map<string, EdgeNodeConfig>();
const nodeHeartbeats = new Map<string, NodeHeartbeat>();

// Health TTL Check Interval (10 seconds timeout)
const TTL_TIMEOUT_MS = 10000;

export function createRegistryRouter(io: SocketIOServer) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // TTL check: mark nodes UNHEALTHY if they miss heartbeats
  setInterval(() => {
    const now = Date.now();
    for (const [nodeId, heartbeat] of nodeHeartbeats.entries()) {
      if (now - heartbeat.lastHeartbeatTimestamp > TTL_TIMEOUT_MS && heartbeat.status !== 'UNHEALTHY') {
        heartbeat.status = 'UNHEALTHY';
        logger.warn({ nodeId, name: heartbeat.name }, 'Node missed heartbeats. Marking UNHEALTHY');

        const logEvent: StepLogEvent = {
          id: 'evt_' + Date.now(),
          timestamp: Date.now(),
          service: 'REGISTRY',
          title: 'Node Status Degraded',
          details: `Edge Node '${heartbeat.name}' (${nodeId}) stopped sending heartbeats. Marked UNHEALTHY.`,
          level: 'warn',
        };

        io.emit('node_status_change', heartbeat);
        io.emit('step_log', logEvent);
      }
    }
  }, 3000);

  // Registry health state on Socket.IO connect
  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Dashboard / Listener connected via Socket.IO');
    socket.emit('registry_state', {
      nodes: Array.from(registeredNodes.values()),
      heartbeats: Array.from(nodeHeartbeats.values()),
    });
  });

  app.get('/health', (_req, res) =>
    res.json({ status: 'UP', service: 'service-registry', registeredCount: registeredNodes.size })
  );

  app.get('/', (_req, res) => {
    res.json({
      status: 'UP',
      service: 'service-registry',
      description: 'EdgeMesh CDN Service Discovery Registry',
      endpoints: {
        health: '/health',
        register: '/api/nodes/register',
        heartbeat: '/api/nodes/heartbeat',
        healthyNodes: '/api/nodes/healthy',
        allNodes: '/api/nodes'
      }
    });
  });

  app.post('/api/nodes/register', (req, res) => {
    const nodeConfig: EdgeNodeConfig = req.body;
    if (!nodeConfig.id || !nodeConfig.baseUrl)
      return res.status(400).json({ error: 'Missing required node parameters (id, baseUrl)' });

    registeredNodes.set(nodeConfig.id, nodeConfig);

    if (!nodeHeartbeats.has(nodeConfig.id)) {
      nodeHeartbeats.set(nodeConfig.id, {
        nodeId: nodeConfig.id,
        name: nodeConfig.name || nodeConfig.id,
        region: nodeConfig.region || 'Unknown',
        status: 'HEALTHY',
        loadPercentage: 0,
        redisMemoryUsedMb: 0,
        storageUsedBytes: 0,
        activeConnections: 0,
        cacheHitCount: 0,
        cacheMissCount: 0,
        lastHeartbeatTimestamp: Date.now(),
      });
    }

    logger.info({ nodeId: nodeConfig.id, name: nodeConfig.name }, 'Registered Edge Node successfully');

    const logEvent: StepLogEvent = {
      id: 'evt_' + Date.now(),
      timestamp: Date.now(),
      service: 'REGISTRY',
      title: 'New Edge Node Registered',
      details: `Edge Node '${nodeConfig.name}' registered at ${nodeConfig.baseUrl}`,
      level: 'info',
    };

    io.emit('node_registered', { config: nodeConfig, heartbeat: nodeHeartbeats.get(nodeConfig.id) });
    io.emit('step_log', logEvent);

    res.status(201).json({ message: 'Node registered', node: nodeConfig });
  });

  app.post('/api/nodes/heartbeat', (req, res) => {
    const heartbeat: NodeHeartbeat = req.body;
    if (!heartbeat.nodeId)
      return res.status(400).json({ error: 'Missing nodeId in heartbeat payload' });

    const existingConfig = registeredNodes.get(heartbeat.nodeId);
    if (!existingConfig)
      return res.status(404).json({ error: 'Node not registered. Register node first.' });

    heartbeat.lastHeartbeatTimestamp = Date.now();
    heartbeat.status = heartbeat.loadPercentage > 90 ? 'DEGRADED' : 'HEALTHY';
    nodeHeartbeats.set(heartbeat.nodeId, heartbeat);

    io.emit('node_heartbeat', heartbeat);
    res.json({ status: 'ACK', timestamp: heartbeat.lastHeartbeatTimestamp });
  });

  app.get('/api/nodes/healthy', (_req, res) => {
    const healthyList: Array<{ config: EdgeNodeConfig; heartbeat: NodeHeartbeat }> = [];
    for (const [nodeId, config] of registeredNodes.entries()) {
      const hb = nodeHeartbeats.get(nodeId);
      if (hb && hb.status !== 'UNHEALTHY') {
        healthyList.push({ config, heartbeat: hb });
      }
    }
    res.json({ count: healthyList.length, nodes: healthyList });
  });

  app.get('/api/nodes', (_req, res) => {
    const allNodes: Array<{ config: EdgeNodeConfig; heartbeat?: NodeHeartbeat }> = [];
    for (const [nodeId, config] of registeredNodes.entries()) {
      allNodes.push({ config, heartbeat: nodeHeartbeats.get(nodeId) });
    }
    res.json({ count: allNodes.length, nodes: allNodes });
  });

  app.post('/api/logs/emit', (req, res) => {
    const logEvent: StepLogEvent = req.body;
    io.emit('step_log', logEvent);
    res.json({ status: 'EMITTED' });
  });

  return app;
}

export function startRegistry(port: number) {
  const expressApp = express();
  const server = http.createServer(expressApp);
  const io = new SocketIOServer(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  const router = createRegistryRouter(io);
  expressApp.use(router);

  server.listen(port, () =>
    logger.info({ port }, '[REGISTRY] Service Registry running with Socket.IO event server')
  );
}
