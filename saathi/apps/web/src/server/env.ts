import 'server-only';
import { parseEnv, PublicKeyRegistry, WebEnv } from '@saathi/contracts/env';

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
export function integrationsStatus() {
  const e = env();
  return {
    telegram: !!(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_WEBHOOK_SECRET),
    ai: !!(e.ANTHROPIC_API_KEY && e.AI_MODEL),
    storage: e.OBJECT_STORAGE_DRIVER,
    demo: e.DEMO_MODE === 'on',
  };
}
