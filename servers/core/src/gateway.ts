import express from 'express';
import cors from 'cors';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import { createLogger, generateRequestId, RoutingResponse, StepLogEvent } from './shared';

const logger = createLogger('api-gateway');

async function emitStepLog(
  registryUrl: string,
  requestId: string,
  stepNumber: number,
  title: string,
  details: string,
  level: 'info' | 'warn' | 'error' | 'success' = 'info'
) {
  const logEvent: StepLogEvent = {
    id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    requestId,
    timestamp: Date.now(),
    service: 'GATEWAY',
    stepNumber,
    title,
    details,
    level,
  };
  try {
    await axios.post(`${registryUrl}/api/logs/emit`, logEvent, { timeout: 1000 });
  } catch {
    // Ignore log server drops
  }
}

export function createGatewayRouter(routingEngineUrl: string, originUrl: string, registryUrl: string) {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage() });

  app.use(cors({
    origin: '*',
    exposedHeaders: [
      'X-Cache', 'X-Selected-Node-ID', 'X-Selected-Node-Name',
      'X-Distance-Km', 'X-Total-Latency-Ms', 'X-Request-ID'
    ]
  }));
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'UP', service: 'api-gateway' }));

  app.get('/', (_req, res) => {
    res.json({
      status: 'UP',
      service: 'api-gateway',
      description: 'EdgeMesh CDN API Gateway',
      endpoints: {
        health: '/health',
        fetch: '/cdn/fetch',
        upload: '/cdn/upload'
      }
    });
  });

  app.get('/cdn/fetch', async (req, res) => {
    const startTime = Date.now();
    const requestId = generateRequestId();
    const fileId = req.query.fileId as string;
    const latStr = req.query.lat as string;
    const lngStr = req.query.lng as string;

    if (!fileId || !latStr || !lngStr) {
      return res.status(400).json({ error: 'Query parameters fileId, lat, and lng are required' });
    }

    const clientLat = parseFloat(latStr);
    const clientLng = parseFloat(lngStr);

    logger.info({ requestId, fileId, clientLat, clientLng }, 'Gateway received file download request');

    // STEP 1: Ingress Log
    await emitStepLog(
      registryUrl, requestId, 1,
      'Client Request Ingress',
      `Gateway received request for file '${fileId}' from coordinates (${clientLat.toFixed(4)}, ${clientLng.toFixed(4)}).`,
      'info'
    );

    try {
      // STEP 2: Ask Routing Engine for target node
      await emitStepLog(
        registryUrl, requestId, 2,
        'Forward to Routing Engine',
        `Querying Routing Engine at ${routingEngineUrl} to select nearest healthy Edge Node...`,
        'info'
      );

      const routingRes = await axios.post<RoutingResponse>(
        `${routingEngineUrl}/api/route`,
        { clientLat, clientLng, fileId },
        { headers: { 'x-request-id': requestId }, timeout: 4000 }
      );

      const { selectedNode, distanceKm } = routingRes.data;

      // STEP 3: Proxy request to the nearest Edge Node (server-side, no CORS issue)
      const targetUrl = `${selectedNode.baseUrl}/files/${fileId}`;
      logger.info({ requestId, targetUrl, selectedNodeId: selectedNode.id }, 'Proxying request to nearest Edge Node');

      await emitStepLog(
        registryUrl, requestId, 3,
        'Route to Edge Node',
        `Routing to nearest Edge Node: '${selectedNode.name}' at ${targetUrl} (${distanceKm}km away). Proxying response...`,
        'info'
      );

      const edgeRes = await axios.get(targetUrl, {
        params: { distanceKm, selectedNodeName: selectedNode.name, gatewayRequestId: requestId },
        headers: { 'x-request-id': requestId },
        responseType: 'arraybuffer',
        timeout: 8000,
      });

      const cacheStatus = edgeRes.headers['x-cache'] || 'UNKNOWN';
      const totalLatencyMs = Date.now() - startTime;

      await emitStepLog(
        registryUrl, requestId, 7,
        'Response Egress to Client',
        `Serving file '${fileId}' from '${selectedNode.name}' (${distanceKm}km). Cache: ${cacheStatus} | Latency: ${totalLatencyMs}ms.`,
        'success'
      );

      const rawMime = edgeRes.headers['content-type'];
      const mimeType = typeof rawMime === 'string' ? rawMime : 'application/octet-stream';

      res.setHeader('Content-Type', mimeType);
      res.setHeader('X-Cache', String(cacheStatus));
      res.setHeader('X-Selected-Node-ID', selectedNode.id);
      res.setHeader('X-Selected-Node-Name', selectedNode.name);
      res.setHeader('X-Distance-Km', distanceKm.toString());
      res.setHeader('X-Total-Latency-Ms', totalLatencyMs.toString());
      res.setHeader('X-Request-ID', requestId);

      return res.send(Buffer.from(edgeRes.data));

    } catch (err) {
      const totalLatencyMs = Date.now() - startTime;
      logger.error({ requestId, error: (err as Error).message }, 'Error in Gateway request');

      await emitStepLog(
        registryUrl, requestId, 7,
        'Request Failed',
        `Gateway request failed: ${(err as Error).message}`,
        'error'
      );

      return res.status(500).json({
        error: 'Failed to process CDN fetch request via Gateway',
        details: (err as Error).message,
        requestId,
        latencyMs: totalLatencyMs,
      });
    }
  });

  app.post('/cdn/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided in request' });
    }

    try {
      const formData = new FormData();
      formData.append('file', req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });

      const originRes = await axios.post(`${originUrl}/api/files/upload`, formData, {
        headers: formData.getHeaders(),
        timeout: 10000,
      });

      res.status(201).json(originRes.data);
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Failed to upload file to Origin via Gateway');
      res.status(500).json({ error: 'Gateway failed to upload file to Origin Server' });
    }
  });

  return app;
}

export function startGateway(port: number, routingEngineUrl: string, originUrl: string, registryUrl: string) {
  const app = createGatewayRouter(routingEngineUrl, originUrl, registryUrl);
  app.listen(port, () => logger.info({ port }, '[GATEWAY] API Gateway running'));
}
