import { expect, test, type Page } from '@playwright/test';
import { shot, signIn } from './helpers';

// The defining demonstration (skills.md §1): a suspicious records session loses access
// while the same person's legitimate session keeps working — driven through the real UI,
// API, gateway, worker and database. Requires `pnpm dev:web` + `pnpm dev:worker` running
// against the seeded dev database.


async function sessionDownload(page: Page, token: string) {
  return page.evaluate(async (tk) => {
    const list = await fetch('/api/v1/records', { headers: { Authorization: `Bearer ${tk}` } });
    const lb = await list.json();
    if (!list.ok) return { status: list.status, reason: lb?.error?.details?.reason };
    const res = await fetch(`/api/v1/records/${lb.data.records[0].id}/download`, { headers: { Authorization: `Bearer ${tk}` } });
    const b = await res.json();
    return { status: res.status, reason: b?.error?.details?.reason };
  }, token);
}

test('suspicious session is stopped while the legitimate session keeps working', async ({ page }) => {
  await signIn(page, 'owner@lakeview.example');
  await page.goto('/demo');
  const scenario = page.waitForResponse((r) => r.url().endsWith('/api/v1/demo/scenario'));
  await page.getByRole('button', { name: 'Start records scenario' }).first().click();
  const { data } = await (await scenario).json();
  expect(data.laptop.token).toBeTruthy();

  // Burst from the unfamiliar session through the real gateway.
  await page.getByRole('button', { name: 'Send burst from unfamiliar session' }).click();
  await expect(page.getByText(/Downloads are limited/).first()).toBeVisible();

  // The worker correlates the burst into one incident.
  let incidentUrl = '';
  await expect(async () => {
    await page.goto('/app/incidents?tab=needs_attention');
    const row = page.getByRole('link', { name: /downloading unusually fast/ }).first();
    await expect(row).toBeVisible({ timeout: 2000 });
    incidentUrl = (await row.getAttribute('href'))!;
  }).toPass({ timeout: 60_000 });
  await page.goto(incidentUrl);
  await expect(page.getByRole('heading', { name: 'What happened' })).toBeVisible();
  await expect(page.getByText('We have not confirmed whether this is an authorized export.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Already limited' })).toBeVisible();
  await shot(page, 'incident');

  // Preview the narrow response.
  await page.getByRole('button', { name: 'Review who is affected' }).first().click();
  await expect(page.getByRole('heading', { name: 'Pause this records session?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Will stop' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Keeps working' })).toBeVisible();
  await expect(page.getByText('Records already downloaded cannot be recalled.')).toBeVisible();
  await expect(page.getByText('Impact on unconnected applications is unknown.')).toBeVisible();
  await shot(page, 'preview');

  await page.getByRole('button', { name: 'Pause this session' }).click();
  await page.waitForURL(/\/app\/actions\//);
  await expect(page.getByText('Action confirmed').first()).toBeVisible();
  await expect(page.getByText('Access stopped').first()).toBeVisible();
  await expect(page.getByText('Access remains permitted').first()).toBeVisible();
  await shot(page, 'action');

  // Independent check through the gateway itself.
  const suspicious = await sessionDownload(page, data.laptop.token);
  const legitimate = await sessionDownload(page, data.office.token);
  expect(suspicious.status).toBe(403);
  expect(suspicious.reason).toBe('session_paused');
  expect(legitimate.status).toBe(200);
});
