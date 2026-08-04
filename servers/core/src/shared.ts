import pino from 'pino';

/**
 * Shared types and utilities for the EdgeMesh Core monolith
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type NodeStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

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
  awsMetadata?: {
    instanceId: string;
    instanceType: string;
    region: string;
    availabilityZone: string;
    amiId: string;
    lifecycle: 'spot' | 'on-demand';
    publicIp?: string;
  };
}

export interface FileMetadata {
  fileId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  createdAt: string;
}

export interface RoutingRequest {
  clientLat: number;
  clientLng: number;
  fileId: string;
}

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

export type CacheStatus = 'HIT-REDIS' | 'HIT-DISK' | 'MISS-FETCHED-FROM-ORIGIN';

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

// ── Logger Factory ────────────────────────────────────────────────────────────

export function createLogger(name: string) {
  return pino({ name, level: 'info' });
}

// ── Haversine Distance Calculation ────────────────────────────────────────────

export function calculateHaversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

// ── Request ID Generator ──────────────────────────────────────────────────────

export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}
