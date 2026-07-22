import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { createLogger } from '@edgemesh/logger';
import { calculateHaversineDistance } from '@edgemesh/shared-utils';
import { EdgeNodeConfig, NodeHeartbeat, RoutingRequest, RoutingResponse, StepLogEvent } from '@edgemesh/shared-types';

const logger = createLogger('routing-engine');
const app = express();
const PORT = process.env.PORT || 3001;
const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:3002';

app.use(cors());
app.use(express.json());

// Helper to emit step logs to Service Registry
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
    service: 'ROUTING',
    stepNumber,
    title,
    details,
    level,
  };

  try {
    await axios.post(`${REGISTRY_URL}/api/logs/emit`, logEvent, { timeout: 1000 });
  } catch {
    // Ignore log failures
  }
}

// Health Check Endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'UP', service: 'routing-engine' });
});

// Primary Routing Decision API
app.post('/api/route', async (req, res) => {
  const startTime = Date.now();
  const { clientLat, clientLng, fileId } = req.body as RoutingRequest;
  const requestId = (req.headers['x-request-id'] as string) || undefined;

  if (typeof clientLat !== 'number' || typeof clientLng !== 'number') {
    return res.status(400).json({ error: 'Valid clientLat and clientLng coordinates required' });
  }

  logger.info({ clientLat, clientLng, fileId, requestId }, 'Received routing calculation request');

  try {
    // Fetch healthy nodes from Service Registry
    const registryRes = await axios.get(`${REGISTRY_URL}/api/nodes/healthy`, { timeout: 3000 });
    const healthyNodes: Array<{ config: EdgeNodeConfig; heartbeat: NodeHeartbeat }> = registryRes.data.nodes || [];

    if (healthyNodes.length === 0) {
      await emitStepLog(
        requestId,
        3,
        'Routing Failed',
        `No healthy Edge Nodes available in Service Registry to route client request!`,
        'error'
      );
      return res.status(503).json({ error: 'No healthy Edge Nodes available in network' });
    }

    // Evaluate each healthy node using Haversine & Load weighting
    const candidateScores = healthyNodes.map(({ config, heartbeat }) => {
      const distanceKm = calculateHaversineDistance(clientLat, clientLng, config.lat, config.lng);
      const loadPct = heartbeat.loadPercentage || 0;

      // Composite scoring formula: 70% Distance + 30% Load
      const score = distanceKm * 0.7 + loadPct * 30;

      return {
        config,
        heartbeat,
        nodeId: config.id,
        distanceKm,
        loadPercentage: loadPct,
        score: Math.round(score * 100) / 100,
      };
    });

    // Sort candidates by score ascending (lowest score wins)
    candidateScores.sort((a, b) => a.score - b.score);
    const winner = candidateScores[0];
    const routingTimeMs = Date.now() - startTime;

    logger.info(
      {
        selectedNodeId: winner.nodeId,
        distanceKm: winner.distanceKm,
        load: winner.loadPercentage,
        score: winner.score,
        routingTimeMs,
      },
      '🏆 Best Edge Node selected'
    );

    const candidatesSummary = candidateScores
      .map((c) => `${c.config.name} (${c.distanceKm}km, Load: ${c.loadPercentage}%, Score: ${c.score})`)
      .join(' | ');

    await emitStepLog(
      requestId,
      3,
      'Geo & Load Route Decision',
      `Evaluated ${healthyNodes.length} healthy nodes [${candidatesSummary}]. Winner: '${winner.config.name}' (${winner.distanceKm}km).`,
      'success'
    );

    const response: RoutingResponse = {
      selectedNode: winner.config,
      distanceKm: winner.distanceKm,
      routingTimeMs,
      candidateScores: candidateScores.map((c) => ({
        nodeId: c.nodeId,
        distanceKm: c.distanceKm,
        loadPercentage: c.loadPercentage,
        score: c.score,
      })),
    };

    res.json(response);
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Failed to query Service Registry for routing');
    await emitStepLog(
      requestId,
      3,
      'Routing Registry Error',
      `Failed to contact Service Registry: ${(err as Error).message}`,
      'error'
    );
    res.status(500).json({ error: 'Failed to communicate with Service Registry' });
  }
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, '🚀 Routing Engine is running and listening');
});
