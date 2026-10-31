import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// Private object storage (build.md §2). `local` is a private directory for development and
// tests only (decision D-011); `s3` targets any S3-compatible bucket. Objects are never
// served from a public URL; Route Handlers authorize every download.

export type StorageConfig = {
  driver: 'local' | 's3';
  localDir: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export interface ObjectStore {
  readonly label: string;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function safeKey(key: string) {
  if (!/^[a-z0-9][a-z0-9/_.-]{0,300}$/i.test(key) || key.includes('..')) throw new Error('invalid object key');
  return key;
}

class LocalStore implements ObjectStore {
  readonly label = 'local private directory (development only)';
  constructor(private dir: string) {}
  private path(key: string) {
    return normalize(join(this.dir, safeKey(key)));
  }
  async put(key: string, body: Uint8Array) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body, { mode: 0o600 });
  }
  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}

class S3Store implements ObjectStore {
  readonly label: string;
  private clientPromise: Promise<import('@aws-sdk/client-s3').S3Client>;
  constructor(private cfg: StorageConfig) {
    this.label = `S3-compatible bucket ${cfg.bucket}`;
    this.clientPromise = import('@aws-sdk/client-s3').then(
      ({ S3Client }) =>
        new S3Client({
          region: cfg.region ?? 'auto',
          endpoint: cfg.endpoint,
          forcePathStyle: !!cfg.endpoint,
          credentials: cfg.accessKeyId && cfg.secretAccessKey ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } : undefined,
        }),
    );
  }
  async put(key: string, body: Uint8Array, contentType: string) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await (await this.clientPromise).send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: safeKey(key), Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' }));
  }
  async get(key: string) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    try {
      const r = await (await this.clientPromise).send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: safeKey(key) }));
      return r.Body ? new Uint8Array(await r.Body.transformToByteArray()) : null;
    } catch (e) {
      if ((e as { name?: string }).name === 'NoSuchKey') return null;
      throw e;
    }
  }
  async delete(key: string) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await (await this.clientPromise).send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: safeKey(key) }));
  }
}

export function createStore(cfg: StorageConfig): ObjectStore {
  if (cfg.driver === 's3') {
    if (!cfg.bucket) throw new Error('OBJECT_STORAGE_BUCKET is required when OBJECT_STORAGE_DRIVER=s3');
    return new S3Store(cfg);
  }
  return new LocalStore(isAbsolute(cfg.localDir) ? cfg.localDir : join(repoRoot, cfg.localDir));
}

export function storeFromEnv(env: Record<string, string | undefined>): ObjectStore {
  return createStore({
    driver: env.OBJECT_STORAGE_DRIVER === 's3' ? 's3' : 'local',
    localDir: env.OBJECT_STORAGE_LOCAL_DIR || '.local/objects',
    bucket: env.OBJECT_STORAGE_BUCKET || undefined,
    region: env.OBJECT_STORAGE_REGION || undefined,
    endpoint: env.OBJECT_STORAGE_ENDPOINT || undefined,
    accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID || undefined,
    secretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY || undefined,
  });
}
