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

describe('xAI text explanation request', () => {
  it('posts a json_schema structured request to the xAI endpoint with the bearer key and text model', async () => {
    fetchMock.mockResolvedValueOnce(chatJson({ explanation: 'This looks like a prize scam.' }));
    const out = await explainScam(xai(), scamInput);
    expect(out).toEqual({ explanation: 'This looks like a prize scam.' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${XAI_BASE_URL}/chat/completions`);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer xai-test-key');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('grok-text');
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'scam_explanation', strict: true } });
    expect(body.store).toBe(false);
    // No tools / web search / x search are ever enabled.
    expect(body.tools).toBeUndefined();
  });
  it('rejects output that violates the schema and falls back to null', async () => {
    fetchMock.mockResolvedValueOnce(chatJson({ not_the_field: 'x' }));
    expect(await explainScam(xai(), scamInput)).toBeNull();
  });
  it('returns null on a model refusal', async () => {
    fetchMock.mockResolvedValueOnce(raw({ choices: [{ finish_reason: 'stop', message: { refusal: 'I cannot help.' } }] }));
    expect(await explainScam(xai(), scamInput)).toBeNull();
  });
  it('returns null on truncated output (finish_reason length)', async () => {
    fetchMock.mockResolvedValueOnce(chatJson({ explanation: 'partial' }, 'length'));
    expect(await explainScam(xai(), scamInput)).toBeNull();
  });
  it('returns null on malformed JSON content', async () => {
    fetchMock.mockResolvedValueOnce(raw({ choices: [{ finish_reason: 'stop', message: { content: '{ not json' } }] }));
    expect(await explainScam(xai(), scamInput)).toBeNull();
  });
});

describe('transient failures, retries and circuit breaker', () => {
  it('retries once on 429 and succeeds', async () => {
    fetchMock.mockResolvedValueOnce(status(429)).mockResolvedValueOnce(chatJson({ explanation: 'ok' }));
    expect(await explainScam(xai(), scamInput)).toEqual({ explanation: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('retries once on a network error and then gives up', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    expect(await explainScam(xai(), scamInput)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('does not retry on a 4xx (e.g. unsupported model) and records a failure', async () => {
    fetchMock.mockResolvedValueOnce(status(400));
    expect(await explainScam(xai(), scamInput)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('opens the text breaker after three failures without disabling vision', async () => {
    fetchMock.mockResolvedValue(status(400));
    const cfg = xai();
    for (let i = 0; i < 3; i++) await explainScam(cfg, scamInput);
    expect(aiAvailable(cfg)).toBe(false); // text backed off
    expect(aiVisionAvailable(cfg)).toBe(true); // vision unaffected
    fetchMock.mockClear();
    // No further text requests are attempted while the breaker is open.
    expect(await explainScam(cfg, scamInput)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
