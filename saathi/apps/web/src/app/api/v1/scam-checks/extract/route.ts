import { randomUUID } from 'node:crypto';
import { SaathiError } from '@saathi/contracts';
import { can } from '@saathi/domain';
import { aiVisionAvailable, aiVisionConfigured, aiVisionSupportsFormat, extractTextFromImage } from '@saathi/db';
import { userRoute } from '@/server/api';
import { objectStore } from '@/server/db';
import { aiConfig } from '@/server/env';

const MAX_BYTES = 3 * 1024 * 1024;

/** Validate MIME from file content (magic bytes), size and dimensions (build.md Ph13.1). */
function sniff(b: Buffer): { type: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number } | null {
  if (b.length > 24 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i < b.length - 9; ) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3) return { type: 'image/jpeg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return null;
  }
  if (b.length > 30 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return { type: 'image/webp', width: 1, height: 1 };
  return null;
}

/**
 * Store a screenshot privately and, only with explicit consent to send the image to the
 * external AI, extract its text through the optional vision adapter. The extracted text is
 * returned for review/redaction; nothing is assessed until the user submits the reviewed text.
 * The image is never transmitted without `consent`, which is distinct from the consent to send
 * reviewed text for an explanation (handled at submit time).
 */
export const POST = userRoute(async ({ req, ctx }) => {
  if (!can(ctx.actor.role, 'scam.submit')) throw new SaathiError('FORBIDDEN', 'You cannot submit messages.');
  const form = await req.formData();
  const file = form.get('file');
  const consent = form.get('consent') === 'true';
  if (!(file instanceof File)) throw new SaathiError('VALIDATION_FAILED', 'Choose an image file.');
  if (file.size > MAX_BYTES) throw new SaathiError('VALIDATION_FAILED', 'The image is larger than 3 MB.');
  const buf = Buffer.from(await file.arrayBuffer());
  const info = sniff(buf);
  if (!info) throw new SaathiError('VALIDATION_FAILED', 'Only PNG, JPEG or WebP screenshots are accepted.');
  if (info.width > 8000 || info.height > 8000) throw new SaathiError('VALIDATION_FAILED', 'The image dimensions are too large.');
  const ref = `scam/${ctx.actor.orgId}/${randomUUID()}`;
  await objectStore().put(ref, buf, info.type);
  const base = { attachmentRef: ref, text: null, legible: null };
  const cfg = aiConfig(25_000);
  // No image transmission without explicit OCR consent.
  if (!consent) return { ...base, extraction: 'not_requested' as const };
  if (!aiVisionConfigured(cfg)) return { ...base, extraction: 'unavailable' as const };
  // The provider cannot read this format (e.g. WebP on xAI): keep the stored image, ask for pasted text.
  if (!aiVisionSupportsFormat(cfg, info.type)) return { ...base, extraction: 'unsupported_format' as const };
  // Configured but currently backed off by the breaker.
  if (!aiVisionAvailable(cfg)) return { ...base, extraction: 'unavailable' as const };
  const r = await extractTextFromImage(cfg, { data: buf, mediaType: info.type });
  return { attachmentRef: ref, text: r?.text ?? null, legible: r?.legible ?? null, extraction: r ? ('done' as const) : ('failed' as const) };
});
