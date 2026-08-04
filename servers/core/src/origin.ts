import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import axios from 'axios';
import { createLogger, FileMetadata } from './shared';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';

const logger = createLogger('origin-server');
const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:3002';

const STORAGE_DIR = path.resolve(process.cwd(), 'storage', 'origin');
const METADATA_FILE = path.resolve(STORAGE_DIR, 'metadata.json');

// AWS Configuration
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || 'edgemesh-origin-master-bucket';
const CLOUDFRONT_DISTRIBUTION_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID || 'E1234567890MOCK';

const hasAwsCredentials = !!(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY);
const AWS_SIMULATION_MODE = !hasAwsCredentials;

let s3Client: S3Client | null = null;
let cloudFrontClient: CloudFrontClient | null = null;

if (!AWS_SIMULATION_MODE) {
  s3Client = new S3Client({
    region: AWS_REGION,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID!,
      secretAccessKey: AWS_SECRET_ACCESS_KEY!,
    },
  });
  cloudFrontClient = new CloudFrontClient({
    region: AWS_REGION,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID!,
      secretAccessKey: AWS_SECRET_ACCESS_KEY!,
    },
  });
  logger.info({ bucket: AWS_S3_BUCKET, region: AWS_REGION }, 'AWS Integration: REAL S3 & CloudFront mode initialized');
} else {
  logger.info({ bucket: AWS_S3_BUCKET, region: AWS_REGION }, 'AWS Integration: SIMULATION mode active (no credentials)');
}

async function emitAwsLog(title: string, details: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') {
  try {
    await axios.post(`${REGISTRY_URL}/api/logs/emit`, {
      id: `aws_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      service: 'ORIGIN',
      title,
      details,
      level,
    }, { timeout: 1000 });
  } catch {
    // Ignore registry logging failure
  }
}

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
    res.json({
      status: 'UP',
      service: 'origin-server',
      timestamp: new Date().toISOString(),
      aws: {
        mode: AWS_SIMULATION_MODE ? 'SIMULATED' : 'REAL',
        bucket: AWS_S3_BUCKET,
        region: AWS_REGION,
        distributionId: CLOUDFRONT_DISTRIBUTION_ID,
      }
    });
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

  app.post('/api/files/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const fileId = path.parse(req.file.filename).name;
    const fileBuffer = fs.readFileSync(req.file.path);
    const ext = path.extname(req.file.originalname);
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

    // AWS S3 Integration
    if (AWS_SIMULATION_MODE) {
      await emitAwsLog(
        'AWS S3: PutObjectCommand [SIMULATED]',
        `client.send(new PutObjectCommand({\n  Bucket: "${AWS_S3_BUCKET}",\n  Key: "${fileId}${ext}",\n  ContentType: "${metadata.mimeType}"\n}))\nFile saved to simulated S3 storage (local disk fallback).`,
        'success'
      );
    } else {
      try {
        await s3Client!.send(new PutObjectCommand({
          Bucket: AWS_S3_BUCKET,
          Key: `${fileId}${ext}`,
          Body: fileBuffer,
          ContentType: metadata.mimeType,
        }));
        await emitAwsLog(
          'AWS S3: PutObjectCommand [REAL]',
          `Successfully uploaded '${metadata.originalName}' to S3 bucket '${AWS_S3_BUCKET}' as Key: '${fileId}${ext}'`,
          'success'
        );
      } catch (err) {
        logger.error(err, 'Failed S3 upload');
        await emitAwsLog(
          'AWS S3: PutObjectCommand [FAILED]',
          `S3 Upload Failed: ${(err as Error).message}`,
          'error'
        );
        return res.status(500).json({ error: 'S3 upload failed: ' + (err as Error).message });
      }
    }

    // AWS CloudFront Invalidation
    if (AWS_SIMULATION_MODE) {
      await emitAwsLog(
        'AWS CloudFront: CreateInvalidationCommand [SIMULATED]',
        `client.send(new CreateInvalidationCommand({\n  DistributionId: "${CLOUDFRONT_DISTRIBUTION_ID}",\n  InvalidationBatch: {\n    Paths: ["/*"]\n  }\n}))`,
        'info'
      );
    } else {
      try {
        const invRes = await cloudFrontClient!.send(new CreateInvalidationCommand({
          DistributionId: CLOUDFRONT_DISTRIBUTION_ID,
          InvalidationBatch: {
            CallerReference: `inv_${Date.now()}`,
            Paths: {
              Quantity: 1,
              Items: ['/*'],
            },
          },
        }));
        await emitAwsLog(
          'AWS CloudFront: CreateInvalidationCommand [REAL]',
          `Created CloudFront cache invalidation (ID: ${invRes.Invalidation?.Id}) for paths: ['/*']`,
          'success'
        );
      } catch (err) {
        logger.error(err, 'Failed CloudFront invalidation');
        await emitAwsLog(
          'AWS CloudFront: CreateInvalidationCommand [FAILED]',
          `CloudFront Invalidation Failed: ${(err as Error).message}`,
          'warn'
        );
      }
    }

    // Proactively broadcast uploaded file to all active Edge Nodes
    const fileBase64 = fileBuffer.toString('base64');
    (async () => {
      try {
        const registryRes = await axios.get(`${REGISTRY_URL}/api/nodes/healthy`, { timeout: 2000 });
        const healthyNodes = registryRes.data.nodes || [];
        logger.info({ nodeCount: healthyNodes.length, fileId }, 'Broadcasting uploaded file to active Edge Nodes');

        for (const nodeObj of healthyNodes) {
          const targetNodeUrl = nodeObj.config?.baseUrl || nodeObj.baseUrl;
          if (targetNodeUrl) {
            try {
              await axios.post(`${targetNodeUrl}/api/files/broadcast`, {
                fileId,
                originalName: metadata.originalName,
                mimeType: metadata.mimeType,
                fileBase64,
              }, { timeout: 4000 });
              logger.info({ targetNodeUrl, fileId }, 'Successfully broadcasted file to Edge Node');
            } catch (bErr) {
              logger.warn({ targetNodeUrl, error: (bErr as Error).message }, 'Failed to broadcast file to Edge Node');
            }
          }
        }
      } catch (err) {
        logger.warn({ error: (err as Error).message }, 'Could not fetch healthy nodes for proactive broadcast');
      }
    })();

    res.status(201).json({ message: 'File uploaded successfully', metadata });
  });

  app.get('/api/files', (_req, res) => {
    const store = readMetadataStore();
    res.json({ count: Object.values(store).length, files: Object.values(store) });
  });

  app.get('/api/files/:fileId', async (req, res) => {
    const { fileId } = req.params;
    const store = readMetadataStore();
    const metadata = store[fileId];
    if (!metadata) return res.status(404).json({ error: 'File not found' });

    if (AWS_SIMULATION_MODE) {
      const files = fs.readdirSync(STORAGE_DIR);
      const matched = files.find((f) => path.parse(f).name === fileId);
      if (!matched) return res.status(404).json({ error: 'Physical file missing on disk' });

      await emitAwsLog(
        'AWS S3: GetObjectCommand [SIMULATED]',
        `client.send(new GetObjectCommand({\n  Bucket: "${AWS_S3_BUCKET}",\n  Key: "${matched}"\n}))\nStreaming file content from simulated S3 local storage.`,
        'info'
      );

      const filePath = path.join(STORAGE_DIR, matched);
      res.setHeader('Content-Type', metadata.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${metadata.originalName}"`);
      res.setHeader('X-Origin-File-Id', fileId);
      fs.createReadStream(filePath).pipe(res);
    } else {
      try {
        const ext = path.extname(metadata.originalName);
        const s3Key = `${fileId}${ext}`;

        await emitAwsLog(
          'AWS S3: GetObjectCommand [REAL]',
          `client.send(new GetObjectCommand({\n  Bucket: "${AWS_S3_BUCKET}",\n  Key: "${s3Key}"\n}))\nStreaming file directly from S3 bucket.`,
          'info'
        );

        const s3Res = await s3Client!.send(new GetObjectCommand({
          Bucket: AWS_S3_BUCKET,
          Key: s3Key,
        }));

        res.setHeader('Content-Type', metadata.mimeType);
        res.setHeader('Content-Disposition', `inline; filename="${metadata.originalName}"`);
        res.setHeader('X-Origin-File-Id', fileId);

        const bodyStream = s3Res.Body as any;
        bodyStream.pipe(res);
      } catch (err) {
        logger.error(err, 'Failed S3 fetch');
        await emitAwsLog(
          'AWS S3: GetObjectCommand [FAILED]',
          `S3 Fetch Failed: ${(err as Error).message}`,
          'error'
        );
        return res.status(500).json({ error: 'Failed to retrieve file from S3: ' + (err as Error).message });
      }
    }
  });

  app.delete('/api/files/:fileId', async (req, res) => {
    const { fileId } = req.params;
    const store = readMetadataStore();
    const metadata = store[fileId];
    if (!metadata) return res.status(404).json({ error: 'File not found' });

    const ext = path.extname(metadata.originalName);

    // AWS S3 Integration
    if (AWS_SIMULATION_MODE) {
      await emitAwsLog(
        'AWS S3: DeleteObjectCommand [SIMULATED]',
        `client.send(new DeleteObjectCommand({\n  Bucket: "${AWS_S3_BUCKET}",\n  Key: "${fileId}${ext}"\n}))`,
        'success'
      );
    } else {
      try {
        await s3Client!.send(new DeleteObjectCommand({
          Bucket: AWS_S3_BUCKET,
          Key: `${fileId}${ext}`,
        }));
        await emitAwsLog(
          'AWS S3: DeleteObjectCommand [REAL]',
          `Deleted key '${fileId}${ext}' from S3 bucket '${AWS_S3_BUCKET}'`,
          'success'
        );
      } catch (err) {
        logger.error(err, 'Failed S3 delete');
        await emitAwsLog(
          'AWS S3: DeleteObjectCommand [FAILED]',
          `S3 Delete Failed: ${(err as Error).message}`,
          'error'
        );
      }
    }

    // AWS CloudFront Invalidation (triggered on delete)
    if (AWS_SIMULATION_MODE) {
      await emitAwsLog(
        'AWS CloudFront: CreateInvalidationCommand [SIMULATED]',
        `client.send(new CreateInvalidationCommand({\n  DistributionId: "${CLOUDFRONT_DISTRIBUTION_ID}",\n  InvalidationBatch: {\n    Paths: ["/*"]\n  }\n}))`,
        'info'
      );
    } else {
      try {
        const invRes = await cloudFrontClient!.send(new CreateInvalidationCommand({
          DistributionId: CLOUDFRONT_DISTRIBUTION_ID,
          InvalidationBatch: {
            CallerReference: `inv_del_${Date.now()}`,
            Paths: {
              Quantity: 1,
              Items: ['/*'],
            },
          },
        }));
        await emitAwsLog(
          'AWS CloudFront: CreateInvalidationCommand [REAL]',
          `Created CloudFront cache invalidation (ID: ${invRes.Invalidation?.Id}) for paths: ['/*']`,
          'success'
        );
      } catch (err) {
        logger.warn({ error: (err as Error).message }, 'Failed CloudFront invalidation on delete');
      }
    }

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
