/**
 * EdgeMesh Core Server
 * Runs Origin (5000), Registry (3002), Routing Engine (3001), API Gateway (3000)
 * all in a single Node.js process — no Docker, no pnpm workspace required.
 */

import { startOrigin } from './origin';
import { startRegistry } from './registry';
import { startRoutingEngine } from './routing';
import { startGateway } from './gateway';
import { startUnifiedServer } from './unified';

const PORT = parseInt(process.env.PORT || '3000');
const UNIFIED = process.env.UNIFIED === 'true' || process.env.PORT !== undefined;

if (UNIFIED) {
  // Start the unified single-port monolith server
  // VITE_BACKEND_URL can be passed as public url (e.g. https://edgemesh-backend.koyeb.app)
  const publicBackendUrl = process.env.VITE_BACKEND_URL || process.env.PUBLIC_BACKEND_URL;
  startUnifiedServer(PORT, publicBackendUrl);
} else {
  // Start the traditional multi-port local servers
  const ORIGIN_PORT = parseInt(process.env.ORIGIN_PORT || '5000');
  const REGISTRY_PORT = parseInt(process.env.REGISTRY_PORT || '3002');
  const ROUTING_PORT = parseInt(process.env.ROUTING_PORT || '3001');
  const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '3000');

  const ORIGIN_URL = process.env.ORIGIN_URL || `http://localhost:${ORIGIN_PORT}`;
  const REGISTRY_URL = process.env.REGISTRY_URL || `http://localhost:${REGISTRY_PORT}`;
  const ROUTING_URL = process.env.ROUTING_URL || `http://localhost:${ROUTING_PORT}`;

  console.log('');
  console.log('======================================================');
  console.log('  EdgeMesh CORE SERVER (Traditional Multi-Port)');
  console.log('======================================================');
  console.log(`  Origin Server    → http://localhost:${ORIGIN_PORT}`);
  console.log(`  Service Registry → http://localhost:${REGISTRY_PORT}`);
  console.log(`  Routing Engine   → http://localhost:${ROUTING_PORT}`);
  console.log(`  API Gateway      → http://localhost:${GATEWAY_PORT}`);
  console.log('======================================================');
  console.log('');

  startOrigin(ORIGIN_PORT);
  startRegistry(REGISTRY_PORT);
  startRoutingEngine(ROUTING_PORT, REGISTRY_URL);
  startGateway(GATEWAY_PORT, ROUTING_URL, ORIGIN_URL, REGISTRY_URL);
}
