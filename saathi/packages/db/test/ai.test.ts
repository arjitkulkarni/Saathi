import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiConfigFromEnv, XAI_BASE_URL } from '@saathi/contracts/env';
import { __resetAiState, aiAvailable, aiConfigured, aiVisionAvailable, aiVisionConfigured, aiVisionSupportsFormat, explainIncident, explainScam, extractTextFromImage } from '../src/services/ai';

// The adapter is exercised with a mocked fetch so no real xAI request is ever made.

const XAI_ENV = { AI_PROVIDER: 'xai' as const, XAI_API_KEY: 'xai-test-key', AI_MODEL: 'grok-text', AI_VISION_MODEL: 'grok-vision' };
const xai = () => aiConfigFromEnv(XAI_ENV, 1000);

function chatJson(obj: unknown, finish_reason = 'stop') {
  return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason, message: { content: JSON.stringify(obj) } }] }) };
}
function raw(res: unknown) {
  return { ok: true, status: 200, json: async () => res };
}
function status(code: number) {
  return { ok: code < 400, status: code, json: async () => ({ error: 'x' }) };
}
