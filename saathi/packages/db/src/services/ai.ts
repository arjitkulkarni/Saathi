import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { type AiConfig, XAI_BASE_URL } from '@saathi/contracts/env';

// Optional AI assistance (build.md Ph13). Explanation and OCR only: the model receives
// minimized facts, has no tools, no credentials and no path to authorization. Untrusted
// message text is passed as clearly delimited data. Output is schema-validated and rendered
// as plain text. Any failure returns null and the deterministic templates remain.
//
// The default provider is xAI (Grok) over its OpenAI-compatible endpoint; Anthropic is kept
// as an explicitly selected alternative. A failed xAI request is never retried on another
// provider. No web search, X search, tool use or URL fetching is ever enabled.

export type { AiConfig, AiProvider } from '@saathi/contracts/env';

export const ExplanationSchema = z.object({
  summary: z.string().max(900),
  checks: z.array(z.string().max(200)).max(4),
});
export const ScamExplanationSchema = z.object({ explanation: z.string().max(900) });
export const OcrSchema = z.object({ text: z.string().max(5000), legible: z.boolean() });
