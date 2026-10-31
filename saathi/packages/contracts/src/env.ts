import { z } from 'zod';

// Environment contract (build.md Ph01). Optional integrations are validated when present
// and reported as unavailable when absent; they never fall back to fabricated success.

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

export const CommonEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  APP_ORIGIN: z.string().url().default('http://localhost:3000'),
  DEMO_MODE: z.enum(['off', 'on']).default('off'),
});

export const WebEnv = CommonEnv.extend({
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().url(),
  DEVICE_SECRET_ENCRYPTION_KEY: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'DEVICE_SECRET_ENCRYPTION_KEY must be 32 bytes base64url'),
  COMMAND_PUBLIC_KEYS: z.string().min(2, 'COMMAND_PUBLIC_KEYS must list the pinned command verification keys'),
  EVIDENCE_PUBLIC_KEYS: z.string().min(2, 'EVIDENCE_PUBLIC_KEYS must list the trusted evidence keys'),
  DOWNLOAD_TOKEN_SECRET: z.string().min(32),
  SCAM_FINGERPRINT_SECRET: z.string().min(32),
  SENSITIVE_AUTH_MAX_AGE_MINUTES: z.coerce.number().int().min(5).max(10080).default(720),
  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_WEBHOOK_SECRET: optional,
  TELEGRAM_BOT_USERNAME: optional,
  OBJECT_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  OBJECT_STORAGE_LOCAL_DIR: z.string().default('.local/objects'),
  OBJECT_STORAGE_BUCKET: optional,
  OBJECT_STORAGE_REGION: optional,
  OBJECT_STORAGE_ENDPOINT: optional,
  OBJECT_STORAGE_ACCESS_KEY_ID: optional,
  OBJECT_STORAGE_SECRET_ACCESS_KEY: optional,
  AI_PROVIDER: z.enum(['xai', 'anthropic']).default('xai'),
  XAI_API_KEY: optional,
  ANTHROPIC_API_KEY: optional,
  AI_MODEL: optional,
  AI_VISION_MODEL: optional,
});
export type WebEnv = z.infer<typeof WebEnv>;

export const WorkerEnv = CommonEnv.extend({
  DATABASE_URL_WORKER: optional,
  WORKER_ID: z.string().min(1).default('worker-1'),
  COMMAND_SIGNING_KEY_ID: z.string().min(1),
  COMMAND_SIGNING_PRIVATE_KEY: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'COMMAND_SIGNING_PRIVATE_KEY must be a 32-byte base64url seed'),
  EVIDENCE_SIGNING_KEY_ID: z.string().min(1),
  EVIDENCE_SIGNING_PRIVATE_KEY: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'EVIDENCE_SIGNING_PRIVATE_KEY must be a 32-byte base64url seed'),
  COMMAND_TTL_SECONDS: z.coerce.number().int().min(15).max(600).default(60),
  TELEGRAM_BOT_TOKEN: optional,
  AI_PROVIDER: z.enum(['xai', 'anthropic']).default('xai'),
  XAI_API_KEY: optional,
  ANTHROPIC_API_KEY: optional,
  AI_MODEL: optional,
  AI_VISION_MODEL: optional,
  OBJECT_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  OBJECT_STORAGE_LOCAL_DIR: z.string().default('.local/objects'),
  OBJECT_STORAGE_BUCKET: optional,
  OBJECT_STORAGE_REGION: optional,
  OBJECT_STORAGE_ENDPOINT: optional,
  OBJECT_STORAGE_ACCESS_KEY_ID: optional,
  OBJECT_STORAGE_SECRET_ACCESS_KEY: optional,
  OTS_BACKEND: z.enum(['native', 'python', 'disabled']).default('native'),
  OTS_CALENDAR_ALLOWLIST: z
    .string()
    .default('https://alice.btc.calendar.opentimestamps.org,https://bob.btc.calendar.opentimestamps.org,https://finney.calendar.eternitywall.com'),
  OTS_PYTHON_BIN: z.string().default('python3'),
  BITCOIN_VERIFIER: z.enum(['none', 'rpc', 'esplora']).default('none'),
  BITCOIN_RPC_URL: optional,
  BITCOIN_RPC_USER: optional,
  BITCOIN_RPC_PASSWORD: optional,
  BITCOIN_ESPLORA_URL: optional,
  RETENTION_TELEMETRY_DAYS: z.coerce.number().int().min(1).default(7),
  RETENTION_MESSAGE_IMAGE_HOURS: z.coerce.number().int().min(1).default(24),
  RETENTION_REPORT_DAYS: z.coerce.number().int().min(1).default(30),
});
export type WorkerEnv = z.infer<typeof WorkerEnv>;

export function parseEnv<T extends z.ZodType>(schema: T, source: Record<string, string | undefined>, label: string): z.infer<T> {
  const r = schema.safeParse(source);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`${label} configuration is invalid or incomplete:\n${lines.join('\n')}\nSee saathi/.env.example.`);
  }
  return r.data;
}

// Optional AI provider configuration, mapped once from the environment so route handlers and
// the worker never re-derive the credential/model mapping. The real key is never logged.
export type AiProvider = 'xai' | 'anthropic';
export type AiConfig = {
  provider: AiProvider;
  apiKey?: string;
  /** Model used for text explanations. */
  model?: string;
  /** Model used for screenshot text extraction (vision). Not assumed equal to the text model. */
  visionModel?: string;
  /** OpenAI-compatible base URL; defaults to the official xAI endpoint for the xai provider. */
  baseUrl?: string;
  timeoutMs?: number;
};

type AiEnvFields = {
  AI_PROVIDER?: AiProvider;
  XAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  AI_MODEL?: string;
  AI_VISION_MODEL?: string;
};

/** The default OpenAI-compatible endpoint for xAI (https://docs.x.ai). */
export const XAI_BASE_URL = 'https://api.x.ai/v1';

/** Pinned public key registry encoded as JSON: [{"keyId":"...","publicKeyHex":"..."}] */
export const PublicKeyRegistry = z.array(
  z.object({ keyId: z.string(), publicKeyHex: z.string().regex(/^[0-9a-f]{64}$/), validFrom: z.string().optional(), retiredAt: z.string().optional() }),
);
export type PublicKeyRegistry = z.infer<typeof PublicKeyRegistry>;
