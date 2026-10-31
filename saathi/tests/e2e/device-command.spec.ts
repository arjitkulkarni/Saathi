import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

// Signed device command loop through a running SIMULATED agent (labelled test fixture,
// decision D-015): preview → approve → worker signs (Ed25519 command key) → agent polls,
// verifies signature/target/expiry/nonce → simulated adapter → result + probes → outcome.
// Requires: web + worker + `pnpm dev:agent -- --simulate --state-dir .local/agent-sim` running.

test('approved device action is signed, delivered, executed by the simulated agent and probed', async ({ page }) => {
  await signIn(page, 'owner@lakeview.example');
  const devices = await page.evaluate(async () => (await (await fetch('/api/v1/devices')).json()).data as { id: string; simulated: boolean; freshness: string }[]);
  const sim = devices.find((d) => d.simulated && d.freshness === 'fresh');
  test.skip(!sim, 'No fresh simulated agent is running');
  await page.goto(`/app/devices/${sim!.id}`);
  await expect(page.getByText('Simulated device (test fixture)').first()).toBeVisible();

  // Request an antivirus scan: non-destructive, supported by the simulated adapter.
  const created = await page.evaluate(async (id) => {
    const r = await fetch(`/api/v1/devices/${id}/previews`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionType: 'device.request_av_scan', params: { scanType: 'quick' } }) });
    return (await r.json()).data as { previewId: string };
  }, sim!.id);
  await page.goto(`/app/previews/${created.previewId}`);
  await expect(page.getByRole('heading', { name: 'Request an antivirus scan?' })).toBeVisible();
  await expect(page.getByText('A finished scan does not prove the malware is gone.')).toBeVisible();
  await expect(page.getByText('This is a simulated test device, not a real computer.')).toBeVisible();
  await page.getByRole('button', { name: 'Request a scan' }).click();
  await page.waitForURL(/\/app\/actions\//);

  // Outcome comes only from the agent's reported probes, never from a timer.
  await expect(page.getByText('Action confirmed').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('This result came from a simulated test adapter, not a real computer.')).toBeVisible();
  await expect(page.getByText('Checks performed')).toBeVisible();
});

test('a device action cannot be approved when the device is offline', async ({ page }) => {
  await signIn(page, 'owner@lakeview.example');
  const devices = await page.evaluate(async () => (await (await fetch('/api/v1/devices')).json()).data as { id: string; freshness: string; status: string }[]);
  const offline = devices.find((d) => d.status === 'connected' && d.freshness !== 'fresh');
  test.skip(!offline, 'No offline device to test against');
  const res = await page.evaluate(async (id) => {
    const r = await fetch(`/api/v1/devices/${id}/previews`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionType: 'device.request_av_scan', params: { scanType: 'quick' } }) });
    return { status: r.status, body: await r.json() };
  }, offline!.id);
  if (res.status === 201) {
    await page.goto(`/app/previews/${res.body.data.previewId}`);
    // Blocked with a stated reason: offline, or unsupported (e.g. an observe-only agent).
    await expect(page.locator('#approve-blocked')).toHaveText(/Device offline\. Last seen|does not report support/);
    await expect(page.getByRole('button', { name: 'Request a scan' })).toBeDisabled();
  } else expect(res.body.error.code).toBe('UNSUPPORTED_ACTION');
});
