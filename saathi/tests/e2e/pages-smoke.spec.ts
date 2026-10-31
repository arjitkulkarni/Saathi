import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

// Every console route renders a purposeful screen without errors (frontend.md §15
// "Every route from flow.md … has a purposeful screen"). Detail IDs come from the
// authorized list APIs; a route is skipped only when no object of that kind exists.

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function firstId(page: Page, url: string): Promise<string | null> {
  return page.evaluate(async (u) => {
    const r = await fetch(u);
    if (!r.ok) return null;
    const d = (await r.json()).data;
    const list = Array.isArray(d) ? d : (d?.items ?? d?.checkpoints ?? d?.people ?? d?.reports ?? d?.integrations ?? []);
    return list[0]?.id ?? null;
  }, url);
}

async function expectScreen(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status(), path).toBeLessThan(400);
  await expect(page.locator('h1').first(), path).toBeVisible();
  await expect(page.getByText(/Something went wrong|Application error/)).toHaveCount(0);
}

test('owner console routes render', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, 'owner@lakeview.example');
  await page.evaluate(async () => fetch('/api/v1/me/preferences', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: 'en' }) }));
  for (const p of ['/app/ask', '/app/reports', '/app/integrations', '/app/people', '/app/devices', '/app/settings', '/onboarding']) await expectScreen(page, p);
  const details: [string, string][] = [
    ['/api/v1/people', '/app/people/'],
    ['/api/v1/checkpoints', '/app/evidence/'],
    ['/api/v1/reports', '/app/reports/'],
    ['/api/v1/integrations', '/app/integrations/'],
  ];
  const visited: string[] = [];
  for (const [api, prefix] of details) {
    const id = await firstId(page, api);
    if (!id) continue;
    await expectScreen(page, prefix + id);
    visited.push(prefix);
  }
  const inc = await firstId(page, '/api/v1/incidents?tab=all');
  if (inc) {
    await expectScreen(page, `/app/incidents/${inc}/recovery`);
    visited.push('recovery');
  }
  test.info().annotations.push({ type: 'visited-details', description: visited.join(', ') });
  expect(errors).toEqual([]);
});

test('staff can check a message and see a verdict that never says "safe"', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, 'staff@lakeview.example');
  await page.goto('/app/ask');
  await page.getByLabel('Message text').fill('Your KYC is pending and the account will be blocked today. Update at http://secure-kyc-verify.example/login');
  await page.getByRole('button', { name: 'Check message' }).click();
  await page.waitForURL(/\/app\/ask\/[0-9a-f-]{36}$/);
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.getByText(/known|suspicious/i).first()).toBeVisible();
  await expect(page.getByText(/^(safe|this is safe|message is safe)$/i)).toHaveCount(0);
  expect(errors).toEqual([]);
});
