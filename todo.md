# EdgeMesh CDN Simulator - Master Implementation TODO & Roadmap

## 📌 Project Overview
**EdgeMesh** is a Cloudflare-inspired, multi-region CDN (Content Delivery Network) simulator built as a TypeScript monorepo using `pnpm` workspaces, Docker Compose, Redis, Express, and React with Socket.IO real-time monitoring.

### High-Level Architecture
```text
Client App / Simulator
        │
        ▼
   API Gateway (Port 3000) ──► Routing Engine (Port 3001) ──► Service Registry (Port 3002)
        │                                                           │
        │ (Forwards to selected node)                              │ (Heartbeats & Node Status)
        ▼                                                           │
┌───────────────────────────────┬───────────────────────────────┬───┴───────────────────────────┐
│ Edge Node: Mumbai (Port 4001) │ Edge Node: Delhi (Port 4002)  │ Edge Node: Singapore (Port 4003)│
│  - Local Storage              │  - Local Storage              │  - Local Storage              │
│  - Redis Cache (Port 6379)    │  - Redis Cache (Port 6380)    │  - Redis Cache (Port 6381)    │
└───────────────┬───────────────┴───────────────┬───────────────┴───────────────┬───────────────┘
                │ (Cache Miss Fetch)            │ (Cache Miss Fetch)            │ (Cache Miss Fetch)
                ▼                               ▼                               ▼
                                  Origin Server (Port 5000)
                                     - Master Storage
```

---

## 🛠️ Monorepo Directory Layout
```text
edgeroute/
├── apps/
│   ├── gateway/                # API Gateway (Express + Axios/Proxy + Pino)
│   ├── origin/                 # Origin Storage Server (File upload/download/delete)
│   ├── registry/               # Service Discovery Registry (Tracks healthy nodes & heartbeats)
│   ├── routing-engine/         # Geo & Load Routing Engine (Haversine math + selection logic)
│   ├── edge-node/              # Reusable Edge Node microservice container template
│   ├── dashboard/              # 1. Main Admin Monitoring Dashboard (React + Vite + Socket.IO + Tailwind, Port 5173)
│   └── client/                 # 2. Client Request Simulator App (React + Vite + Tailwind, Port 5174)
├── packages/
│   ├── shared-types/           # Shared TypeScript interfaces & DTOs
│   ├── shared-utils/           # Haversine distance calculator, formatters, HTTP helpers
│   └── logger/                 # Unified Pino logger configuration
├── docker/
│   ├── Dockerfile.node         # Shared Node microservice Dockerfile
│   └── docker-compose.yml      # Orchestrates 3 Edge Nodes, 3 Redis containers, Gateway, Registry, Routing, Origin, Admin Dashboard, Client App
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.json
├── idea.md
└── todo.md
```

---

## 📋 Complete Step-by-Step Task Checklist

### Phase 1: Workspace & Tooling Setup
- [x] **1.1 Workspace Initialization**
  - [x] Create `pnpm-workspace.yaml` defining `apps/*` and `packages/*`.
  - [x] Initialize root `package.json` with scripts for `dev`, `build`, `lint`, `test`, `docker:up`, `docker:down`.
  - [x] Create base `tsconfig.json` with strict mode, ESNext target, and path aliases.
  - [x] Configure `.gitignore` for `node_modules`, `dist`, `.env`, upload caches, and logs.

- [x] **1.2 Shared Packages Setup**
  - [x] **`packages/shared-types`**: Define types for:
    - `EdgeNodeConfig` (id, name, lat, lng, port, region)
    - `NodeHeartbeat` (nodeId, status, load, redisMemory, storageUsageBytes, activeConnections)
    - `FileMetadata` (fileId, originalName, mimeType, sizeBytes, checksum, createdAt)
    - `RoutingRequest` (clientLat, clientLng, fileId)
    - `RoutingResponse` (selectedNode, distanceKm, routingTimeMs)
    - `MetricsEvent` (eventType: CACHE_HIT | CACHE_MISS | ORIGIN_FETCH | ROUTE_DECISION, timestamp, details)
  - [x] **`packages/shared-utils`**:
    - [x] Implement Haversine Distance algorithm: `calculateHaversineDistance(lat1, lon1, lat2, lon2): number`.
    - [x] Add unit test suite for Haversine distance calculations (e.g. Mumbai to Delhi ~1148 km, Mumbai to Singapore ~3890 km).
    - [x] Create HTTP helper functions for standardize API responses.
  - [x] **`packages/logger`**:
    - [x] Set up `pino` and `pino-pretty` wrapper with configurable log levels (`LOG_LEVEL`).

---

### Phase 2: Origin Server (`apps/origin`)
- [x] **2.1 Core Functionality**
  - [x] Create Express + TypeScript server listening on port `5000`.
  - [x] Configure `multer` for handling file uploads stored under `apps/origin/storage/`.
  - [x] Maintain an in-memory or JSON-backed metadata index (`metadata.json`) for indexed files.

- [x] **2.2 API Endpoints**
  - [x] `POST /api/files/upload`: Upload file to Origin storage and record metadata.
  - [x] `GET /api/files/:fileId`: Stream/serve requested file to Edge nodes.
  - [x] `GET /api/files`: List all files with sizes, checksums, and metadata.
  - [x] `DELETE /api/files/:fileId`: Delete file from master storage.
  - [x] `GET /health`: Health check endpoint.

- [x] **2.3 Verification**
  - [x] Test uploading sample images/documents to Origin via curl / Postman.
  - [x] Verify file retrieval and missing file `404` error handling.

---

### Phase 3: Service Registry (`apps/registry`)
- [x] **3.1 Heartbeat & Node Tracking System**
  - [x] Create Express server on port `3002`.
  - [x] Maintain an in-memory node map with automatic health TTL checks (mark node `UNHEALTHY` if no heartbeat for > 10s).
  - [x] Socket.IO emission to Dashboard when node status changes (HEALTHY ↔ UNHEALTHY).

- [x] **3.2 API Endpoints & Events**
  - [x] `POST /api/nodes/register`: Register new Edge node specs (ID, Name, Lat, Lng, Base URL).
  - [x] `POST /api/nodes/heartbeat`: Receive periodic stats from Edge nodes (load, memory, disk usage).
  - [x] `GET /api/nodes/healthy`: Return list of currently HEALTHY nodes.
  - [x] `GET /api/nodes`: Return all registered nodes (healthy & unhealthy).
  - [x] `GET /health`: Registry health endpoint.

- [x] **3.3 Verification**
  - [x] Register mock nodes and test automatic status degradation when heartbeats stop.

---

### Phase 4: Edge Node Microservice (`apps/edge-node`)
- [x] **4.1 Architecture & Storage Layers**
  - [x] Build parameterized microservice configurable via environment variables (`NODE_ID`, `NODE_NAME`, `LATITUDE`, `LONGITUDE`, `PORT`, `REDIS_URL`, `ORIGIN_URL`, `REGISTRY_URL`).
  - [x] Integrate `ioredis` client for Level 1 cache (in-memory fast storage).
  - [x] Integrate Local Disk Storage under `apps/edge-node/storage/` for Level 2 cache.

- [x] **4.2 Request & Cache Waterfall Logic**
  - [x] `GET /files/:fileId`:
    1. **Check Redis Cache**: If hit → increment cache hit metric → return file immediately with header `X-Cache: HIT-REDIS`.
    2. **Check Local Disk Storage**: If hit → write to Redis → return file with header `X-Cache: HIT-DISK`.
    3. **Fetch from Origin Server**: On miss → request file from `ORIGIN_URL/api/files/:fileId` → store in Local Disk → store in Redis → return file with header `X-Cache: MISS-FETCHED-FROM-ORIGIN`.
  - [x] Emit realtime metric event (Cache Hit/Miss/Latency) to Dashboard/Registry.

- [x] **4.3 Node Lifecycle & Heartbeat Loop**
  - [x] On startup: Call `POST /api/nodes/register` on Service Registry.
  - [x] Every 3 seconds: Collect system metrics (load, memory usage, cache hit ratio) and POST to `REGISTRY_URL/api/nodes/heartbeat`.

---

### Phase 5: Routing Engine (`apps/routing-engine`)
- [x] **5.1 Selection Logic & Algorithms**
  - [x] Create Express server on port `3001`.
  - [x] Implement multi-criteria decision algorithm:
    1. Fetch healthy nodes list from Service Registry.
    2. Filter out UNHEALTHY or overloaded nodes (load > 90%).
    3. Compute Haversine distance for each candidate node from client `(lat, lng)`.
    4. Calculate composite score: `Score = (Distance_km * 0.7) + (Node_Load_% * 30)`.
    5. Select candidate node with lowest score.

- [x] **5.2 API Endpoints**
  - [x] `POST /api/route`: Accept `{ clientLat, clientLng, fileId }`, return target Edge Node details + calculation metrics (distance, selected node ID, computation latency).
  - [x] `GET /health`: Engine status check.

---

### Phase 6: API Gateway (`apps/gateway`)
- [x] **6.1 Request Orchestration & Proxying**
  - [x] Create Express server on port `3000`.
  - [x] Middleware: Request ID generation, access logging via Pino.
  - [x] Primary endpoint `GET /cdn/fetch`:
    - Accept query params: `fileId`, `lat`, `lng`.
    - Query **Routing Engine** (`POST /api/route`) to determine best Edge Node.
    - Forward/proxy request to selected Edge Node's `/files/:fileId` endpoint.
    - Pass through response headers (`X-Cache`, `X-Edge-Node-ID`, `X-Response-Time`).
  - [x] Direct file upload endpoint `POST /cdn/upload`: Forward file upload directly to Origin Server.

---

### Phase 7: Multi-Node Docker Environment Setup
- [x] **7.1 Docker Orchestration (`docker/docker-compose.yml`)**
  - [x] Create base `docker/Dockerfile.node` using multi-stage build for pnpm workspace microservices.
  - [x] Define Redis services: `redis-mumbai`, `redis-delhi`, `redis-singapore`.
  - [x] Define Edge Node microservice instances:
    - **`edge-mumbai`**: Lat 19.0760, Lng 72.8777 (Port 4001, Redis Port 6379)
    - **`edge-delhi`**: Lat 28.7041, Lng 77.1025 (Port 4002, Redis Port 6380)
    - **`edge-singapore`**: Lat 1.3521, Lng 103.8198 (Port 4003, Redis Port 6381)
  - [x] Define infrastructure services: `origin-server` (5000), `registry-server` (3002), `routing-engine` (3001), `api-gateway` (3000), `dashboard` (5173), `client` (5174).
  - [x] Configure Docker bridge network `edgemesh-net` for inter-service communication.

---

### Phase 8: Frontend Applications (Two Dashboards)

#### 8.1 Dashboard 1: Main Admin Monitoring Dashboard (`apps/dashboard` - Port 5173)
- [x] **Architecture & Real-Time Setup**
  - [x] React + Vite + TypeScript web application in `apps/dashboard`.
  - [x] Solid monochrome black-and-white theme with Tailwind CSS (`bg-black text-white border-zinc-800`).
  - [x] Socket.IO integration connecting to Service Registry & Gateway for real-time events.
- [x] **Admin Features & Panels**
  - [x] **Edge Node Health & Metric Cards**: Real-time status, CPU/Load %, Redis memory usage, disk storage, and active connections.
  - [x] **Origin Server Storage Overview**: View files stored on master Origin server and manage file uploads.
  - [x] **Redis Cache Inspector**: Browse cached key-value entries across each Edge node's Redis instance.
  - [x] **Live System Step-by-Step Execution Log Console**:
    - Real-time streaming log feed displaying microservice event steps across the entire infrastructure:
      - `[GATEWAY] Ingress request ID req_9281 from client (lat: 19.07, lng: 72.87)`
      - `[ROUTING] Evaluating 3 healthy nodes... Mumbai score: 8.7 (Distance: 12km), Delhi: 803km, Singapore: 3890km`
      - `[ROUTING] Selected best node: edge-mumbai`
      - `[EDGE-MUMBAI] Checking Redis Cache... MISS`
      - `[EDGE-MUMBAI] Checking Local Storage... MISS`
      - `[ORIGIN] Serving file to edge-mumbai`
      - `[EDGE-MUMBAI] Cached file in Redis & Local Disk`
      - `[GATEWAY] Egress response 200 OK (Header: X-Cache: MISS-FETCHED-FROM-ORIGIN, Latency: 42ms)`

#### 8.2 Dashboard 2: Client Request Simulator Web App (`apps/client` - Port 5174)
- [x] **Architecture & UI Setup**
  - [x] Lightweight React + Vite + TypeScript application in `apps/client`.
  - [x] Solid monochrome black-and-white theme (`bg-black text-white border-zinc-800`).
- [x] **Client Simulation Features**
  - [x] **Geolocation Picker**: Interactive coordinate input (Latitude & Longitude) or preset location buttons (*Mumbai*, *Delhi*, *Singapore*, *London*, *Tokyo*, *New York*).
  - [x] **File Request Portal**: Dropdown to choose target file from available Origin files.
  - [x] **Interactive Downloader**: Initiate download request through API Gateway (`http://localhost:3000/cdn/fetch`).
  - [x] **Live Request Step Log & Timeline Visualizer**:
    - Interactive step-by-step progress timeline displaying exact execution stages for each client request:
      - `Step 1: 🌐 [Client] Sent request for 'document.pdf' from coordinates (19.0760, 72.8777)`
      - `Step 2: 🔀 [API Gateway] Received request and forwarded to Routing Engine`
      - `Step 3: 📍 [Routing Engine] Calculated Haversine distance. Nearest node: Mumbai (12.4 km)`
      - `Step 4: ⚡ [Edge Node Mumbai] Checking Level 1 Redis Cache... [HIT / MISS]`
      - `Step 5: 💾 [Edge Node Mumbai] Checking Level 2 Local Disk Storage... [HIT / MISS]`
      - `Step 6: ☁️ [Origin Server] Fetching master file from Origin... [COMPLETED]`
      - `Step 7: ✅ [Client] File received! Total Latency: 18ms | Cache Result: HIT-REDIS`
  - [x] **Response Metrics Card**:
    - Selected Edge Node ID & Region name
    - Calculated Distance (km)
    - Cache Status Badge (`HIT-REDIS`, `HIT-DISK`, `MISS-ORIGIN`)
    - Total End-to-End Latency (ms)
    - File Download / Preview link

---

### Phase 9: Polish, Testing & Documentation
- [x] **9.1 Comprehensive End-to-End Testing**
  - [x] Run full system via `docker-compose up --build`.
  - [x] Test cold start scenario (Cache Miss on all nodes -> Origin fetch -> Storage write -> Redis cache populate).
  - [x] Test warm start scenario (Cache Hit on subsequent requests from nearby location).
  - [x] Test failover scenario (Stop Mumbai node container -> verify Routing Engine automatically routes Mumbai user to Delhi node).

- [x] **9.2 Documentation & Deliverables**
  - [x] Write detailed `README.md` with system design diagrams, API documentation, and quickstart guide (`docker compose up`).
  - [x] Document benchmark results comparing latency for Cache Hit vs. Cache Miss vs. Remote Node Routing.

---

## 🎯 Definition of Done (MVP Milestone)
1. Single command `docker compose up` or `start.bat` starts all containers cleanly.
2. **Main Admin Dashboard (`http://localhost:5173`)** displays real-time health, Redis caches, geo map, and system metrics.
3. **Client Simulator App (`http://localhost:5174`)** enables simulated user requests with latitude/longitude inputs, live routing step visualization, and file download metrics.
4. Geo-routing accurately calculates nearest healthy node using Haversine algorithm.
5. Edge nodes properly demonstrate 3-tier waterfall logic (Redis → Disk → Origin).
