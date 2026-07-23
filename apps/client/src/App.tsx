import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { MapPin, Download, FileText, CheckCircle2, Clock, Zap, ArrowRight, RefreshCcw } from 'lucide-react';
import { FileMetadata } from '@edgemesh/shared-types';

const GATEWAY_URL = 'http://localhost:3000';
const ORIGIN_URL = 'http://localhost:5000';

interface PresetLocation {
  name: string;
  lat: number;
  lng: number;
}

const PRESETS: PresetLocation[] = [
  { name: 'Mumbai', lat: 19.0760, lng: 72.8777 },
  { name: 'Delhi', lat: 28.7041, lng: 77.1025 },
  { name: 'Singapore', lat: 1.3521, lng: 103.8198 },
  { name: 'London', lat: 51.5074, lng: -0.1278 },
  { name: 'Frankfurt', lat: 50.1109, lng: 8.6821 },
  { name: 'New York', lat: 40.7128, lng: -74.0060 },
  { name: 'Tokyo', lat: 35.6762, lng: 139.6503 },
  { name: 'Sydney', lat: -33.8688, lng: 151.2093 },
];

interface ExecutionStep {
  step: number;
  label: string;
  detail: string;
  status: 'pending' | 'running' | 'completed';
}

export default function App() {
  const [lat, setLat] = useState<string>('19.0760');
  const [lng, setLng] = useState<string>('72.8777');
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [downloadBlobUrl, setDownloadBlobUrl] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<{
    cacheStatus: string;
    selectedNodeId: string;
    selectedNodeName: string;
    distanceKm: string;
    totalLatencyMs: string;
  } | null>(null);

  const [timeline, setTimeline] = useState<ExecutionStep[]>([
    { step: 1, label: 'Client Request Ingress', detail: 'Waiting to start...', status: 'pending' },
    { step: 2, label: 'API Gateway Forwarding', detail: 'Waiting to start...', status: 'pending' },
    { step: 3, label: 'Routing Engine Decision', detail: 'Waiting to start...', status: 'pending' },
    { step: 4, label: 'Edge Node Redis L1 Check', detail: 'Waiting to start...', status: 'pending' },
    { step: 5, label: 'Edge Node Disk L2 Check', detail: 'Waiting to start...', status: 'pending' },
    { step: 6, label: 'Origin L3 Fetch (If Miss)', detail: 'Waiting to start...', status: 'pending' },
    { step: 7, label: 'Egress Delivery to Client', detail: 'Waiting to start...', status: 'pending' },
  ]);

  useEffect(() => {
    fetchOriginFiles();
  }, []);

  const fetchOriginFiles = async () => {
    try {
      const res = await axios.get(`${ORIGIN_URL}/api/files`);
      const fileList: FileMetadata[] = res.data.files || [];
      setFiles(fileList);
      if (fileList.length > 0 && !selectedFileId) {
        setSelectedFileId(fileList[0].fileId);
      }
    } catch {
      // Fallback sample file ID if origin server is offline
      setFiles([{ fileId: 'sample-doc', originalName: 'demo-sample-file.txt', mimeType: 'text/plain', sizeBytes: 1024, checksum: '', createdAt: '' }]);
      setSelectedFileId('sample-doc');
    }
  };

  const handleFetch = async () => {
    if (!selectedFileId) return;

    setLoading(true);
    setMetrics(null);
    setDownloadBlobUrl(null);

    const clientLat = parseFloat(lat) || 0;
    const clientLng = parseFloat(lng) || 0;

    // Reset timeline state
    setTimeline([
      { step: 1, label: 'Client Request Ingress', detail: `Requesting file '${selectedFileId}' from coords (${clientLat.toFixed(2)}, ${clientLng.toFixed(2)})`, status: 'running' },
      { step: 2, label: 'API Gateway Forwarding', detail: 'Gateway received request', status: 'pending' },
      { step: 3, label: 'Routing Engine Decision', detail: 'Calculating Haversine distance across nodes...', status: 'pending' },
      { step: 4, label: 'Edge Node Redis L1 Check', detail: 'Checking fast in-memory Redis cache...', status: 'pending' },
      { step: 5, label: 'Edge Node Disk L2 Check', detail: 'Checking local node storage...', status: 'pending' },
      { step: 6, label: 'Origin L3 Fetch (If Miss)', detail: 'Fetching from master storage on miss...', status: 'pending' },
      { step: 7, label: 'Egress Delivery to Client', detail: 'Final response delivery...', status: 'pending' },
    ]);

    const startTime = Date.now();

    try {
      const response = await axios.get(`${GATEWAY_URL}/cdn/fetch`, {
        params: { fileId: selectedFileId, lat: clientLat, lng: clientLng },
        responseType: 'blob',
      });

      const cacheStatus = (response.headers['x-cache'] as string) || 'MISS-FETCHED-FROM-ORIGIN';
      const selectedNodeId = (response.headers['x-selected-node-id'] as string) || 'edge-mumbai';
      const selectedNodeName = (response.headers['x-selected-node-name'] as string) || 'Edge Mumbai';
      const distanceKm = (response.headers['x-distance-km'] as string) || '12.4';
      const totalLatencyMs = (response.headers['x-total-latency-ms'] as string) || (Date.now() - startTime).toString();

      // Create downloadable file object URL
      const mimeTypeStr = typeof response.headers['content-type'] === 'string' ? response.headers['content-type'] : 'application/octet-stream';
      const blob = new Blob([response.data], { type: mimeTypeStr });
      const url = URL.createObjectURL(blob);
      setDownloadBlobUrl(url);

      setMetrics({
        cacheStatus,
        selectedNodeId,
        selectedNodeName,
        distanceKm,
        totalLatencyMs,
      });

      // Update timeline to all completed
      setTimeline([
        { step: 1, label: 'Client Request Ingress', detail: `Sent request from coordinates (${clientLat.toFixed(4)}, ${clientLng.toFixed(4)})`, status: 'completed' },
        { step: 2, label: 'API Gateway Forwarding', detail: `Forwarded via Gateway (${GATEWAY_URL})`, status: 'completed' },
        { step: 3, label: 'Routing Engine Decision', detail: `Selected Node: ${selectedNodeName} (${distanceKm} km)`, status: 'completed' },
        { step: 4, label: 'Edge Node Redis L1 Check', detail: cacheStatus === 'HIT-REDIS' ? '🎯 REDIS CACHE HIT' : 'Redis Cache MISS', status: 'completed' },
        { step: 5, label: 'Edge Node Disk L2 Check', detail: cacheStatus === 'HIT-DISK' ? '🎯 DISK CACHE HIT' : 'Disk Storage MISS', status: 'completed' },
        { step: 6, label: 'Origin L3 Fetch (If Miss)', detail: cacheStatus.startsWith('MISS') ? '☁️ Fetched from Origin Master Storage' : 'Bypassed (Already cached at Edge)', status: 'completed' },
        { step: 7, label: 'Egress Delivery to Client', detail: `Completed in ${totalLatencyMs}ms. Status: ${cacheStatus}`, status: 'completed' },
      ]);
    } catch (err) {
      setTimeline((prev) =>
        prev.map((item) => ({ ...item, status: 'completed', detail: item.step === 7 ? `Error: ${(err as Error).message}` : item.detail }))
      );
      alert('Request failed: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-6 font-mono border-t-2 border-white">
      {/* Minimal Header */}
      <header className="flex items-center justify-between pb-6 mb-6 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-bold tracking-wider uppercase flex items-center gap-2">
            <Zap className="w-5 h-5 text-white" />
            EDGEMESH // CLIENT REQUEST SIMULATOR
          </h1>
          <p className="text-xs text-zinc-500 mt-1">Simulate User Geolocation Requests & Trace CDN Routing</p>
        </div>
        <button
          onClick={fetchOriginFiles}
          className="p-1.5 bg-zinc-900 border border-zinc-700 hover:bg-white hover:text-black transition text-xs flex items-center gap-1"
        >
          <RefreshCcw className="w-3.5 h-3.5" /> REFRESH FILES
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Form & Coordinates */}
        <div className="space-y-6">
          {/* Location Picker */}
          <div className="bg-black border border-zinc-800 p-5">
            <h2 className="text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-zinc-800 pb-2">
              <MapPin className="w-4 h-4 text-white" />
              1. Select Client Geolocation
            </h2>

            {/* Presets */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {PRESETS.map((p) => {
                const isActive = parseFloat(lat) === p.lat && parseFloat(lng) === p.lng;
                return (
                  <button
                    key={p.name}
                    onClick={() => {
                      setLat(p.lat.toString());
                      setLng(p.lng.toString());
                    }}
                    className={`p-2 text-xs border uppercase font-mono transition ${
                      isActive
                        ? 'border-white bg-white text-black font-bold'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>

            {/* Custom Coordinates Input */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[10px] text-zinc-500 uppercase mb-1">Latitude</label>
                <input
                  type="text"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-white font-mono focus:border-white focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 uppercase mb-1">Longitude</label>
                <input
                  type="text"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-white font-mono focus:border-white focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* File Picker & Execute Button */}
          <div className="bg-black border border-zinc-800 p-5">
            <h2 className="text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-zinc-800 pb-2">
              <FileText className="w-4 h-4 text-white" />
              2. Select Target File & Download
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] text-zinc-500 uppercase mb-1">Target File</label>
                <select
                  value={selectedFileId}
                  onChange={(e) => setSelectedFileId(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-white font-mono focus:border-white focus:outline-none"
                >
                  {files.map((f) => (
                    <option key={f.fileId} value={f.fileId}>
                      {f.originalName} ({f.fileId})
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleFetch}
                disabled={loading || !selectedFileId}
                className="w-full py-3 bg-white text-black font-bold uppercase text-xs hover:bg-zinc-200 transition disabled:opacity-30 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>ROUTING & FETCHING...</>
                ) : (
                  <>
                    <Download className="w-4 h-4" /> INITIATE CDN REQUEST
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Metrics Results Card */}
          {metrics && (
            <div className="bg-black border border-white p-5">
              <h2 className="text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-zinc-800 pb-2">
                <CheckCircle2 className="w-4 h-4 text-white" />
                Response Metrics
              </h2>

              <div className="space-y-3 text-xs">
                <div className="flex justify-between border-b border-zinc-900 pb-1">
                  <span className="text-zinc-500">Target Node</span>
                  <span className="text-white font-bold">{metrics.selectedNodeName} ({metrics.selectedNodeId})</span>
                </div>
                <div className="flex justify-between border-b border-zinc-900 pb-1">
                  <span className="text-zinc-500">Haversine Distance</span>
                  <span className="text-white font-mono">{metrics.distanceKm} km</span>
                </div>
                <div className="flex justify-between border-b border-zinc-900 pb-1">
                  <span className="text-zinc-500">Total Latency</span>
                  <span className="text-white font-mono">{metrics.totalLatencyMs} ms</span>
                </div>
                <div className="flex justify-between items-center pt-1">
                  <span className="text-zinc-500">Cache Status</span>
                  <span className="px-2 py-0.5 bg-white text-black font-bold text-[10px] uppercase">
                    {metrics.cacheStatus}
                  </span>
                </div>

                {downloadBlobUrl && (
                  <div className="pt-3 border-t border-zinc-800">
                    <a
                      href={downloadBlobUrl}
                      download={`cdn-download-${selectedFileId}`}
                      className="block text-center py-2 border border-zinc-700 bg-zinc-900 hover:bg-white hover:text-black text-xs font-bold uppercase transition"
                    >
                      DOWNLOAD FILE CONTENT
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right 2 Columns: Live Request Execution Timeline */}
        <div className="lg:col-span-2 bg-black border border-zinc-800 p-5">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-zinc-800 pb-2">
            <Clock className="w-4 h-4 text-white" />
            Live Request Step Execution Timeline
          </h2>

          <div className="space-y-3 font-mono text-xs">
            {timeline.map((t) => (
              <div
                key={t.step}
                className={`p-3 border transition-all ${
                  t.status === 'completed'
                    ? 'border-zinc-700 bg-zinc-950 text-white'
                    : t.status === 'running'
                    ? 'border-white bg-zinc-900 text-white'
                    : 'border-zinc-900 bg-black text-zinc-600'
                }`}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="font-bold flex items-center gap-2">
                    <span
                      className={`w-5 h-5 flex items-center justify-center text-[10px] border ${
                        t.status === 'completed'
                          ? 'border-white bg-white text-black font-bold'
                          : 'border-zinc-800 text-zinc-500'
                      }`}
                    >
                      {t.step}
                    </span>
                    {t.label}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider">
                    {t.status === 'completed' ? '✓ DONE' : t.status === 'running' ? '⚡ RUNNING' : 'PENDING'}
                  </span>
                </div>
                <p className="text-zinc-400 text-[11px] pl-7">{t.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
