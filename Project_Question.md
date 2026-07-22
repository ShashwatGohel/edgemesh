# EdgeMesh CDN Simulator — Top 50 System Design Interview Questions & Answers

This document contains **50 deep-dive System Design and Distributed Systems interview questions** (+ comprehensive answers) tailored specifically for your **EdgeMesh CDN** project.

---

## Category 1: High-Level Architecture & Core Flow

### Q1: What is EdgeMesh, and why did you build it?
**Answer:**
EdgeMesh is a distributed Content Delivery Network (CDN) simulator designed to demonstrate key backend and distributed systems concepts: API gateway reverse proxying, dynamic geolocation routing (Haversine formula + load balancing), service discovery with heartbeat monitoring, multi-tier caching (L1 Memory / L2 Disk / L3 Origin), and real-time system observability. I built it to understand how CDNs like Cloudflare and Akamai route, cache, and serve static assets at scale with sub-50ms latency.

---

### Q2: Walk me through what happens when a user requests a file.
**Answer:**
1. **Ingress**: The client sends `GET /cdn/fetch?fileId=X&lat=Y&lng=Z` to the API Gateway.
2. **Routing Query**: Gateway generates a unique `X-Request-ID` and asks the Routing Engine for the optimal edge node.
3. **Service Discovery**: Routing Engine fetches active `HEALTHY` nodes from the Service Registry.
4. **Geo & Load Math**: It calculates Haversine distance from client coordinates to each node, computes a composite score (`70% Distance + 30% CPU Load`), and selects the winner node.
5. **Proxy Execution**: Gateway proxies the request to `http://<edge-node>/files/X`.
6. **Waterfall Caching**:
   - **Step 6a (L1 Redis Check)**: On hit (`HIT-REDIS`), returns file content immediately.
   - **Step 6b (L2 Disk Check)**: On hit (`HIT-DISK`), reads local disk, asynchronously back-fills L1 Redis, and returns file.
   - **Step 6c (L3 Origin Miss)**: On miss (`MISS-FETCHED-FROM-ORIGIN`), fetches file from Origin Server (`port 5000`), caches it to L2 Disk and L1 Redis, and returns it.
7. **Egress**: Gateway streams the file back to the user with response metrics headers attached.

---

### Q3: How does your CDN handle Service Discovery and Edge Node failures?
**Answer:**
Every edge node registers with the **Service Registry** upon startup and sends a heartbeat ping every 3 seconds containing its CPU load, storage usage, and active connection count. The Service Registry runs a background **TTL Reaper** every 3 seconds. If a node fails to send a heartbeat for >10 seconds, the registry transitions its state to `UNHEALTHY` and broadcasts a Socket.IO event. The Routing Engine excludes `UNHEALTHY` nodes from routing calculations, instantly redirecting traffic to the next closest healthy node.

---

### Q4: Why did you separate the Gateway, Routing Engine, and Service Registry into microservices instead of a single monolith?
**Answer:**
Decoupling into microservices adheres to single-responsibility and enables independent scaling:
- **API Gateway**: I/O heavy (proxying files). Needs horizontal scaling based on client traffic.
- **Routing Engine**: CPU heavy (mathematical scoring). Can be scaled independently.
- **Service Registry**: State heavy (heartbeats & WebSockets). Kept lightweight to minimize latency during health checks.

---

### Q5: How do you handle Cross-Origin Resource Sharing (CORS) across your microservices?
**Answer:**
Since external web applications run on different ports (`5173`, `5174`), the API Gateway and Edge Nodes configure Express `cors()` middleware with `origin: '*'` and explicitly set `exposedHeaders: ['X-Cache', 'X-Selected-Node-ID', 'X-Selected-Node-Name', 'X-Distance-Km', 'X-Total-Latency-Ms', 'X-Request-ID']`. This enables frontend browser clients to read custom CDN routing headers safely.

---

## Category 2: Geo Routing & Algorithms

### Q6: How does the Routing Engine calculate physical distance?
**Answer:**
It uses the **Haversine Formula**, which computes the great-circle distance between two points on a sphere given their latitudes and longitudes:
$$d = 2R \arcsin \left( \sqrt{ \sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right) } \right)$$
where $R = 6371\text{ km}$ (Earth's radius).

---

### Q7: Why do you combine Haversine distance with CPU load instead of just picking the nearest node?
**Answer:**
Relying solely on geographic distance can cause **hot-spotting** — if 10,000 users in Mumbai request files simultaneously, Edge Mumbai would overload and crash while Edge Delhi sits idle. By scoring nodes with:
$$\text{Score} = (\text{Distance in km} \times 0.7) + (\text{CPU Load \%} \times 30)$$
the system naturally sheds load: if Mumbai's load spikes to 95%, its composite score increases, causing nearby traffic to gracefully spill over to Edge Delhi.

---

### Q8: How would real production CDNs route traffic compared to your Haversine approach?
**Answer:**
Production CDNs (Cloudflare, Fastly, AWS CloudFront) use **BGP Anycast** and **GeoDNS**:
- **BGP Anycast**: Multiple global edge locations announce the *same* IP address to internet routers. BGP automatically routes packets through the shortest network path (lowest AS path length).
- **GeoDNS**: Resolves domain names to IP addresses based on the user's DNS resolver IP.
My simulator uses client coordinate inputs + Haversine calculation to model this behavior in application code without requiring complex network routing infrastructure.

---

### Q9: What happens if client coordinates are invalid or missing?
**Answer:**
The API Gateway validates input coordinates upfront. If `lat` or `lng` are missing or invalid numbers, it rejects the request with HTTP 400 Bad Request. In production, if GeoIP lookup fails for a client's IP address, the Routing Engine defaults to a fallback default edge region or DNS resolver location.

---

### Q10: How would you scale the Routing Engine to handle 100,000 requests/sec?
**Answer:**
1. **In-Memory Caching / Geo-Hash Indexing**: Cache distance calculations for rounded latitude/longitude grid boxes (e.g. 5km x 5km geohashes) so Haversine isn't re-computed on every request.
2. **Stateless Scale-Out**: Run multiple stateless Routing Engine containers behind a round-robin load balancer.
3. **Local Registry Cache**: Keep a local cache of healthy nodes on each Routing Engine instance with a 1-second TTL to avoid hitting the Service Registry on every route query.

---

## Category 3: Caching, Consistency & Eviction Policies

### Q11: Explain your 3-tier waterfall caching mechanism.
**Answer:**
- **Tier 1 — L1 Redis Cache (Memory)**: Extremely fast (<15ms). Stores base64-encoded file buffers with a 5-minute TTL.
- **Tier 2 — L2 Disk Cache (SSD/Storage)**: Persistent regional storage on the edge node (`storage/[nodeId]/`). Served in <45ms.
- **Tier 3 — L3 Origin Server (Master)**: Authoritative source of truth (`port 5000`). Only fetched when L1 and L2 both miss.

---

### Q12: How do you handle Cache Invalidation (Cache Consistency)?
**Answer:**
1. **Time-To-Live (TTL)**: L1 Redis entries automatically expire after 300 seconds (5 minutes) using `EX 300`.
2. **Write-Through / Back-Filling**: When an edge node experiences an L2 Disk hit or L3 Origin miss, it asynchronously back-fills L1 Redis so subsequent requests land on L1.
3. **Invalidation Strategies (Production)**:
   - **Purge by URL/Key**: Origin sends invalidation webhooks to purge specific keys across all edge nodes.
   - **Purge by Surrogate-Key / Tag**: Group assets by tags (e.g. `tag:product-catalog`) and invalidate en masse.
   - **Versioned URLs (Cache Busting)**: Change asset filenames on release (`styles.v2.css`).

---

### Q13: How do you isolate cache storage between different edge nodes?
**Answer:**
Each edge node process resolves its local storage directory dynamically as `storage/[NODE_ID]` (e.g. `storage/edge-mumbai`, `storage/edge-singapore`). This ensures nodes running on the same host machine do not share files or report inaccurate disk metrics.

---

### Q14: What Eviction Policy would you use when an Edge Node disk fills up?
**Answer:**
- **LRU (Least Recently Used)**: Evicts files that haven't been requested for the longest time. Best for general static content.
- **LFU (Least Frequently Used)**: Evicts files with the lowest request count over a time window. Best when a small set of viral assets makes up most traffic.
- **FIFO (First In, First Out)**: Simple but inefficient for popular long-tail assets.
In production, LRU with a high-watermark threshold (e.g., trigger cleanup when disk reaches 85%) is standard.

---

### Q15: What is Consistent Hashing, and how could it benefit Edge Mesh?
**Answer:**
Consistent Hashing maps both cached keys and storage nodes onto a virtual hash ring (e.g., 0 to $2^{32}-1$). When nodes are added or removed, only $K/N$ keys need to be remapped (where $K$ is keys, $N$ is nodes). In EdgeMesh, consistent hashing could be used to route requests for a specific `fileId` to a deterministic edge node cluster, maximizing cache hit ratios across nodes.

---

## Category 4: Reliability, Resiliency & Fallbacks

### Q16: What happens if a Redis server goes down on an edge node?
**Answer:**
Edge nodes implement a **graceful degradation pattern**:
The node attempts an `ioredis` connection with a 2-second timeout. If Redis is down, it catches the error and silently switches to an internal **`MockRedis` class** — an in-memory JS `Map` implementing `get`, `set`, `keys`, and `ttl`. The node continues serving requests without crashing.

---

### Q17: What happens if the Origin Server crashes?
**Answer:**
1. **Cached assets continue serving**: Any requests hitting L1 Redis or L2 Disk on edge nodes complete normally (`HIT-REDIS` / `HIT-DISK`).
2. **Cache misses fail gracefully**: On an L3 cache miss, the edge node attempts to contact Origin. If Origin times out, the node catches the error, emits an `Origin Fetch Failed` log to the registry, and returns `HTTP 404/503` with latency metrics to the client.

---

### Q18: How do you prevent Thundering Herd Problem (Cache Stampede) on an Origin fetch?
**Answer:**
If 1,000 requests for a popular file land on an edge node simultaneously while it's not cached, all 1,000 requests might trigger parallel fetches to Origin.
**Solution**: Implement **Request Collapsing (Mutex / Single-Flight Locks)**. The first request acquires an in-flight lock for `fileId` and fetches from Origin; the remaining 999 requests block and wait on the first request's promise, reading from the newly populated cache once complete.

---

### Q19: What is the Circuit Breaker Pattern, and where would you apply it in EdgeMesh?
**Answer:**
A Circuit Breaker monitors external network calls (e.g. Edge Node -> Origin). If calls fail continuously (e.g., 5 consecutive timeouts), the circuit "opens" and immediately fails subsequent requests locally without attempting network calls. After a cooldown period, it enters a "half-open" state to probe health. In EdgeMesh, applying a circuit breaker between Edge Nodes and the Origin prevents edge nodes from hanging indefinitely when Origin is down.

---

### Q20: How do you prevent Single Points of Failure (SPOF) in EdgeMesh?
**Answer:**
- **API Gateway**: Run multiple gateway instances behind an AWS Application Load Balancer / NGINX.
- **Service Registry**: Cluster registries using a consensus algorithm (e.g., Raft via HashiCorp Consul or Etcd).
- **Origin Server**: Deploy active-passive or active-active Origin replicas behind S3 / Object Storage with multi-AZ replication.

---

## Category 5: Performance, Streaming & Large Files

### Q21: How would you handle large file streaming (e.g., 5GB video files)?
**Answer:**
1. **HTTP Range Requests (`Byte-Range`)**: Support `Range: bytes=0-1048576` headers so clients request 1MB chunks instead of downloading 5GB into memory.
2. **Node.js Streams**: Use `fs.createReadStream().pipe(res)` instead of reading full files into `Buffer` or memory, keeping RAM usage low ($<50\text{MB}$).
3. **Chunk-based Caching**: Store 1MB file chunks independently in L2 disk storage.

---

### Q22: What compression mechanisms can be added to improve CDN bandwidth?
**Answer:**
- **Gzip / Brotli compression**: Apply `compression()` middleware on Edge Nodes. Compress text, HTML, and JSON assets before streaming over HTTP.
- **Image Optimization**: On-the-fly WebP/AVIF format conversion based on client `Accept` headers.

---

### Q23: How do you reduce Time to First Byte (TTFB) on edge requests?
**Answer:**
1. **Keep-Alive Connections**: Maintain persistent HTTP/2 or TCP keep-alive sockets between Gateway, Edge Nodes, and Origin.
2. **In-Memory Caching (L1)**: Serve popular assets directly from L1 Redis RAM ($<10\text{ms}$).
3. **Zero-Copy Streaming**: Use `sendfile` kernel calls or stream pipes to eliminate buffer copying between user space and kernel space.

---

### Q24: How would you handle hot-spotting for viral assets?
**Answer:**
- **Edge Push / Pre-warming**: When an asset is marked "viral" or uploaded, broadcast it to all edge node L1 caches before users request it.
- **Dynamic Tiering (L1 Replication)**: Replicate viral Redis keys across multiple Redis read-replicas within the same edge location.

---

### Q25: How do you handle connection pooling between microservices?
**Answer:**
Use `axios` with an `http.Agent` configuring `keepAlive: true` and `maxSockets: 100`. This reuses underlying TCP connections across requests, eliminating connection setup/handshake overhead.

---

## Category 6: Observability, Logging & Tracing

### Q26: How does the Admin Dashboard update live without page refreshes?
**Answer:**
The Service Registry embeds a **Socket.IO server**. Whenever an edge node registers, sends a heartbeat, or processes a file step event (`StepLogEvent`), the node posts an event to `/api/logs/emit`. The registry broadcasts it to all connected Socket.IO frontend clients (`node_heartbeat`, `step_log`, `node_status_change`), triggering instant UI state updates.

---

### Q27: How do you trace a request across multiple microservices?
**Answer:**
Using **Distributed Tracing Header Propagation**:
When a request enters the API Gateway, it generates `X-Request-ID` (e.g. `req_1784699_a8b2`). This ID is passed in HTTP headers and query params across every downstream hop (Routing Engine -> Edge Node -> Origin). Every service includes `requestId` when logging step events (`StepLogEvent`), allowing the dashboard to group logs chronologically for that request.

---

### Q28: Why did you use Pino for logging instead of `console.log`?
**Answer:**
- **Performance**: Pino is one of the fastest Node.js loggers because it outputs structured JSON asynchronously.
- **Structured Output**: Machine-readable JSON logs (with `pid`, `hostname`, `level`, `timestamp`, `service`) make log aggregation and analysis in tools like ELK / Datadog straightforward.

---

### Q29: How would you collect and visualize metrics in a production setup?
**Answer:**
Integrate **Prometheus & Grafana**:
- Each microservice exposes a `/metrics` endpoint using `prom-client`.
- Prometheus scrapes metrics (request counts, latency histograms, cache hit/miss ratios, CPU/RAM usage) every 15 seconds.
- Grafana visualizes P50, P95, and P99 latency graphs and triggers PagerDuty alerts if cache hit ratio drops below 80%.

---

### Q30: What is the difference between Pull-based vs Push-based monitoring?
**Answer:**
- **Pull-based (Prometheus)**: Central monitoring server periodically scrapes `/metrics` endpoints from target services. Simpler to manage and prevents targets from crashing the monitoring server.
- **Push-based (Socket.IO / StatsD)**: Microservices actively send metric payloads to a central server. Used in EdgeMesh for instant UI event updates.

---

## Category 7: Security, Authentication & DDoS Protection

### Q31: How do you secure file uploads and downloads on the CDN?
**Answer:**
1. **Signed URLs (HMAC Token)**: Origin generates time-limited signed URLs (`/files/abc?token=hash&expires=1700000`). Edge nodes verify the signature before serving.
2. **Checksum Verification**: On upload, Origin computes MD5/SHA-256 hashes. Edge nodes verify checksums on download to ensure zero bit-rot during transfer.
3. **Rate Limiting**: Apply token-bucket rate limiting at the Gateway to prevent DDoS attacks.

---

### Q32: How would you protect EdgeMesh from DDoS attacks?
**Answer:**
1. **Rate Limiting**: Use Redis-backed sliding window rate limiting at the API Gateway (e.g., max 100 requests/minute per IP).
2. **Web Application Firewall (WAF)**: Inspect incoming HTTP traffic for malicious patterns (SQLi, XSS, bot scrapers).
3. **Anycast Scrubbing Center**: Route incoming traffic through scrubbing centers (like Cloudflare Magic Transit) to filter volumetric SYN/UDP floods before reaching Gateway.

---

### Q33: How do you protect edge nodes from cache poisoning attacks?
**Answer:**
Cache poisoning occurs when an attacker tricks an edge node into caching an invalid or malicious HTTP response.
**Prevention**:
- Include query parameters and header signatures strictly in the cache key definition (`cacheKey = fileId + variant`).
- Sanitize response headers received from Origin before storing them in L1 Redis / L2 Disk.

---

### Q34: How do you handle HTTPS / TLS termination in a CDN?
**Answer:**
TLS termination happens at the **API Gateway / Edge Node** reverse proxy layer. Edge nodes use wildcard SSL certificates (or SNI - Server Name Indication) to terminate HTTPS connections near the user, unencrypting traffic before processing cache lookups. Communication between Edge Nodes and Origin can use internal mutual TLS (mTLS).

---

### Q35: How do you handle Data Integrity across regional disk storage?
**Answer:**
Origin computes an MD5 or SHA-256 checksum during upload and stores it in file metadata. When an edge node downloads a file from Origin on cache miss, it re-computes the checksum of the received buffer before writing to L2 Disk. If the checksum mismatches, it discards the corrupted file.

---

## Category 8: Data Storage & Master Replication

### Q36: What database design choices did you make for file metadata?
**Answer:**
For the MVP, Origin stores metadata in a lightweight JSON store (`storage/origin/metadata.json`) indexed by `fileId`. In production, this would use **MongoDB** or **PostgreSQL** with a global read-replica configuration so edge nodes can rapidly query metadata without hitting the master database.

---

### Q37: What is the difference between Push-based vs Pull-based CDN Replication?
**Answer:**
- **Pull-based (Passive / Reactive)**: Content is copied to edge nodes *only* when a user requests it (cache miss). Used in EdgeMesh. Low storage cost, but first request experiences high latency (L3 fetch).
- **Push-based (Active / Proactive)**: Content is automatically pushed to all edge nodes immediately upon upload. Zero cache miss latency, but consumes high storage space across all regions.

---

### Q38: How would you implement Lazy Regional Replication in EdgeMesh?
**Answer:**
When a file is uploaded to Origin in Mumbai, Origin pushes background messages to a pub/sub queue (e.g. RabbitMQ / Kafka). Edge nodes in high-traffic regions (Delhi, Singapore) listen to the queue and download/cache the file during off-peak hours before local users even request it.

---

### Q39: How would you handle metadata synchronization across global regions?
**Answer:**
Use a globally distributed database with low-latency read replicas (e.g., AWS DynamoDB Global Tables or CockroachDB). Writes go to the primary region, while edge nodes read metadata from their nearest regional read replica.

---

### Q40: What happens if two users upload files with the exact same name?
**Answer:**
Origin generates a unique 8-byte hexadecimal `fileId` (e.g., `b05a2a941d27ca19`) using crypto random bytes and appends the extension. The original file name is preserved inside `FileMetadata.originalName`. This prevents collisions on disk.

---

## Category 9: Scalability & Production Readiness

### Q41: How would you scale EdgeMesh to handle 1,000,000 requests/second?
**Answer:**
1. **Load Balancing**: Deploy NGINX or AWS ALB in front of API Gateways.
2. **Horizontal Edge Scaling**: Run multiple edge node instances behind local reverse proxies in each region.
3. **Stateless Core**: Ensure API Gateway and Routing Engine remain completely stateless so they scale horizontally.
4. **Redis Sentinel / Cluster**: Replace standalone Redis with Redis Cluster for high availability and automatic sharding.
5. **CDN Anycast Routing**: Replace HTTP-based routing with BGP Anycast IP routing.

---

### Q42: Why did you build both a Docker setup and a standalone `.bat` launcher?
**Answer:**
- **Docker Compose**: Simulates production containerized isolation (isolated networks, containerized Redis, containerized Node microservices).
- **Standalone Batch Script**: Provides instant developer setup on Windows systems without requiring Docker Desktop to be running, using `MockRedis` as an in-memory fallback.

---

### Q43: How do you manage monorepo packages in this project?
**Answer:**
Using **pnpm workspaces**:
- Shared packages (`packages/shared-types`, `packages/shared-utils`, `packages/logger`) are linked locally.
- Microservices (`apps/gateway`, `apps/registry`, etc.) import shared packages directly without publishing to npm, ensuring dry code reuse and unified TypeScript type definitions.

---

### Q44: What build tools and compilers did you use, and why?
**Answer:**
- **TypeScript (`tsc`)**: Enforces compile-time type safety across shared IPC contracts, API payloads, and microservice handlers.
- **`tsx` / Node.js**: Used during development for rapid hot-reloading without manual re-compilation steps.
- **Vite**: Used for React frontend builds due to fast ES-module bundling and instant HMR.

---

### Q45: How would you deploy EdgeMesh to Kubernetes (k8s)?
**Answer:**
1. **Deployments**: Wrap Gateway, Routing Engine, and Service Registry as Kubernetes Deployments with Horizontal Pod Autoscalers (HPA based on CPU/RAM).
2. **StatefulSets**: Run Redis Cluster instances as StatefulSets with PersistentVolumeClaims (PVCs).
3. **DaemonSets**: Run Edge Nodes as DaemonSets on regional worker node pools.
4. **Ingress Controller**: Use NGINX Ingress Controller for TLS termination and routing.

---

## Category 10: System Trade-offs & Deep Reflection

### Q46: What are the main engineering trade-offs you made in this project?
**Answer:**
1. **Pull-based vs Push-based Caching**: Prioritized pull-based caching to save storage space, accepting a latency penalty on the very first request (cache miss).
2. **Haversine Math vs BGP Anycast**: Used client coordinates and Haversine math at application level instead of setting up complex BGP Anycast networking, keeping the project runnable on local developer machines.
3. **In-Memory Service Registry vs Distributed Consensus**: Used an in-memory Map for registry state to achieve sub-millisecond lookup times, accepting that registry restarts clear active session history.

---

### Q47: What was the hardest bug you encountered while building EdgeMesh, and how did you resolve it?
**Answer:**
**The CORS & HTTP 302 Redirect Bug**: Originally, the API Gateway issued an HTTP 302 redirect sending browser clients directly to edge node ports (e.g. `http://localhost:4001/files/abc`). When `axios` in the browser followed the 302 redirect cross-origin, the browser blocked the request due to CORS policy and stripped response headers.
**Fix**: Converted the Gateway from HTTP 302 redirect to a **server-side reverse proxy** (`axios` fetch server-to-server), passing the buffer back to the browser while explicitly exposing response metric headers (`X-Cache`, `X-Distance-Km`) via `cors({ exposedHeaders: [...] })`.

---

### Q48: How do you ensure zero downtime during Edge Node deployments (Rolling Upgrades)?
**Answer:**
1. **Health Check Grace Period**: When a node shuts down, it sends a deregistration signal or stops responding to heartbeats.
2. **Registry TTL Timeout**: The registry marks the node `UNHEALTHY` within 10 seconds, stopping new traffic routing.
3. **Graceful Shutdown**: The node completes active in-flight requests (`activeConnections === 0`) before terminating the process.
4. **Rolling Update**: Bring up the new node version, register with Registry, and verify health checks pass before serving live traffic.

---

### Q49: If you had 2 more weeks on this project, what features would you build next?
**Answer:**
1. **Lazy Regional Replication**: Pre-warm edge node caches based on predictive analytics or user upload region.
2. **ETag & Conditional Headers (`304 Not Modified`)**: Support `If-None-Match` so browser caches don't re-download unchanged files.
3. **Metrics Dashboard (Prometheus + Grafana)**: Export cache hit ratio graphs, P99 latency distribution, and bandwidth consumption over t### Q50: How has building EdgeMesh changed your understanding of distributed systems?
**Answer:**
Building EdgeMesh demystified how cloud giants like Cloudflare deliver sub-50ms web performance. It taught me that real-world system design isn't just about picking fast databases — it's about managing state, handling network degradation gracefully, balancing load intelligently across physical geography, and establishing end-to-end observability across microservice boundaries.oss microservice boundaries.
