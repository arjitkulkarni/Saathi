import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

export const PASSWORD = 'saathi-demo-2026';
const CACHE = '.local/e2e-auth';

/**
 * Sign in through the real form, caching the session cookie per user so the suite does not
 * trip Better Auth's sign-in rate limit (which stays enabled).
 */
export async function signIn(page: Page, email: string) {
  const file = `${CACHE}/${email}.json`;
  if (existsSync(file)) {
    await page.context().addCookies(JSON.parse(readFileSync(file, 'utf8')));
    const ok = await page.evaluate(async () => (await fetch('/api/v1/members')).status).catch(() => 0);
    await page.goto('/app');
    if (!page.url().includes('/login') && ok !== 401) return;
    await page.context().clearCookies();
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const limited = page.getByText('Too many sign-in attempts');
    const outcome = await Promise.race([page.waitForURL((u) => !u.pathname.startsWith('/login')).then(() => 'ok'), limited.waitFor().then(() => 'limited')]);
    if (outcome === 'ok') break;
    // Better Auth's sign-in limit (3 per 10 s) stays on; the test waits out the window.
    await page.waitForTimeout(11_000);
  }
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, JSON.stringify((await page.context().cookies()).filter((c) => c.name.includes('better-auth'))));
}

export const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: `.local/shots/e2e-${name}-${page.viewportSize()?.width}.png`, fullPage: true });
};
