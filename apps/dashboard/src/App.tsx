import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import { Server, HardDrive, Cpu, Database, Activity, Upload, Terminal, RefreshCw, Layers } from 'lucide-react';
import { NodeHeartbeat, StepLogEvent, FileMetadata } from '@edgemesh/shared-types';

const REGISTRY_URL = 'http://localhost:3002';
const ORIGIN_URL = 'http://localhost:5000';

export default function App() {
  const [nodes, setNodes] = useState<Map<string, NodeHeartbeat>>(new Map());
  const [logs, setLogs] = useState<StepLogEvent[]>([]);
  const [originFiles, setOriginFiles] = useState<FileMetadata[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [redisKeys, setRedisKeys] = useState<Record<string, Array<{ key: string; ttl: number; type: string }>>>({});
  
  // New States
  const [selectedNode, setSelectedNode] = useState<{ id: string; name: string; port: number } | null>(null);
  const [selectedNodeFiles, setSelectedNodeFiles] = useState<Array<{ name: string; sizeBytes: number; createdAt: string }>>([]);
  const [lastActive, setLastActive] = useState<Record<string, number>>({});
  const [heartbeatPulses, setHeartbeatPulses] = useState<Record<string, boolean>>({});
  const [ticker, setTicker] = useState(0);

  const logContainerRef = useRef<HTMLDivElement>(null);

  // Default Node Specs for initial display
  const defaultNodes: Array<{ id: string; name: string; region: string; port: number }> = [
    { id: 'edge-mumbai', name: 'Edge Mumbai', region: 'Mumbai, India', port: 4001 },
    { id: 'edge-delhi', name: 'Edge Delhi', region: 'Delhi, India', port: 4002 },
    { id: 'edge-singapore', name: 'Edge Singapore', region: 'Singapore', port: 4003 },
  ];

  useEffect(() => {
    fetchOriginFiles();
    fetchRedisKeys();

    const socket = io(REGISTRY_URL);

    socket.on('connect', () => {
      addLog({
        id: 'init_' + Date.now(),
        timestamp: Date.now(),
        service: 'REGISTRY',
        title: 'Connected to Service Registry',
        details: `Socket.IO connected to ${REGISTRY_URL}`,
        level: 'info',
      });
    });

    socket.on('node_heartbeat', (heartbeat: NodeHeartbeat) => {
      setNodes((prev) => {
        const next = new Map(prev);
        next.set(heartbeat.nodeId, heartbeat);
        return next;
      });
      // Update last active
      setLastActive((prev) => ({ ...prev, [heartbeat.nodeId]: Date.now() }));
      // Trigger heartbeat pulse flash
      setHeartbeatPulses((prev) => ({ ...prev, [heartbeat.nodeId]: true }));
      setTimeout(() => {
        setHeartbeatPulses((prev) => ({ ...prev, [heartbeat.nodeId]: false }));
      }, 800);
    });

    socket.on('node_status_change', (heartbeat: NodeHeartbeat) => {
      setNodes((prev) => {
        const next = new Map(prev);
        next.set(heartbeat.nodeId, heartbeat);
        return next;
      });
    });

    socket.on('step_log', (event: StepLogEvent) => {
      addLog(event);
    });

    const interval = setInterval(fetchRedisKeys, 4000);
    const tickInterval = setInterval(() => setTicker((t) => t + 1), 1000);

    return () => {
      socket.disconnect();
      clearInterval(interval);
      clearInterval(tickInterval);
    };
  }, []);

  // Fetch selected node files when selected node changes
  useEffect(() => {
    if (selectedNode) {
      fetchSelectedNodeFiles(selectedNode);
    }
  }, [selectedNode, ticker]);

  const addLog = (event: StepLogEvent) => {
    setLogs((prev) => [event, ...prev.slice(0, 99)]);
  };

  const fetchOriginFiles = async () => {
    try {
      const res = await axios.get(`${ORIGIN_URL}/api/files`);
      setOriginFiles(res.data.files || []);
    } catch {
      // Origin server offline fallback
    }
  };

  const fetchRedisKeys = async () => {
    for (const node of defaultNodes) {
      try {
        const res = await axios.get(`http://localhost:${node.port}/api/redis/keys`, { timeout: 1500 });
        setRedisKeys((prev) => ({ ...prev, [node.id]: res.data.keys || [] }));
      } catch {
        setRedisKeys((prev) => ({ ...prev, [node.id]: [] }));
      }
    }
  };

  const fetchSelectedNodeFiles = async (node: { id: string; name: string; port: number }) => {
    try {
      const res = await axios.get(`http://localhost:${node.port}/api/files`, { timeout: 1500 });
      setSelectedNodeFiles(res.data.files || []);
    } catch {
      setSelectedNodeFiles([]);
    }
  };

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      await axios.post(`${ORIGIN_URL}/api/files/upload`, formData);
      setSelectedFile(null);
      await fetchOriginFiles();
      addLog({
        id: 'up_' + Date.now(),
        timestamp: Date.now(),
        service: 'ORIGIN',
        title: 'Master File Uploaded',
        details: `Uploaded '${selectedFile.name}' to Origin Server`,
        level: 'success',
      });
    } catch (err) {
      alert('Upload failed: ' + (err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
  };

  const formatConsoleLog = (l: StepLogEvent) => {
    const date = new Date(l.timestamp);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    const timestampStr = `${month} ${day} ${hours}:${minutes}:${seconds}.${ms} (UTC +05:30)`;

    const payload = JSON.stringify({
      message: l.title,
      details: l.details,
      service: l.service,
      requestId: l.requestId,
      ...(l.metadata || {})
    });

    return { timestampStr, payload };
  };

  return (
    <div className="min-h-screen bg-black text-white p-6 font-mono border-t-2 border-white">
      {/* Header */}
      <header className="flex items-center justify-between pb-6 mb-6 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-bold tracking-wider uppercase flex items-center gap-2">
            <Activity className="w-5 h-5 text-white animate-pulse" />
            EDGEMESH // ADMIN MONITOR
          </h1>
          <p className="text-xs text-zinc-500 mt-1">Multi-Region CDN System & Cache Observer</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-zinc-900 border border-zinc-700 rounded-none">
            <span className="w-2 h-2 rounded-full bg-white animate-ping" />
            SYSTEM ACTIVE
          </span>
          <button
            onClick={() => {
              fetchOriginFiles();
              fetchRedisKeys();
            }}
            className="p-1.5 bg-zinc-900 border border-zinc-700 hover:bg-white hover:text-black transition"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Section 1: Edge Nodes Status Cards */}
        {defaultNodes.map((n) => {
          const hb = nodes.get(n.id);
          const isHealthy = hb && hb.status !== 'UNHEALTHY';
          const loadPct = hb?.loadPercentage || 0;
          const redisMb = hb?.redisMemoryUsedMb || 0;
          const diskBytes = hb?.storageUsedBytes || 0;
          const isSelected = selectedNode?.id === n.id;

          const lastActiveTime = lastActive[n.id];
          const activeSecAgo = lastActiveTime ? Math.round((Date.now() - lastActiveTime) / 1000) : null;

          return (
            <div
              key={n.id}
              onClick={() => setSelectedNode(n)}
              className={`bg-black border cursor-pointer transition-all p-5 relative select-none hover:border-zinc-400 ${
                isSelected ? 'border-white ring-1 ring-white' : 'border-zinc-800'
              }`}
            >
              {/* Pulse Indicator */}
              <div className="absolute top-2 right-2 flex items-center gap-1">
                <span className="text-[9px] text-zinc-500 font-mono uppercase">
                  {activeSecAgo !== null ? `${activeSecAgo}s ago` : 'no ping'}
                </span>
                <span
                  className={`w-2.5 h-2.5 rounded-full border transition-all duration-300 ${
                    heartbeatPulses[n.id]
                      ? 'bg-red-500 scale-125 border-white animate-ping'
                      : isHealthy
                      ? 'bg-emerald-500 border-zinc-900'
                      : 'bg-zinc-700 border-zinc-800'
                  }`}
                />
              </div>

              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-sm uppercase tracking-wide flex items-center gap-2">
                    <Server className="w-4 h-4 text-zinc-400" />
                    {n.name}
                  </h3>
                  <span className="text-xs text-zinc-500">{n.region}</span>
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 border uppercase ${
                    isHealthy
                      ? 'border-white bg-white text-black font-bold'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-500'
                  }`}
                >
                  {isHealthy ? hb?.status || 'ONLINE' : 'OFFLINE'}
                </span>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <div className="flex justify-between text-zinc-400 mb-1">
                    <span className="flex items-center gap-1">
                      <Cpu className="w-3.5 h-3.5" /> CPU Load
                    </span>
                    <span>{loadPct}%</span>
                  </div>
                  <div className="w-full bg-zinc-900 h-1.5">
                    <div className="bg-white h-1.5 transition-all duration-300" style={{ width: `${loadPct}%` }} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-900 text-zinc-400">
                  <div>
                    <span className="block text-[10px] text-zinc-600 uppercase">Redis Memory</span>
                    <span className="text-white font-bold">{redisMb} MB</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-zinc-600 uppercase font-mono">Disk Storage</span>
                    <span className="text-white font-bold">{formatBytes(diskBytes)}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-zinc-900 flex justify-between text-[11px]">
                  <span className="text-zinc-500">Hits / Misses</span>
                  <span className="text-white">
                    {hb?.cacheHitCount || 0} / {hb?.cacheMissCount || 0}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Edge Server Disk Storage Drawer (Conditional) */}
      {selectedNode && (
        <div className="bg-black border border-white p-5 mb-6">
          <div className="flex justify-between items-center border-b border-zinc-800 pb-2 mb-4">
            <h2 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-4 h-4 text-white animate-pulse" />
              {selectedNode.name} Cache Local Storage
            </h2>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-[10px] border border-zinc-700 px-2 py-0.5 hover:bg-white hover:text-black transition"
            >
              CLOSE INSPECTOR
            </button>
          </div>
          {selectedNodeFiles.length === 0 ? (
            <div className="text-xs text-zinc-500 italic">No files cached on this node's disk.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {selectedNodeFiles.map((file) => (
                <div key={file.name} className="border border-zinc-800 bg-zinc-950 p-3 text-xs">
                  <div className="text-white font-bold truncate mb-1">{file.name}</div>
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>Size: {formatBytes(file.sizeBytes)}</span>
                    <span>Cached: {new Date(file.createdAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Middle Grid: Redis Inspector & Origin File Manager */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Redis Keys Inspector */}
        <div className="bg-black border border-zinc-800 p-5">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-zinc-800 pb-2">
            <Database className="w-4 h-4 text-white" />
            Level 1 Redis Cache Keys
          </h2>
          <div className="space-y-4 max-h-56 overflow-y-auto pr-1">
            {defaultNodes.map((n) => {
              const keys = redisKeys[n.id] || [];
              return (
                <div key={n.id} className="text-xs">
                  <div className="text-zinc-500 text-[10px] uppercase mb-1">{n.name} ({keys.length} keys)</div>
                  {keys.length === 0 ? (
                    <div className="text-zinc-700 italic text-[11px]">No cached keys</div>
                  ) : (
                    <div className="space-y-1">
                      {keys.map((k) => (
                        <div key={k.key} className="flex justify-between bg-zinc-900/60 p-1.5 border border-zinc-800/80 text-[11px]">
                          <span className="text-white font-mono">{k.key}</span>
                          <span className="text-zinc-500 font-mono">TTL: {k.ttl}s</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Origin Storage File Manager */}
        <div className="bg-black border border-zinc-800 p-5">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-zinc-800 pb-2">
            <HardDrive className="w-4 h-4 text-white" />
            Origin Master Storage ({originFiles.length} files)
          </h2>

          <form onSubmit={handleFileUpload} className="flex gap-2 mb-4">
            <input
              type="file"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              className="text-xs file:mr-3 file:py-1 file:px-3 file:border file:border-zinc-700 file:bg-zinc-900 file:text-white hover:file:bg-white hover:file:text-black text-zinc-400 cursor-pointer flex-1"
            />
            <button
              type="submit"
              disabled={!selectedFile || uploading}
              className="px-4 py-1 bg-white text-black text-xs font-bold uppercase disabled:opacity-30 hover:bg-zinc-200 flex items-center gap-1"
            >
              <Upload className="w-3.5 h-3.5" />
              {uploading ? 'UPLOADING...' : 'UPLOAD'}
            </button>
          </form>

          <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
            {originFiles.length === 0 ? (
              <div className="text-xs text-zinc-600 italic">No files in Origin storage yet. Upload a file above.</div>
            ) : (
              originFiles.map((f) => (
                <div key={f.fileId} className="flex justify-between items-center bg-zinc-900 p-2 border border-zinc-800 text-xs">
                  <div>
                    <span className="text-white font-bold block">{f.originalName}</span>
                    <span className="text-[10px] text-zinc-500">ID: {f.fileId}</span>
                  </div>
                  <span className="text-[11px] text-zinc-400 font-mono">{formatBytes(f.sizeBytes)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Bottom Console: Live System Step Log Feed */}
      <div className="bg-black border border-zinc-800 p-5">
        <div className="flex justify-between items-center mb-3 border-b border-zinc-800 pb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
            <Terminal className="w-4 h-4 text-white" />
            Realtime Infrastructure Step Execution Console
          </h2>
          <span className="text-[10px] text-zinc-500 font-mono">{logs.length} EVENTS RECORDED</span>
        </div>

        <div ref={logContainerRef} className="h-64 overflow-y-auto space-y-1.5 font-mono text-[11px] bg-zinc-950 p-3 border border-zinc-900">
          {logs.length === 0 ? (
            <div className="text-zinc-700 italic">Waiting for microservice step logs... Initiate a request from Client App.</div>
          ) : (
            logs.map((l) => {
              const { timestampStr, payload } = formatConsoleLog(l);
              return (
                <div key={l.id} className="flex items-start gap-2 border-b border-zinc-900/50 pb-1">
                  <span className="text-zinc-500 shrink-0 font-mono">{timestampStr}</span>
                  <span className="text-emerald-400 break-all font-mono">{payload}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
