import express from 'express';
import cors from 'cors';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import { createLogger } from '@edgemesh/logger';
import { generateRequestId } from '@edgemesh/shared-utils';
import { RoutingResponse, StepLogEvent } from '@edgemesh/shared-types';

const logger = createLogger('api-gateway');
const app = express();
const PORT = process.env.PORT || 3000;

const ROUTING_ENGINE_URL = process.env.ROUTING_ENGINE_URL || 'http://localhost:3001';
const ORIGIN_URL = process.env.ORIGIN_URL || 'http://localhost:5000';
const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:3002';

const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// Helper to broadcast step log events
async function emitStepLog(
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
    await axios.post(`${REGISTRY_URL}/api/logs/emit`, logEvent, { timeout: 1000 });
  } catch {
    // Ignore log server drops
  }
}

// Health Check Endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'UP', service: 'api-gateway' });
});

// Proxy File Fetch API (Primary Gateway Routing Entry)
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
    requestId,
    1,
    'Client Request Ingress',
    `Gateway received request for file '${fileId}' from coordinates (${clientLat.toFixed(4)}, ${clientLng.toFixed(4)}).`,
    'info'
  );

  try {
    // STEP 2: Ask Routing Engine for target node
    await emitStepLog(
      requestId,
      2,
      'Forward to Routing Engine',
      `Querying Routing Engine at ${ROUTING_ENGINE_URL} to select nearest healthy Edge Node...`,
      'info'
    );

    const routingRes = await axios.post<RoutingResponse>(
      `${ROUTING_ENGINE_URL}/api/route`,
      { clientLat, clientLng, fileId },
      { headers: { 'x-request-id': requestId }, timeout: 4000 }
    );

    const { selectedNode, distanceKm } = routingRes.data;

    // STEP 3: Proxy Request to Target Edge Node
    const targetUrl = `${selectedNode.baseUrl}/files/${fileId}`;
    logger.info({ requestId, targetUrl, selectedNodeId: selectedNode.id }, 'Proxying request to target Edge Node');

    const edgeNodeRes = await axios.get(targetUrl, {
      responseType: 'arraybuffer',
      headers: { 'x-request-id': requestId },
      timeout: 8000,
    });

    const cacheStatus = edgeNodeRes.headers['x-cache'] || 'UNKNOWN';
    const totalLatencyMs = Date.now() - startTime;

    // STEP 7: Final Egress Response Log
    await emitStepLog(
      requestId,
      7,
      'Response Egress to Client',
      `Serving file '${fileId}' to client from Node '${selectedNode.name}' (${distanceKm}km). Status: ${cacheStatus} | Total Latency: ${totalLatencyMs}ms.`,
      'success'
    );

    // Pass through headers to client
    const rawMime = edgeNodeRes.headers['content-type'];
    const mimeType = typeof rawMime === 'string' ? rawMime : 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('X-Cache', String(cacheStatus));
    res.setHeader('X-Selected-Node-ID', selectedNode.id);
    res.setHeader('X-Selected-Node-Name', selectedNode.name);
    res.setHeader('X-Distance-Km', distanceKm.toString());
    res.setHeader('X-Total-Latency-Ms', totalLatencyMs.toString());
    res.setHeader('X-Request-ID', requestId);

    return res.send(Buffer.from(edgeNodeRes.data));
  } catch (err) {
    const totalLatencyMs = Date.now() - startTime;
    logger.error({ requestId, error: (err as Error).message }, 'Error in Gateway request proxying');

    await emitStepLog(
      requestId,
      7,
      'Request Proxying Failed',
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

// Proxy File Upload API (Direct upload to Origin Server)
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

    const originRes = await axios.post(`${ORIGIN_URL}/api/files/upload`, formData, {
      headers: formData.getHeaders(),
      timeout: 10000,
    });

    res.status(201).json(originRes.data);
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Failed to upload file to Origin via Gateway');
    res.status(500).json({ error: 'Gateway failed to upload file to Origin Server' });
  }
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, '🚀 API Gateway is running and listening');
});
