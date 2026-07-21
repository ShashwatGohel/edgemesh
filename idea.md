# PRD -- EdgeMesh CDN Simulator (MVP)

## Vision

Build **EdgeMesh**, a Cloudflare-inspired **CDN Simulator** that
demonstrates distributed systems concepts rather than production-scale
performance.

The project should showcase:

- API Gateway
- Service Registry
- Geo Routing (Haversine)
- Edge Nodes
- Redis Edge Cache
- Cache Hit / Cache Miss
- Origin Server
- Health Checks
- Dockerized Microservices
- Real-time Monitoring Dashboard

**Target:** Complete MVP in **7 days**.

---

# Goals

## Primary Goal

Demonstrate backend and system design skills suitable for software
engineering interviews.

## Non Goals

- Real DNS
- HTTP/3
- QUIC
- Kubernetes
- Kafka
- Multi-region cloud deployment
- Production CDN performance

---

# High-Level Architecture

Client → API Gateway → Service Registry → Routing Engine → Best Edge
Node → Redis Cache → Local Storage → Origin (on cache miss)

Admin Dashboard observes every component in real time.

---

# Core Components

## 1. Origin Server

Responsibilities

- Master copy of every file
- Upload/Delete APIs
- Metadata
- Serve files to edge nodes on cache miss

Storage

    origin/storage/

---

## 2. API Gateway

Responsibilities

- Entry point
- Request logging
- Forward requests to Routing Engine

No business logic.

---

## 3. Service Registry

Responsibilities

- Register Edge Nodes
- Heartbeats
- Healthy/Unhealthy status
- Node metadata

Stores

- Node Name
- Latitude
- Longitude
- Current Load
- Status
- Redis usage
- Storage usage

---

## 4. Routing Engine

Responsibilities

- Get healthy nodes from Registry
- Calculate Haversine distance
- Consider node load
- Select best node
- Return node URL

Decision Priority

1.  Healthy
2.  Distance
3.  Load

---

## 5. Edge Node

Each node is an independent microservice.

Contains

- Express Server
- Redis
- Local Storage

Flow

Request

↓

Redis

↓

Hit?

↓

Return

↓

Storage

↓

Redis

↓

Return

---

## 6. Admin Dashboard

Features

- Origin status
- Edge node status
- Node locations
- Redis contents
- Storage usage
- Cache Hit/Miss counters
- Live request flow
- Request logs
- Node load
- Latency

Uses Socket.IO.

---

## 7. Client Page

Simple interface

Inputs

- Latitude
- Longitude
- File

Outputs

- Download
- Selected Node
- Cache Hit/Miss
- Latency

---

# Request Flow

1.  Client requests file.
2.  API Gateway receives request.
3.  Gateway asks Routing Engine.
4.  Routing Engine fetches healthy nodes from Registry.
5.  Routing Engine calculates Haversine distance.
6.  Chooses nearest healthy node with lowest load.
7.  Gateway forwards request.
8.  Edge Node checks Redis.
9.  Cache Hit → Return.
10. Cache Miss → Read Storage.
11. If absent → Fetch from Origin.
12. Store in Storage.
13. Store in Redis.
14. Return file.

---

# Backend Folder Structure

```text
apps/
    gateway/
    origin/
    registry/
    routing-engine/
    edge-node-mumbai/
    edge-node-delhi/
    edge-node-singapore/
    dashboard/

packages/
    shared-types/
    shared-utils/
    logger/

docker/
docs/
```

---

# Technology Stack

Backend

- Node.js
- Express
- TypeScript

Frontend

- React
- Tailwind CSS

Infrastructure

- Docker Compose
- Redis (one per edge node)

Communication

- REST
- Socket.IO

Logging

- Pino

Package Manager

- pnpm Workspaces

---

# Build Plan

## Phase 1 -- Foundation

- Initialize pnpm workspace
- Configure TypeScript
- Docker Compose
- Shared packages

Deliverable: All services boot independently.

---

## Phase 2 -- Origin Server

Implement

- Upload API
- Download API
- Delete API
- Local storage
- Metadata

Deliverable: Origin can store and serve files.

---

## Phase 3 -- Service Registry

Implement

- Register Node
- Heartbeat
- List Healthy Nodes
- Node metadata

Deliverable: Registry tracks active nodes.

---

## Phase 4 -- Edge Node

Implement

- Redis
- Local Storage
- Cache logic
- Health endpoint
- Metrics endpoint

Deliverable: Single edge node serves files with cache.

---

## Phase 5 -- Routing Engine

Implement

- Haversine
- Load-aware selection
- Best-node API

Deliverable: Returns best edge node.

---

## Phase 6 -- API Gateway

Implement

- Receive requests
- Call Routing Engine
- Proxy request
- Log request

Deliverable: Complete request routing.

---

## Phase 7 -- Multiple Edge Nodes

Run

- Mumbai
- Delhi
- Singapore

Each has

- Independent storage
- Independent Redis
- Independent health

Deliverable: Distributed system operational.

---

## Phase 8 -- Dashboard

Admin Dashboard

Pages

- Overview
- Nodes
- Origin
- Redis
- Logs
- Live Requests

Client Page

- Select location
- Request file
- View response metrics

Deliverable: Real-time visualization.

---

## Phase 9 -- Polish

- Better UI
- Architecture diagrams
- README
- Screenshots
- Demo video
- Docker one-command startup

---

# MVP Deliverables

- Working CDN simulator
- Geo-routing
- Service discovery
- Health monitoring
- Redis edge caching
- Cache hit/miss visualization
- Dockerized microservices
- Live dashboard
- Clean documentation

---

# Future Enhancements (V2)

- Lazy replication
- Signed URLs
- Range requests
- Compression
- ETag support
- MongoDB metadata
- Prometheus & Grafana
- Kubernetes deployment
- CDN analytics
- AI traffic prediction
