import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createLogger, FileMetadata } from './shared';

const logger = createLogger('origin-server');

const STORAGE_DIR = path.resolve(process.cwd(), 'storage', 'origin');
const METADATA_FILE = path.resolve(STORAGE_DIR, 'metadata.json');

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function readMetadataStore(): Record<string, FileMetadata> {
  if (!fs.existsSync(METADATA_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeMetadataStore(data: Record<string, FileMetadata>): void {
  fs.writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, STORAGE_DIR),
  filename: (_req, file, cb) => {
    const uniqueId = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueId}${ext}`);
  },
});

const upload = multer({ storage });

export function createOriginRouter() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'UP', service: 'origin-server', timestamp: new Date().toISOString() });
  });

  app.get('/', (_req, res) => {
    res.json({
      status: 'UP',
      service: 'origin-server',
      description: 'EdgeMesh CDN Origin Master Storage Server',
      endpoints: {
        health: '/health',
        files: '/api/files',
        upload: '/api/files/upload'
      }
    });
  });

  app.post('/api/files/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const fileId = path.parse(req.file.filename).name;
    const fileBuffer = fs.readFileSync(req.file.path);
    const checksum = crypto.createHash('md5').update(fileBuffer).digest('hex');
    const metadata: FileMetadata = {
      fileId,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      checksum,
      createdAt: new Date().toISOString(),
    };
    const store = readMetadataStore();
    store[fileId] = metadata;
    writeMetadataStore(store);
    logger.info({ fileId, originalName: metadata.originalName }, 'File uploaded to Origin');
    res.status(201).json({ message: 'File uploaded successfully', metadata });
  });

  app.get('/api/files', (_req, res) => {
    const store = readMetadataStore();
    res.json({ count: Object.values(store).length, files: Object.values(store) });
  });

  app.get('/api/files/:fileId', (req, res) => {
    const { fileId } = req.params;
    const store = readMetadataStore();
    const metadata = store[fileId];
    if (!metadata) return res.status(404).json({ error: 'File not found' });
    const files = fs.readdirSync(STORAGE_DIR);
    const matched = files.find((f) => path.parse(f).name === fileId);
    if (!matched) return res.status(404).json({ error: 'Physical file missing on disk' });
    const filePath = path.join(STORAGE_DIR, matched);
    res.setHeader('Content-Type', metadata.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${metadata.originalName}"`);
    res.setHeader('X-Origin-File-Id', fileId);
    fs.createReadStream(filePath).pipe(res);
  });

  app.delete('/api/files/:fileId', (req, res) => {
    const { fileId } = req.params;
    const store = readMetadataStore();
    if (!store[fileId]) return res.status(404).json({ error: 'File not found' });
    const files = fs.readdirSync(STORAGE_DIR);
    const matched = files.find((f) => path.parse(f).name === fileId);
    if (matched) fs.unlinkSync(path.join(STORAGE_DIR, matched));
    delete store[fileId];
    writeMetadataStore(store);
    logger.info({ fileId }, 'File deleted from Origin');
    res.json({ message: 'File deleted', fileId });
  });

  return app;
}

export function startOrigin(port: number) {
  const app = createOriginRouter();
  app.listen(port, () => logger.info({ port }, '[ORIGIN] Origin Server running'));
}
