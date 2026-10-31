import { describe, expect, it } from 'vitest';
import type { Finding } from '@saathi/contracts';
import { assessContainment, nextIncidentState } from '../src/containment';
import { assessMessage } from '../src/scam';

// build.md §7 A13 (partial containment) and A18 (labelled message set → confusion matrix).
// The message set was written from common small-office scam and everyday business messages,
// not from the detector's patterns. Only safety invariants are asserted; the matrix is
// printed and recorded in docs/verification.md as measured.

const finding = (id: string, status: Finding['status'], ruleId: Finding['ruleId'], cap: string): Finding => ({
  id,
  ruleId,
  ruleVersion: 1,
  status,
  harmfulCapability: cap,
  target: { type: 'device', id: 'dev-1' },
  facts: [],
  boundaries: [],
});

describe('A13: one finding fixed, another unresolved', () => {
  it('is partially contained and the incident never becomes contained', () => {
    const at = new Date().toISOString();
    const findings = [finding('f1', 'restricted', 'password_guessing', 'device.remote_logon'), finding('f2', 'open', 'unresolved_malware', 'device.malware')];
    const a = assessContainment(findings, [], true, at);
    expect(a.status).toBe('partially_contained');
    expect(a.reasons.map((r) => r.key)).toContain('containment.finding_open');
    expect(nextIncidentState('investigating', a)).toBe('investigating');
    expect(nextIncidentState('open', a)).toBe('open');
  });

  it('a confirmed action with unknown sibling outcome is not contained', () => {
    const at = new Date().toISOString();
    const a = assessContainment([finding('f1', 'restricted', 'password_guessing', 'x')], [{ actionId: 'a', actionType: 't', coversTargets: [], state: 'unknown' }], true, at);
    expect(a.status).not.toBe('contained');
  });
});

type Label = 'scam' | 'benign';
const SET: { label: Label; text: string }[] = [
  // Scam / fraud attempts
  { label: 'scam', text: 'Dear customer, your KYC is pending. Your account will be blocked today. Update now at http://secure-kyc-verify.example/login' },
  { label: 'scam', text: 'Hi, this is the director. I am in a meeting, please buy 5 Google Play gift cards of Rs 2000 each and send me the codes urgently. Keep this confidential.' },
  { label: 'scam', text: 'Our bank details have changed. Please pay the pending invoice into the new account below today to avoid late fees: https://invoice-update-portal.example/pay' },
  { label: 'scam', text: 'Electricity bill unpaid. Your power will be disconnected tonight at 9.30 pm. Call the officer immediately on 98xxxxxx12 and share the OTP you receive.' },
  { label: 'scam', text: 'Congratulations! You have won a lottery prize of 25 lakh. Pay the processing fee to claim your reward: bit.ly/claim-prize-now' },
  { label: 'scam', text: 'Your parcel is held at customs. Verify your identity and pay Rs 49 at http://192.0.2.10/track to release it.' },
  { label: 'scam', text: 'Security alert from your bank: unusual sign-in detected. Confirm your password and card number here https://paytm-secure-check.top/verify' },
  { label: 'scam', text: 'Income tax refund approved. Enter your net banking login to receive the refund at https://refund-incometax.xyz' },
  // Ordinary business messages
  { label: 'benign', text: 'Reminder: staff meeting tomorrow at 10 am in the front office. Please bring the monthly attendance sheet.' },
  { label: 'benign', text: 'The printer on the first floor is out of toner again. I have placed an order with the usual supplier.' },
  { label: 'benign', text: 'Can you send me the updated appointment list for Thursday? Two patients asked to move to the afternoon.' },
  { label: 'benign', text: 'Invoice 2214 from Sharma Stationers is attached for last month. Payment terms as usual, 30 days.' },
  { label: 'benign', text: 'Happy Diwali to the whole team! The office will be closed on Friday and reopens on Monday.' },
  { label: 'benign', text: 'Here is the link to the school timetable we discussed: https://www.example.org/timetable' },
  { label: 'benign', text: 'The water delivery will come at 4 pm today, someone please be at the front desk to receive it.' },
  { label: 'benign', text: 'Please update your password on the records system before month end as per our usual policy. Ask Ramesh if you need help.' },
];

describe('A18: labelled message set', () => {
  it('never says "safe", never calls an ordinary message known-malicious, and reports the matrix', () => {
    const rows = SET.map((m) => ({ ...m, verdict: assessMessage(m.text, { reputationAvailable: false }).verdict }));
    const flagged = (v: string) => v === 'known_malicious' || v === 'suspicious';
    const tp = rows.filter((r) => r.label === 'scam' && flagged(r.verdict)).length;
    const fn = rows.filter((r) => r.label === 'scam' && !flagged(r.verdict)).length;
    const fp = rows.filter((r) => r.label === 'benign' && flagged(r.verdict)).length;
    const tn = rows.filter((r) => r.label === 'benign' && !flagged(r.verdict)).length;
    const byVerdict = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [`${r.label}:${r.verdict}`]: (acc[`${r.label}:${r.verdict}`] ?? 0) + 1 }), {});
    console.log(JSON.stringify({ a18: { tp, fn, fp, tn, byVerdict, misses: rows.filter((r) => r.label === 'scam' && !flagged(r.verdict)).map((r) => r.text.slice(0, 60)), falseAlarms: rows.filter((r) => r.label === 'benign' && flagged(r.verdict)).map((r) => r.text.slice(0, 60)) } }));
    for (const r of rows) expect(['known_malicious', 'suspicious', 'no_known_indicators', 'insufficient_information']).toContain(r.verdict);
    expect(rows.filter((r) => r.label === 'benign' && r.verdict === 'known_malicious')).toHaveLength(0);
  });
});
