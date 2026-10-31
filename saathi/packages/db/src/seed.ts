import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { loadRootEnv } from './env';
import * as s from './schema';

// Synthetic seed data (build.md Ph03.1): one generic organization and three vocabulary
// variants. Every person, record and organization here is invented. Passwords are for
// local demonstration only and are documented in README.md.

export const DEMO_PASSWORD = 'saathi-demo-2026';

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('base64url');
  return `scrypt$${salt}$${scryptSync(pin, salt, 32).toString('base64url')}`;
}

type OrgSeed = {
  name: string;
  orgType: string;
  vocabulary: string;
  locale: string;
  ownerEmail: string;
  ownerName: string;
  extraMembers?: { email: string; name: string; role: string }[];
  autoThrottle: boolean;
  staff: { name: string; code: string; pin: string; status?: string; shared?: boolean; userEmail?: string }[];
};

const ORGS: OrgSeed[] = [
  {
    name: 'Lakeview Community Office',
    orgType: 'office',
    vocabulary: 'generic',
    locale: 'en',
    ownerEmail: 'owner@lakeview.example',
    ownerName: 'Meera Iyer',
    extraMembers: [
      { email: 'approver@lakeview.example', name: 'Ravi Kumar', role: 'approver' },
      { email: 'staff@lakeview.example', name: 'Asha Rao', role: 'staff' },
      { email: 'auditor@lakeview.example', name: 'Farah Khan', role: 'auditor' },
      { email: 'staff2@lakeview.example', name: 'Joseph DSouza', role: 'staff' },
      { email: 'staff3@lakeview.example', name: 'Lakshmi N', role: 'staff' },
    ],
    autoThrottle: true,
    staff: [
      { name: 'Asha Rao', code: 'ASH001', pin: '482910', userEmail: 'staff@lakeview.example' },
      { name: 'Joseph DSouza', code: 'JOS002', pin: '305117', userEmail: 'staff2@lakeview.example' },
      { name: 'Lakshmi N', code: 'LAK003', pin: '771204', userEmail: 'staff3@lakeview.example' },
      { name: 'Vikram S (former volunteer)', code: 'VIK004', pin: '119900', status: 'offboarded' },
      { name: 'Front desk shared login', code: 'FRD005', pin: '640022', shared: true },
    ],
  },
  {
    name: 'Northside Family Clinic',
    orgType: 'clinic',
    vocabulary: 'clinic',
    locale: 'kn',
    ownerEmail: 'owner@northside.example',
    ownerName: 'Dr. Kavya Shetty',
    autoThrottle: false,
    staff: [
      { name: 'Prakash M', code: 'PRA001', pin: '220011' },
      { name: 'Reception shared login', code: 'REC002', pin: '330022', shared: true },
    ],
  },
  {
    name: 'Corner Street Store',
    orgType: 'retail',
    vocabulary: 'shop',
    locale: 'hi',
    ownerEmail: 'owner@lakeview.example',
    ownerName: 'Meera Iyer',
    autoThrottle: true,
    staff: [{ name: 'Sunil P', code: 'SUN001', pin: '515151' }],
  },
  {
    name: 'Hillview Learning Centre',
    orgType: 'education',
    vocabulary: 'school',
    locale: 'en',
    ownerEmail: 'owner@lakeview.example',
    ownerName: 'Meera Iyer',
    autoThrottle: true,
    staff: [{ name: 'Anita George', code: 'ANI001', pin: '626262' }],
  },
];

const RECORD_CATEGORIES = ['Account statement', 'Service request', 'Contact details', 'Payment receipt', 'Appointment note', 'Enrolment form'];

export async function seed(url: string, opts: { quiet?: boolean } = {}) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const db = drizzle(client, { schema: s });
  const log = (...a: unknown[]) => !opts.quiet && console.log(...a);
  try {
    await client.query('BEGIN');
    const existing = await client.query("SELECT 1 FROM organizations WHERE name = 'Lakeview Community Office'");
    if (existing.rowCount) {
      log('Seed data already present; skipping. (Reset with: pnpm db:reset)');
      await client.query('ROLLBACK');
      return;
    }
    const pw = await hashPassword(DEMO_PASSWORD);
    const users = new Map<string, string>();
    const ensureUser = async (email: string, name: string) => {
      if (users.has(email)) return users.get(email)!;
      const id = randomUUID();
      await db.insert(s.authUser).values({ id, name, email, emailVerified: true });
      await db.insert(s.authAccount).values({ id: randomUUID(), accountId: id, providerId: 'credential', userId: id, password: pw });
      users.set(email, id);
      return id;
    };

    for (const o of ORGS) {
      const ownerId = await ensureUser(o.ownerEmail, o.ownerName);
      const [org] = await db
        .insert(s.organizations)
        .values({ name: o.name, orgType: o.orgType, vocabulary: o.vocabulary, locale: o.locale, timezone: 'Asia/Kolkata', setupStep: 'done', setupComplete: true, recoveryContact: 'Owner phone on file (synthetic)', recoveryUserId: ownerId, isDemo: true, notificationPrefs: { telegram: true, digest: 'weekly' } })
        .returning();
      await db.insert(s.memberships).values({ orgId: org.id, userId: ownerId, role: 'owner' });
      for (const m of o.extraMembers ?? []) await db.insert(s.memberships).values({ orgId: org.id, userId: await ensureUser(m.email, m.name), role: m.role });
      await db.insert(s.orgPolicy).values({
        orgId: org.id,
        version: 1,
        autoThrottleEnabled: o.autoThrottle,
        consentVersion: o.autoThrottle ? 1 : null,
        consentedBy: o.autoThrottle ? ownerId : null,
        consentedAt: o.autoThrottle ? new Date() : null,
        updatedBy: ownerId,
      });
      await db.insert(s.orgPolicyVersions).values({ orgId: org.id, version: 1, snapshot: { autoThrottleEnabled: o.autoThrottle, throttleRatePerMinute: 1, throttleDurationMinutes: 30, burstThreshold: 20, burstWindowSeconds: 120, dailyLimit: 100, scope: 'records_reference_only' }, changedBy: ownerId });
      await db.insert(s.policyGuards).values({ orgId: org.id, guardKey: 'org' });
      await db.insert(s.evidenceChainHeads).values({ orgId: org.id });

      const [records] = await db
        .insert(s.integrations)
        .values({ orgId: org.id, kind: 'records_reference', name: 'Records workspace (reference app)', canObserve: true, canEnforce: true, status: 'connected', config: { synthetic: true } })
        .returning();
      await db.insert(s.integrations).values({ orgId: org.id, kind: 'device_agent', name: 'Saathi Windows agent', canObserve: true, canEnforce: true, status: 'connected' });
      const [billing] = await db.insert(s.integrations).values({ orgId: org.id, kind: 'unconnected', name: 'Billing software', canObserve: false, canEnforce: false, status: 'unconnected' }).returning();
      await db.insert(s.integrations).values({ orgId: org.id, kind: 'read_only', name: 'Cloud email', canObserve: true, canEnforce: false, status: 'read_only' });

      const staffIds: Record<string, string> = {};
      for (const p of o.staff) {
        const [row] = await db
          .insert(s.staff)
          .values({
            orgId: org.id,
            displayName: p.name,
            employeeCode: p.code,
            recordsPinHash: hashPin(p.pin),
            status: p.status ?? 'active',
            sharedAccount: p.shared ?? false,
            userId: p.userEmail ? users.get(p.userEmail) ?? null : null,
            offboardedAt: p.status === 'offboarded' ? new Date(Date.now() - 20 * 86400_000) : null,
          })
          .returning();
        staffIds[p.code] = row.id;
        await db.insert(s.policyGuards).values({ orgId: org.id, guardKey: `subject:${row.id}` });
        for (const capability of ['records.view', 'records.download']) await db.insert(s.grants).values({ orgId: org.id, staffId: row.id, integrationId: records.id, capability });
      }
      const sharedCode = o.staff.find((x) => x.shared)?.code;
      await db.insert(s.dependencies).values([
        { orgId: org.id, kind: 'workstation_runs', description: 'Billing runs on the Front Desk PC under the counter account', confidence: 'medium', integrationIds: [billing.id], declaredBy: ownerId },
        ...(sharedCode ? [{ orgId: org.id, kind: 'shared_account', description: 'The shared front-desk login is used by three people', confidence: 'high', subjectIds: [staffIds[sharedCode]], declaredBy: ownerId }] : []),
      ]);

      const rows = Array.from({ length: 120 }, (_, i) => ({
        orgId: org.id,
        integrationId: records.id,
        title: `${RECORD_CATEGORIES[i % RECORD_CATEGORIES.length]} #${1001 + i}`,
        category: RECORD_CATEGORIES[i % RECORD_CATEGORIES.length],
        body: `Synthetic record ${1001 + i}. Invented content for demonstration only. Reference ${randomBytes(4).toString('hex')}.`,
        isDecoy: false,
      }));
      rows.push({ orgId: org.id, integrationId: records.id, title: 'Archived ledger (do not open)', category: 'Archive', body: 'Decoy record. Synthetic.', isDecoy: true });
      await db.insert(s.demoRecords).values(rows);
      log(`Seeded ${o.name} (${o.vocabulary}) – ${org.id}`);
    }
    // Land the demo owner in the generic organization first.
    const [lake] = await db.select({ id: s.organizations.id }).from(s.organizations).where(eq(s.organizations.name, 'Lakeview Community Office'));
    await db.insert(s.userPreferences).values({ userId: users.get('owner@lakeview.example')!, activeOrgId: lake.id }).onConflictDoNothing();
    await client.query('COMMIT');
    log(`\nDemo sign-in password for all seeded accounts: ${DEMO_PASSWORD}`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  loadRootEnv();
  const url = process.argv.includes('--test') ? process.env.TEST_DATABASE_URL_DIRECT : process.env.DATABASE_URL_DIRECT;
  if (!url) {
    console.error('DATABASE_URL_DIRECT is required to seed.');
    process.exit(1);
  }
  seed(url).catch((e) => {
    console.error('Seed failed:', e.message);
    process.exit(1);
  });
}
