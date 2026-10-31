import { msg, type Msg, type ScamVerdict } from '@saathi/contracts';

// Deterministic message assessment (build.md Ph13). Weak indicators (a short link,
// unusual TLD or urgent wording alone) are risk signals, not proof, and never justify a
// "safe" label. Submitted URLs are parsed, never fetched.

export const SCAM_RULES_VERSION = 1;

const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rb.gy', 'ow.ly', 'shorturl.at', 'tiny.cc', 'rebrand.ly', 'buff.ly', 's.id', 't.ly']);
const UNUSUAL_TLDS = new Set(['zip', 'mov', 'top', 'xyz', 'icu', 'click', 'link', 'live', 'rest', 'cam', 'quest', 'buzz', 'cfd', 'sbs', 'monster', 'gq', 'tk', 'ml', 'cf', 'ga']);
const BRANDS = ['paypal', 'amazon', 'microsoft', 'office365', 'google', 'apple', 'sbi', 'hdfc', 'icici', 'axisbank', 'paytm', 'phonepe', 'incometax', 'irctc', 'whatsapp', 'netflix', 'fedex', 'dhl', 'indiapost'];

/** Synthetic demonstration blocklist. Production would use a maintained reputation feed. */
export const DEMO_BLOCKLIST: { domain: string; source: string; addedAt: string }[] = [
  { domain: 'invoice-update-portal.example', source: 'Saathi demo blocklist (synthetic)', addedAt: '2026-10-01' },
  { domain: 'secure-kyc-verify.example', source: 'Saathi demo blocklist (synthetic)', addedAt: '2026-10-01' },
];

const PATTERNS: { id: string; strength: 'strong' | 'weak'; re: RegExp }[] = [
  { id: 'credential_request', strength: 'strong', re: /\b(otp|one[- ]time password|password|passcode|pin\b|cvv|login details|verify your account|net ?banking)\b|ओटीपी|पासवर्ड|ಪಾಸ್‌?ವರ್ಡ್|ಒಟಿಪಿ/i },
  { id: 'payment_change', strength: 'strong', re: /\b(new bank (account|details)|change(d)? (of )?bank|updated? (payment|bank) details|pay (to|into) (this|the following) account|upi id)\b|नया खाता|ಹೊಸ ಖಾತೆ/i },
  { id: 'gift_card', strength: 'strong', re: /\b(gift ?cards?|google play cards?|itunes cards?)\b/i },
  { id: 'urgency', strength: 'weak', re: /\b(urgent(ly)?|immediately|within (24|48) hours|today only|act now|final (notice|warning)|account (will be )?(suspended|blocked|closed))\b|तुरंत|अभी|ತಕ್ಷಣ/i },
  { id: 'prize', strength: 'weak', re: /\b(you (have )?won|lottery|prize|cashback reward|lucky draw)\b|इनाम|ಬಹುಮಾನ/i },
  { id: 'threat', strength: 'weak', re: /\b(legal action|police complaint|penalty|arrest)\b/i },
  { id: 'invoice', strength: 'weak', re: /\b(invoice|overdue payment|outstanding (amount|balance)|remittance)\b/i },
];

export type DomainFinding = { display: string; ascii: string; registrable: string; flags: string[] };
export type ScamAssessment = {
  verdict: ScamVerdict;
  reasons: Msg[];
  uncertainty: Msg[];
  nextSteps: Msg[];
  domains: DomainFinding[];
  signals: string[];
  missingChecks: Msg[];
  rulesVersion: number;
  campaignBasis: string;
};

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"')]+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}\/[^\s<>"')]*)/giu;
const BARE_DOMAIN_RE = /\b([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:[a-z]{2,24}|xn--[a-z0-9-]+))\b/giu;

function registrable(host: string): string {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const sld2 = ['co.in', 'co.uk', 'com.au', 'org.in', 'net.in', 'gov.in', 'ac.in'];
  const last2 = parts.slice(-2).join('.');
  return sld2.includes(last2) ? parts.slice(-3).join('.') : last2;
}

export function extractDomains(text: string): DomainFinding[] {
  const found = new Map<string, DomainFinding>();
  const candidates = [...(text.match(URL_RE) ?? []), ...(text.match(BARE_DOMAIN_RE) ?? [])];
  for (const raw of candidates) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    } catch {
      continue;
    }
    const ascii = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!ascii.includes('.') || ascii.length > 253) continue;
    const flags: string[] = [];
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ascii)) flags.push('ip_address_host');
    if (ascii.split('.').some((l) => l.startsWith('xn--'))) flags.push('punycode');
    if (SHORTENERS.has(ascii)) flags.push('shortened_link');
    const tld = ascii.split('.').pop()!;
    if (UNUSUAL_TLDS.has(tld)) flags.push('unusual_tld');
    if (url.username) flags.push('userinfo_in_url');
    if (/^http:\/\//i.test(raw)) flags.push('not_https');
    const reg = registrable(ascii);
    const brand = BRANDS.find((b) => ascii.includes(b) && !reg.startsWith(`${b}.`));
    if (brand) flags.push(`brand_lookalike:${brand}`);
    const display = raw.replace(/^https?:\/\//i, '').split(/[/?#]/)[0];
    if (!found.has(ascii)) found.set(ascii, { display, ascii, registrable: reg, flags });
  }
  return [...found.values()];
}

export type ScamOptions = { reputationAvailable: boolean; blocklist?: typeof DEMO_BLOCKLIST };

export function assessMessage(text: string, opts: ScamOptions): ScamAssessment {
  const trimmed = text.trim();
  const domains = extractDomains(trimmed);
  const signals: string[] = [];
  const reasons: Msg[] = [];
  const uncertainty: Msg[] = [];
  const missingChecks: Msg[] = [];
  if (!opts.reputationAvailable) missingChecks.push(msg('scam.missing.reputation'));

  const blocklist = opts.blocklist ?? DEMO_BLOCKLIST;
  const listed = domains.map((d) => ({ d, hit: blocklist.find((b) => d.ascii === b.domain || d.ascii.endsWith(`.${b.domain}`)) })).filter((x) => x.hit);
  for (const { d, hit } of listed) reasons.push(msg('scam.reason.blocklisted', { domain: d.display, source: hit!.source, addedAt: hit!.addedAt }));

  let strong = 0;
  let weak = 0;
  for (const p of PATTERNS) {
    if (p.re.test(trimmed)) {
      signals.push(p.id);
      reasons.push(msg(`scam.reason.${p.id}`));
      if (p.strength === 'strong') strong++;
      else weak++;
    }
  }
  for (const d of domains) {
    for (const f of d.flags) {
      const [id, arg] = f.split(':');
      signals.push(id);
      reasons.push(msg(`scam.reason.${id}`, { domain: d.display, brand: arg ?? '' }));
      if (['ip_address_host', 'punycode', 'userinfo_in_url', 'brand_lookalike'].includes(id)) strong++;
      else weak++;
    }
  }

  let verdict: ScamVerdict;
  if (trimmed.length < 12 && domains.length === 0) {
    verdict = 'insufficient_information';
    reasons.push(msg('scam.reason.too_short'));
  } else if (listed.length > 0) {
    verdict = 'known_malicious';
    uncertainty.push(msg('scam.uncertain.list_scope'));
  } else if (strong >= 1 || weak >= 2) {
    verdict = 'suspicious';
    uncertainty.push(msg('scam.uncertain.sender_intent'));
  } else {
    verdict = 'no_known_indicators';
    if (weak === 1) uncertainty.push(msg('scam.uncertain.single_weak_signal'));
    uncertainty.push(msg('scam.uncertain.not_a_guarantee'));
  }
  if (domains.some((d) => d.flags.includes('shortened_link'))) uncertainty.push(msg('scam.uncertain.short_link_destination'));

  const nextSteps: Msg[] =
    verdict === 'known_malicious' || verdict === 'suspicious'
      ? [msg('scam.next.do_not_click'), msg('scam.next.verify_known_channel'), msg('scam.next.report')]
      : verdict === 'insufficient_information'
        ? [msg('scam.next.paste_full_text')]
        : [msg('scam.next.still_verify_requests'), msg('scam.next.report_if_unsure')];

  const campaignBasis = domains.length
    ? `d:${[...new Set(domains.map((d) => d.registrable))].sort().join(',')}`
    : `t:${trimmed.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').slice(0, 160)}`;

  return { verdict, reasons, uncertainty, nextSteps, domains, signals, missingChecks, rulesVersion: SCAM_RULES_VERSION, campaignBasis };
}

/** Lightweight redaction applied before any optional external processing. */
export function suggestRedactions(text: string): string {
  return text
    .replace(/\b\d{12}\b/g, '[ID NUMBER]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[CARD NUMBER]')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '[EMAIL]')
    .replace(/(?:\+91[ -]?)?\b[6-9]\d{9}\b/g, '[PHONE]');
}
