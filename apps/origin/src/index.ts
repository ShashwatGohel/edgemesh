import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createLogger } from '@edgemesh/logger';
import { FileMetadata } from '@edgemesh/shared-types';

const logger = createLogger('origin-server');
const app = express();
const PORT = process.env.PORT || 5000;

const STORAGE_DIR = path.resolve(process.cwd(), 'storage');
const METADATA_FILE = path.resolve(STORAGE_DIR, 'metadata.json');

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// Helper to read metadata store
function readMetadataStore(): Record<string, FileMetadata> {
  if (!fs.existsSync(METADATA_FILE)) {
    return {};
  }
  try {
    const content = fs.readFileSync(METADATA_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

// Helper to save metadata store
function writeMetadataStore(data: Record<string, FileMetadata>): void {
  fs.writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// Multer storage config
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, STORAGE_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueId = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueId}${ext}`);
  },
});

const upload = multer({ storage });

app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, _res, next) => {
  logger.info({ method: req.method, url: req.url }, 'Incoming request to Origin');
  next();
});

// Health endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'UP', service: 'origin-server', timestamp: new Date().toISOString() });
});

// Upload API
app.post('/api/files/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided in request' });
  }

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

  logger.info({ fileId, originalName: metadata.originalName }, 'File successfully uploaded to Origin master storage');
  res.status(201).json({ message: 'File uploaded successfully', metadata });
});

// List all files API
app.get('/api/files', (_req, res) => {
  const store = readMetadataStore();
  const fileList = Object.values(store);
  res.json({ count: fileList.length, files: fileList });
});

// Serve / Download File API
app.get('/api/files/:fileId', (req, res) => {
  const { fileId } = req.params;
  const store = readMetadataStore();
  const metadata = store[fileId];

  if (!metadata) {
    return res.status(404).json({ error: 'File not found in Origin storage' });
  }

  // Find exact file in storage directory matching fileId prefix
  const files = fs.readdirSync(STORAGE_DIR);
  const matchedFileName = files.find((f) => path.parse(f).name === fileId);

  if (!matchedFileName) {
    return res.status(404).json({ error: 'Physical file missing on disk' });
  }

  const filePath = path.join(STORAGE_DIR, matchedFileName);
  res.setHeader('Content-Type', metadata.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${metadata.originalName}"`);
  res.setHeader('X-Origin-File-Id', fileId);

  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);
});

// Delete File API
app.delete('/api/files/:fileId', (req, res) => {
  const { fileId } = req.params;
  const store = readMetadataStore();
  const metadata = store[fileId];

  if (!metadata) {
    return res.status(404).json({ error: 'File not found' });
  }

  const files = fs.readdirSync(STORAGE_DIR);
  const matchedFileName = files.find((f) => path.parse(f).name === fileId);

  if (matchedFileName) {
    fs.unlinkSync(path.join(STORAGE_DIR, matchedFileName));
  }

  delete store[fileId];
  writeMetadataStore(store);

  logger.info({ fileId }, 'File deleted from Origin master storage');
  res.json({ message: 'File deleted successfully', fileId });
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, '🚀 Origin Server is running and listening');
});
