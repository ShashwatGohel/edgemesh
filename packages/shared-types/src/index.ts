/**
 * Node status enum
 */
export type NodeStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

/**
 * Edge Node Configuration metadata
 */
export interface EdgeNodeConfig {
  id: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
  port: number;
  baseUrl: string;
  redisUrl: string;
}

/**
 * Edge Node dynamic metrics and heartbeat data
 */
export interface NodeHeartbeat {
  nodeId: string;
  name: string;
  region: string;
  status: NodeStatus;
  loadPercentage: number;
  redisMemoryUsedMb: number;
  storageUsedBytes: number;
  activeConnections: number;
  cacheHitCount: number;
  cacheMissCount: number;
  lastHeartbeatTimestamp: number;
}

/**
 * Metadata for files stored on Origin & Edge nodes
 */
export interface FileMetadata {
  fileId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  createdAt: string;
}

/**
 * Routing request query payload
 */
export interface RoutingRequest {
  clientLat: number;
  clientLng: number;
  fileId: string;
}

/**
 * Routing Engine decision result
 */
export interface RoutingResponse {
  selectedNode: EdgeNodeConfig;
  distanceKm: number;
  routingTimeMs: number;
  candidateScores: Array<{
    nodeId: string;
    distanceKm: number;
    loadPercentage: number;
    score: number;
  }>;
}

/**
 * Cache status headers & result types
 */
export type CacheStatus = 'HIT-REDIS' | 'HIT-DISK' | 'MISS-FETCHED-FROM-ORIGIN';

/**
 * Live Log & Metrics Step Event for Socket.IO streaming
 */
export interface StepLogEvent {
  id: string;
  requestId?: string;
  timestamp: number;
  service: 'GATEWAY' | 'ROUTING' | 'REGISTRY' | 'EDGE-NODE' | 'ORIGIN' | 'CLIENT';
  stepNumber?: number;
  title: string;
  details: string;
  level: 'info' | 'warn' | 'error' | 'success';
  metadata?: Record<string, unknown>;
}
