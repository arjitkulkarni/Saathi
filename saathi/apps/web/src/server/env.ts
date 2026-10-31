import 'server-only';
import { aiConfigFromEnv, parseEnv, PublicKeyRegistry, WebEnv } from '@saathi/contracts/env';
import { aiConfigured, aiVisionConfigured } from '@saathi/db';

// Only server modules read process.env. Nothing here is exposed via NEXT_PUBLIC_*.
let cached: WebEnv | null = null;
export function env(): WebEnv {
  if (!cached) cached = parseEnv(WebEnv, process.env, 'Saathi web');
  return cached;
}

export function commandKeys() {
  return PublicKeyRegistry.parse(JSON.parse(env().COMMAND_PUBLIC_KEYS));
}
export function evidenceKeys() {
  return PublicKeyRegistry.parse(JSON.parse(env().EVIDENCE_PUBLIC_KEYS));
}
export function aiConfig(timeoutMs?: number) {
  return aiConfigFromEnv(env(), timeoutMs);
}
export function integrationsStatus() {
  const e = env();
  const cfg = aiConfigFromEnv(e);
  return {
    telegram: !!(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_WEBHOOK_SECRET),
    // Configured capability (no provider request is made to render status).
    ai: aiConfigured(cfg),
    aiVision: aiVisionConfigured(cfg),
    aiProvider: cfg.provider,
    storage: e.OBJECT_STORAGE_DRIVER,
    demo: e.DEMO_MODE === 'on',
  };
}
