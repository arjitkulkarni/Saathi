import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

// Role destinations, server-side authorization of deep links and cross-tenant IDs
// (flow.md §2, build.md Ph02 gate). Hidden navigation is not the control being tested.

test('signed-out deep link redirects to sign-in and preserves the destination', async ({ page }) => {
  await page.goto('/app/incidents?tab=all');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fincidents/);
  await expect(page.getByText('Sign in to continue. We will bring you back here.')).toBeVisible();
});

test('staff land on Ask Saathi and cannot open approver pages or APIs', async ({ page }) => {
  await signIn(page, 'staff@lakeview.example');
  await page.goto('/app');
  await expect(page).toHaveURL(/\/app\/ask$/);
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Incidents' })).toHaveCount(0);
  await page.goto('/app/overview');
  await expect(page.getByRole('heading', { name: 'You do not have access to this' })).toBeVisible();
  const api = await page.evaluate(async () => {
    const r = await fetch('/api/v1/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ previewId: '00000000-0000-4000-8000-000000000000', idempotencyKey: 'abcdefghijklmnopqrstu' }) });
    return { status: r.status, code: (await r.json()).error?.code };
  });
  expect(api).toEqual({ status: 403, code: 'FORBIDDEN' });
});

test('auditors land on evidence and cannot run responses', async ({ page }) => {
  await signIn(page, 'auditor@lakeview.example');
  await page.goto('/app');
  await expect(page).toHaveURL(/\/app\/evidence$/);
  const r = await page.evaluate(async () => (await fetch('/api/v1/access/previews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionType: 'records.pause_session', targetType: 'session', targetId: '00000000-0000-4000-8000-000000000000' }) })).status);
  expect(r).toBe(403);
});

test('a member of another organization cannot open this organization’s incident by URL', async ({ page }) => {
  // Find a Lakeview incident ID as its owner…
  await signIn(page, 'owner@lakeview.example');
  const list = await page.evaluate(async () => (await (await fetch('/api/v1/incidents?tab=all')).json()).data.items as { id: string }[]);
  test.skip(list.length === 0, 'No incident exists yet (run the core journey first)');
  const id = list[0].id;
  await page.context().clearCookies();
  // …then try it as the Northside owner.
  await signIn(page, 'owner@northside.example');
  // Northside defaults to Kannada; assert in English for readability.
  await page.evaluate(async () => fetch('/api/v1/me/preferences', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: 'en' }) }));
  await page.goto(`/app/incidents/${id}`);
  await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
  const api = await page.evaluate(async (i) => (await fetch(`/api/v1/incidents/${i}`)).status, id);
  expect(api).toBe(404);
  // A forged organization selector is checked against membership, not trusted.
  const sw = await page.evaluate(async () => {
    const orgs = await (await fetch('/api/v1/incidents?tab=all')).json();
    void orgs;
    const r = await fetch('/api/v1/session/org', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId: '00000000-0000-4000-8000-000000000001' }) });
    return r.status;
  });
  expect(sw).toBe(403);
});

test('cross-origin mutations are refused', async ({ request }) => {
  const r = await request.post('/api/v1/actions', { headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, data: { previewId: 'x', idempotencyKey: 'y' } });
  expect(r.status()).toBe(403);
});

test('the records gateway refuses unknown tokens', async ({ request }) => {
  const r = await request.get('/api/v1/records', { headers: { Authorization: 'Bearer not-a-real-session-token-000000000' } });
  expect(r.status()).toBe(401);
});
