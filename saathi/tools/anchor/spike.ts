// Phase 00 spike: submit a synthetic, random digest to OpenTimestamps calendars and keep
// the pending proof. Publishes only a random 32-byte hash (no organization data).
import { writeFileSync } from 'node:fs';
import { stampDigest, serializeDetached, parseDetached, summarizeProof, sha256, bytesToHex, randomBytes, rootFileBytes } from '@saathi/evidence';

const calendars = (process.env.OTS_CALENDAR_ALLOWLIST ?? 'https://alice.btc.calendar.opentimestamps.org,https://bob.btc.calendar.opentimestamps.org,https://finney.calendar.eternitywall.com').split(',');
const root = bytesToHex(sha256(randomBytes(32)));
const file = rootFileBytes(root);
const { timestamp, outcomes } = await stampDigest(sha256(file), calendars, fetch as never);
console.log(JSON.stringify(outcomes, null, 2));
if (outcomes.some((o) => o.ok)) {
  const ots = serializeDetached(timestamp);
  const out = process.argv[2] ?? '.local/ots-spike';
  writeFileSync(`${out}/root.txt`, file);
  writeFileSync(`${out}/root.txt.ots`, ots);
  const back = parseDetached(ots);
  console.log('round-trip digest ok:', bytesToHex(back.fileDigest) === bytesToHex(sha256(file)), summarizeProof(back.timestamp));
}
