# ⚡ EdgeMesh — Multi-Region Content Delivery Network (CDN) Simulator

<p align="center">
  <img src="https://img.shields.io/badge/Architecture-Microservices-blue.svg?style=for-the-badge" alt="Microservices">
  <img src="https://img.shields.io/badge/Language-TypeScript-3178C6.svg?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Runtime-Node.js-339933.svg?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Cache-Redis_7.0-DC382D.svg?style=for-the-badge&logo=redis&logoColor=white" alt="Redis">
  <img src="https://img.shields.io/badge/Containers-Docker_Compose-2496ED.svg?style=for-the-badge&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/Realtime-Socket.IO-010101.svg?style=for-the-badge&logo=socket.io&logoColor=white" alt="Socket.IO">
</p>

---

## 📌 Executive Summary

**EdgeMesh** is a Cloudflare/Akamai-inspired distributed Content Delivery Network (CDN) simulator designed to demonstrate key backend and distributed systems concepts:

- 🛡️ **API Gateway Reverse Proxying & Request Tracing**
- 🌍 **Geo-Location & Load-Aware Dynamic Routing (Haversine Formula)**
- 📡 **Service Discovery & Automated Heartbeat Health Monitoring**
- ⚡ **3-Tier Waterfall Caching Pipeline (L1 Memory / L2 Regional Storage / L3 Origin)**
- 📊 **Real-time Observability & Event Streaming via Socket.IO**

---

## 🏗️ High-Level System Architecture

```text
                                  ┌───────────────────────────┐
                                  │    Client Application     │
                                  │   (React + Vite :5174)    │
                                  └─────────────┬─────────────┘
                                                │ (HTTP GET /cdn/fetch)
                                                ▼
                                  ┌───────────────────────────┐
                                  │        API Gateway        │
                                  │       (Node.js :3000)     │
                                  └─────────────┬─────────────┘
                                                │ (Query Best Route)
                                                ▼
┌───────────────────────────┐     ┌───────────────────────────┐
│     Service Registry      │◄────┤      Routing Engine       │
│  (Discovery & TTL :3002)  │     │   (Haversine Math :3001)  │
└─────────────┬─────────────┘     └───────────────────────────┘
              │ (Socket.IO Events)
              ▼
┌───────────────────────────┐
│     Admin Dashboard       │
│   (React + Vite :5173)    │
└───────────────────────────┘
                                                │ (Proxy Request to Nearest Edge)
                                                ▼
                ┌───────────────────────────────┴───────────────────────────────┐
                │                                                               │
                ▼                                                               ▼
  ┌───────────────────────────┐                                   ┌───────────────────────────┐
  │      Edge Node Mumbai     │                                   │    Edge Node Singapore    │
  │    (Port 4001 / Redis)    │                                   │    (Port 4003 / Redis)    │
  └─────────────┬─────────────┘                                   └─────────────┬─────────────┘
                │ (L1/L2 Cache Miss)                                            │ (L1/L2 Cache Miss)
                └───────────────────────────────┬───────────────────────────────┘
                                                │
                                                ▼
                                  ┌───────────────────────────┐
                                  │       Origin Server       │
                                  │  (Master Storage :5000)   │
                                  └───────────────────────────┘
```

---

## 🧩 Microservices & Component Architecture

### 1. API Gateway (`apps/gateway` — Port 3000)
- **Role**: Single Point of Ingress & Reverse Proxy.
- **Features**:
  - Hides internal service topology from client applications.
  - Generates unique distributed tracing IDs (`X-Request-ID`).
  - Calls the Routing Engine to resolve the optimal Edge Node.
  - Reverse proxies file streams while attaching metric headers (`X-Cache`, `X-Selected-Node-Name`, `X-Distance-Km`, `X-Total-Latency-Ms`).

### 2. Geo & Load Routing Engine (`apps/routing-engine` — Port 3001)
- **Role**: Intelligent Request Placement.
- **Algorithm**:
  1. Fetches active `HEALTHY` nodes from Service Registry.
  2. Calculates physical distance using the **Haversine Formula**:
     $$d = 2R \arcsin \left( \sqrt{ \sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right) } \right)$$
  3. Computes **Composite Load-Balancing Score**:
     $$\text{Score} = (\text{Distance in km} \times 0.7) + (\text{CPU Load \%} \times 30)$$
  4. Selects the node with the **lowest score** (nearest + least congested).

### 3. Service Registry (`apps/registry` — Port 3002)
- **Role**: Service Discovery & Health Monitoring.
- **Features**:
  - Tracks node metadata (coordinates, region, port, current status).
  - Receives node **heartbeats** every 3 seconds (load %, connection count, disk usage).
  - Runs an automated **TTL Reaper** (marks nodes `UNHEALTHY` if heartbeats miss >10s).
  - Embedded **Socket.IO Server** for real-time live event streaming.

### 4. Edge Nodes (`apps/edge-node` / `servers/edge-node` — Ports 4001, 4002, 4003)
- **Role**: Regional Caching Microservices (Mumbai, Delhi, Singapore).
- **Waterfall Fetching Pipeline**:
  - **Step 1 (L1 Redis Cache)**: Checks base64-encoded RAM cache (`<15ms`).
  - **Step 2 (L2 Regional Disk)**: Checks local SSD storage (`storage/[nodeId]`). Back-fills L1 Redis asynchronously (`<45ms`).
  - **Step 3 (L3 Origin Fetch)**: On miss, pulls master copy from Origin Server (`:5000`), caches to L2 Disk and L1 Redis, and serves client.
- **Fault-Tolerant Fallback**: Uses `ioredis` with auto-fallback to an internal `MockRedis` in-memory engine if Docker/Redis is unavailable.

### 5. Origin Server (`apps/origin` — Port 5000)
- **Role**: Authoritative Source of Truth.
- **Features**:
  - Manages master file blobs (`storage/origin/`) and JSON metadata index (`metadata.json`).
  - Computes MD5 checksums on upload.

### 6. Observability & User Applications
- **Admin Dashboard (`apps/dashboard` — Port 5173)**: Real-time dark-mode monitor featuring live heartbeat counters, interactive node cache inspectors, Redis key inspectors, master storage metrics, and live JSON step execution logs.
- **Client Simulator (`apps/client` — Port 5174)**: Geolocation selector, interactive request timeline, response metric tags, and direct file download trigger.

---

## 🌊 3-Tier Waterfall Caching Strategy

```text
[ Client Request ] ──► [ Edge Node ]
                            │
                            ▼
               ┌───────────────────────────┐
               │    1. L1 Redis Check      ├──────► [ HIT-REDIS ] ──► Return Buffer (<15ms)
               └────────────┬──────────────┘
                            │ (MISS)
                            ▼
               ┌───────────────────────────┐
               │     2. L2 Disk Check      ├──────► [ HIT-DISK ] ───► Backfill L1 Redis -> Return (<45ms)
               └────────────┬──────────────┘
                            │ (MISS)
                            ▼
               ┌───────────────────────────┐
               │    3. L3 Origin Fetch     ├──────► [ FETCH-ORIGIN ] ► Save L2 Disk -> Save L1 Redis -> Return
               └───────────────────────────┘
```

---

## 📁 Modular Project Structure

```text
edgeroute/
├── apps/                        # Workspace Microservices & Frontend Applications
│   ├── gateway/                 # API Gateway reverse proxy service (:3000)
│   ├── routing-engine/          # Haversine geo & load routing service (:3001)
│   ├── registry/                # Service Discovery & Socket.IO server (:3002)
│   ├── origin/                  # Origin Master Storage server (:5000)
│   ├── edge-node/               # Edge Node microservice template (:4001, :4002, :4003)
│   ├── dashboard/               # Admin Real-time Visualizer React App (:5173)
│   └── client/                  # Client Geolocation Simulator React App (:5174)
│
├── servers/                     # Standalone Microservice Targets (No Docker Required)
│   ├── core/                    # Consolidated Core Server (Origin + Registry + Routing + Gateway)
│   └── edge-node/               # Standalone Edge Node package with isolated storage & MockRedis
│
├── packages/                    # Shared Workspace Libraries
│   ├── shared-types/            # Shared TypeScript interfaces & IPC event contracts
│   ├── shared-utils/            # Haversine distance calculator & ID generators
│   └── logger/                  # Pino structured JSON logging wrapper
│
├── docker/                      # Infrastructure & Containerization
│   ├── docker-compose.yml       # Full microservice multi-container compose specification
│   ├── redis.yml                # Standalone 3-instance Redis container compose setup
│   └── Dockerfile.node          # Multi-stage Node.js container build file
│
├── start-servers.bat            # One-click Windows Standalone Batch Launcher
├── PROJECT_EXPLANATION.md       # Detailed System Design Architecture & Pitch Guide
└── SYSTEM_DESIGN_INTERVIEW_QUESTIONS.md # 50 Deep-Dive System Design Q&A Bank
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: `v18.x` or higher
- **Package Manager**: `npm` or `pnpm`
- **Docker Desktop** *(Optional — for containerized Redis setup)*

---

### Option A: Quick Standalone Mode (Recommended for Local Dev)

Launch all microservices, frontends, and optional Docker Redis containers with a single command:

```cmd
# Double click or run in terminal:
.\start-servers.bat
```

The script will automatically:
1. Check dependencies and build TypeScript packages.
2. Detect Docker (if running) and launch regional Redis containers (`localhost:6379`, `6380`, `6381`).
3. Start Core Server, Edge Nodes (Mumbai, Delhi, Singapore), Admin Dashboard, and Client App in separate windows.

---

### Option B: Full Docker Compose Mode

To run the entire system inside isolated Docker containers:

```bash
docker compose -f docker/docker-compose.yml up --build
```

---

## 🌐 Active Port Map & Endpoints

| Service | Port | Health Check | Description |
|---|---|---|---|
| **API Gateway** | `3000` | `http://localhost:3000/health` | Reverse Proxy & Ingress Endpoint (`/cdn/fetch`) |
| **Routing Engine** | `3001` | `http://localhost:3001/health` | Geo-distance & Load Calculation Engine |
| **Service Registry** | `3002` | `http://localhost:3002/health` | Discovery & Socket.IO Event Server |
| **Origin Server** | `5000` | `http://localhost:5000/health` | Master Storage & File Metadata Index |
| **Edge Mumbai** | `4001` | `http://localhost:4001/health` | Regional Edge Node (India South) |
| **Edge Delhi** | `4002` | `http://localhost:4002/health` | Regional Edge Node (India North) |
| **Edge Singapore** | `4003` | `http://localhost:4003/health` | Regional Edge Node (Southeast Asia) |
| **Admin Dashboard** | `5173` | `http://localhost:5173` | Real-time Observability & Cache Inspector UI |
| **Client App** | `5174` | `http://localhost:5174` | User Geolocation & CDN Download Simulator |

---

## 📚 Interview Preparation Resources

This project includes 2 dedicated interview preparation guides in the root directory:

- 📖 **[`PROJECT_EXPLANATION.md`](file:///c:/Users/hp/Desktop/edgeroute/PROJECT_EXPLANATION.md)** — Architectural pitch, component breakdown, Haversine equations, and end-to-end execution script.
- ❓ **[`SYSTEM_DESIGN_INTERVIEW_QUESTIONS.md`](file:///c:/Users/hp/Desktop/edgeroute/SYSTEM_DESIGN_INTERVIEW_QUESTIONS.md)** — 50 top system design interview questions (+ answers) covering caching, consistency, DDoS protection, circuit breakers, and scalability.

---

## 📜 License

Distributed under the **MIT License**. See `LICENSE` for more details.
