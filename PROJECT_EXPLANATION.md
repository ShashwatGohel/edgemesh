# EdgeMesh CDN Simulator — Complete System Design & Interview Guide

---

## 1. Executive Summary & 30-Second Elevator Pitch

> *"EdgeMesh is a distributed, multi-region Content Delivery Network (CDN) simulator inspired by Cloudflare and Akamai. It demonstrates how global static file distribution works using microservices architecture, geo-intelligent routing (Haversine formula + load balancing), service discovery with heartbeat monitoring, and a 3-tier waterfall caching strategy (L1 Redis Cache -> L2 Disk Cache -> L3 Master Origin). It includes an interactive real-time visualizer built with Socket.IO that lets you trace end-to-end request flow, cache hits/misses, latency metrics, and node failovers live."*

---

## 2. High-Level System Architecture

```text
[ Client Application ] (Port 5174)
        │
        ▼ (HTTP GET /cdn/fetch?fileId=X&lat=Y&lng=Z)
┌─────────────────────────────────────────────────────────┐
│                      API GATEWAY                        │ (Port 3000)
│  - Ingress entry point                                  │
│  - Request tracing & metadata propagation               │
│  - Server-side response proxying (CORS safe)             │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼ (Internal POST /api/route)
┌─────────────────────────────────────────────────────────┐
│                    ROUTING ENGINE                       │ (Port 3001)
│  - Queries Service Registry for healthy nodes            │
│  - Computes Haversine Distance (client ↔ nodes)         │
│  - Composite Score = 70% Distance + 30% Node Load       │
│  - Selects optimal Edge Node                            │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼ (Internal GET /api/nodes/healthy)
┌─────────────────────────────────────────────────────────┐
│                   SERVICE REGISTRY                      │ (Port 3002)
│  - Central Service Discovery & State Management         │
│  - Tracks active heartbeats & CPU/Memory metrics        │
│  - Automated TTL Reaper (Marks nodes UNHEALTHY >10s)    │
│  - Socket.IO Server for live event streaming to UI      │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼ (Gateway proxies request to winner edge node)
┌─────────────────────────────────────────────────────────────────────────┐
│                    DISTRIBUTED EDGE NODES                               │
│  [ Edge Mumbai: 4001 ]   [ Edge Delhi: 4002 ]   [ Edge Singapore: 4003 ]  │
│                                                                         │
│  Waterfall Cache Flow:                                                  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 1. L1 Redis Cache Check (Fast in-memory, 5-min TTL)                │  │
│  │    └─► HIT-REDIS? Return immediately (<10ms)                      │  │
│  │ 2. L2 Local Disk Storage Check (node/storage/[nodeId]/)           │  │
│  │    └─► HIT-DISK? Async backfill to L1 Redis -> Return (<30ms)     │  │
│  │ 3. L3 Master Origin Fetch (Miss)                                  │  │
│  │    └─► Fetch from Origin -> Save L2 Disk -> Save L1 Redis -> Return│  │
│  └───────────────────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼ (On L1/L2 Cache Miss)
┌─────────────────────────────────────────────────────────┐
│                     ORIGIN SERVER                       │ (Port 5000)
│  - Master source of truth for all uploaded files        │
│  - Disk storage: storage/origin/                        │
│  - Persistent JSON metadata index (checksum, mime, size)│
└─────────────────────────────────────────────────────────┘
```

---

## 3. Microservices Breakdown & Data Responsibilities

### Component 1: API Gateway (Port 3000)
- **Role**: Single Point of Entry (Reverse Proxy).
- **Key Responsibilities**:
  - Hides internal service topology from external clients.
  - Generates a unique `X-Request-ID` (`req_timestamp_rand`) for request tracing across microservices.
  - Queries the **Routing Engine** to discover the target Edge Node.
  - Proxies the file stream from the Edge Node back to the client while preserving metric headers (`X-Cache`, `X-Selected-Node-ID`, `X-Distance-Km`, `X-Total-Latency-Ms`).
  - Hides cross-origin port boundaries from the browser client to eliminate CORS issues.

### Component 2: Service Registry (Port 3002)
- **Role**: Service Discovery & Health Monitoring.
- **Key Responsibilities**:
  - In-memory registry keeping track of registered nodes, coordinates, ports, and region metadata.
  - Receives node **heartbeats** every 3 seconds containing CPU load, connection count, and storage stats.
  - Runs a background **TTL Reaper** every 3 seconds: if a node misses heartbeats for >10 seconds, its status transitions from `HEALTHY` -> `UNHEALTHY` automatically.
  - Integrated **Socket.IO Server**: Streams real-time network logs and state transitions to the Admin Dashboard.

### Component 3: Geo & Load Routing Engine (Port 3001)
- **Role**: Intelligent Request Placement Engine.
- **Key Responsibilities**:
  - Fetches the list of active, `HEALTHY` edge nodes from the Service Registry.
  - Calculates physical geographic distance using the **Haversine Formula**:
    $$d = 2R \arcsin \left( \sqrt{ \sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right) } \right)$$
  - Applies a **Composite Scoring Formula**:
    $$\text{Score} = (\text{Distance in km} \times 0.7) + (\text{CPU Load \%} \times 30)$$
  - Selects the node with the **lowest composite score** (nearest + least busy).

### Component 4: Edge Nodes (Mumbai: 4001, Delhi: 4002, Singapore: 4003)
- **Role**: Regional Edge Caching Microservices.
- **Key Responsibilities**:
  - Maintains isolated local disk storage (`storage/[nodeId]/`) and dedicated L1 Redis instances (or in-memory `MockRedis` fallback).
  - Implements **3-Tier Waterfall Fetching**:
    - **Step 1 (L1 Redis)**: Checks base64-encoded file contents in Redis key `file:[fileId]`.
    - **Step 2 (L2 Disk)**: Checks local disk directory. On hit, back-fills L1 Redis asynchronously.
    - **Step 3 (L3 Origin)**: On miss, pulls from Origin Server (`http://localhost:5000`), caches to L2 Disk and L1 Redis, then serves client.
  - Emits step-by-step audit logs (`StepLogEvent`) to the Registry for real-time visualization.

### Component 5: Origin Server (Port 5000)
- **Role**: Master Storage / Authoritative Data Source.
- **Key Responsibilities**:
  - Stores uploaded files in `storage/origin/`.
  - Computes MD5 checksums and stores structured file metadata in `metadata.json`.
  - Serves files to Edge Nodes on cache misses.

---

## 4. Key Engineering & System Design Concepts Demonstrated

1. **Service Discovery & Active Health Checking**: Edge nodes register dynamically. The registry handles node failure gracefully by excluding `UNHEALTHY` nodes from routing calculations.
2. **Multi-Tier Caching Strategy**: Demonstrates L1 (Memory - fast, volatile) vs L2 (SSD/Disk - persistent, medium) vs L3 (Remote Network - slow, master).
3. **Geo-Location Routing & Haversine Distance**: Shows real spherical math used in production CDNs (Cloudflare Anycast / AWS Route53 GeoDNS).
4. **Load-Aware Routing**: Prevents "thundering herd" or "hot-spotting" by factoring real-time CPU load into node selection.
5. **Observability & Distributed Tracing**: Attaching `X-Request-ID` to trace a single user click across Gateway -> Routing -> Registry -> Edge Node -> Origin -> Dashboard.
6. **Graceful Fallback & Degradation**: Edge nodes run with `MockRedis` in-memory fallback if Docker or real Redis is unavailable.

---

## 5. End-to-End Execution Flow (Step-by-Step)

```text
[Client] ──(1) GET /cdn/fetch?fileId=abc&lat=40.71&lng=-74.01)──► [API Gateway]
                                                                        │
                                   ┌────────────────────────────────────┘
                                   │ (2) Query Route
                                   ▼
                            [Routing Engine]
                                   │
                                   │ (3) GET /api/nodes/healthy
                                   ▼
                           [Service Registry] ──► Returns [Mumbai, Delhi, Singapore]
                                   │
                                   │ (4) Haversine + Load Score Math
                                   ▼
                           Winner: Edge Singapore (5311km, Load 0%)
                                   │
                                   ▼
[API Gateway] ◄── Returns Node Config ───┘
     │
     │ (5) Server-Side Proxy GET http://localhost:4003/files/abc
     ▼
[Edge Singapore]
     ├─► Check L1 Redis (`file:abc`) ──────────────► [MISS]
     ├─► Check L2 Disk (`storage/edge-singapore`) ─► [MISS]
     └─► (6) Fetch L3 Origin (`localhost:5000`) ───► [SUCCESS]
            │
            ├─► Save to L2 Disk (`storage/edge-singapore/abc.txt`)
            ├─► Save to L1 Redis (`file:abc`, TTL=300s)
            └─► Return Buffer to Gateway with header `X-Cache: MISS-FETCHED-FROM-ORIGIN`
                                   │
                                   ▼
[Client] ◄── Stream Buffer + Headers (X-Cache, X-Distance-Km, X-Selected-Node-Name) ── [Gateway]
```

---

## 6. How to Explain This in an Interview (Structure & Script)

### Step 1: Set the Problem Context
*"In modern high-traffic applications, serving static assets like images, videos, or documents directly from a central database or origin server leads to high latency and origin server overload. Content Delivery Networks solve this by caching content geographically closer to users."*

### Step 2: Introduce the Project Architecture
*"To demonstrate how CDNs work internally, I built EdgeMesh — a full-stack CDN simulator using Node.js, TypeScript, Express, Redis, Docker, and React. It simulates three edge regions (Mumbai, Delhi, Singapore), an Origin Server, an API Gateway, a Routing Engine, and a Service Registry."*

### Step 3: Explain the Key Technical Challenges You Solved
1. **Dynamic Routing**: *"I implemented the Haversine formula to compute exact distance on the Earth's surface between the client's coordinates and edge nodes, blended with real-time CPU load to prevent routing traffic to overloaded nodes."*
2. **Caching Strategy**: *"I built a 3-tier waterfall caching pipeline. L1 is an in-memory Redis cache for sub-10ms hits; L2 is regional disk storage; L3 is origin fetching."*
3. **Observability**: *"I used Socket.IO and Pino logger to stream live request tracing and node heartbeats to a real-time admin dashboard."*

---

## 7. Performance & Operational Metrics

| Metric | Target / Benchmark |
|---|---|
| **L1 Redis Cache Hit Latency** | $< 15 \text{ ms}$ |
| **L2 Local Disk Cache Hit Latency** | $< 45 \text{ ms}$ |
| **L3 Origin Fetch Latency (Miss)** | $100 - 300 \text{ ms}$ |
| **Heartbeat Interval** | Every $3000 \text{ ms}$ |
| **Node Failure Timeout (TTL)** | $10000 \text{ ms}$ |
| **Redis Cache Expiration (TTL)** | $300 \text{ seconds}$ (5 mins) |
