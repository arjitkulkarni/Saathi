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

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  __resetAiState();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const scamInput = { language: 'English', text: 'win a prize click here', verdictLabel: 'Suspicious', reasons: ['urgent money request'], uncertainty: ['sender unknown'] };

describe('aiConfigFromEnv provider mapping', () => {
  it('selects the xAI key and official base URL for the xai provider', () => {
    const cfg = aiConfigFromEnv({ AI_PROVIDER: 'xai', XAI_API_KEY: 'k1', ANTHROPIC_API_KEY: 'k2', AI_MODEL: 'm', AI_VISION_MODEL: 'v' });
    expect(cfg).toMatchObject({ provider: 'xai', apiKey: 'k1', model: 'm', visionModel: 'v', baseUrl: XAI_BASE_URL });
  });
  it('selects the Anthropic key for the anthropic provider and never the xAI key', () => {
    const cfg = aiConfigFromEnv({ AI_PROVIDER: 'anthropic', XAI_API_KEY: 'k1', ANTHROPIC_API_KEY: 'k2', AI_MODEL: 'm' });
    expect(cfg.apiKey).toBe('k2');
    expect(cfg.baseUrl).toBeUndefined();
  });
  it('defaults to xai when no provider is set', () => {
    expect(aiConfigFromEnv({ XAI_API_KEY: 'k', AI_MODEL: 'm' }).provider).toBe('xai');
  });
});

describe('configuration and availability checks', () => {
  it('reports text configured only when key and model are present', () => {
    expect(aiConfigured(xai())).toBe(true);
    expect(aiConfigured(aiConfigFromEnv({ AI_PROVIDER: 'xai', XAI_API_KEY: 'k' }))).toBe(false); // no model
    expect(aiConfigured(aiConfigFromEnv({ AI_PROVIDER: 'xai', AI_MODEL: 'm' }))).toBe(false); // no key
  });
  it('requires an explicit vision model for xAI but reuses the text model for Anthropic', () => {
    expect(aiVisionConfigured(xai())).toBe(true);
    expect(aiVisionConfigured(aiConfigFromEnv({ AI_PROVIDER: 'xai', XAI_API_KEY: 'k', AI_MODEL: 'm' }))).toBe(false);
    expect(aiVisionConfigured(aiConfigFromEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', AI_MODEL: 'm' }))).toBe(true);
  });
  it('makes no request and returns null when not configured', async () => {
    const cfg = aiConfigFromEnv({ AI_PROVIDER: 'xai' }, 1000); // no key/model
    expect(aiAvailable(cfg)).toBe(false);
    expect(await explainScam(cfg, scamInput)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
