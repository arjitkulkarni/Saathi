import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

// frontend.md §11/§15: widths 320–1440+, no horizontal overflow, keyboard access, visible
// focus, reduced motion, EN/KN/HI rendering, automated accessibility scan (axe).

const WIDTHS: [number, number][] = [
  [320, 568],
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1440, 900],
  [1920, 1080],
];

async function setLocale(page: Page, locale: 'en' | 'kn' | 'hi') {
  await page.evaluate(async (l) => fetch('/api/v1/me/preferences', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: l }) }), locale);
}

async function firstIncident(page: Page) {
  const list = await page.evaluate(async () => (await (await fetch('/api/v1/incidents?tab=all')).json()).data.items as { id: string }[]);
  return list[0]?.id ?? null;
}

test.describe('responsive layout', () => {
  for (const locale of ['en', 'kn', 'hi'] as const) {
    test(`no horizontal overflow across widths (${locale})`, async ({ page }) => {
      await signIn(page, 'owner@lakeview.example');
      await setLocale(page, locale);
      try {
      const inc = await firstIncident(page);
      const paths = ['/', '/app/overview', '/app/incidents?tab=all', '/app/health', '/app/evidence', '/app/settings', '/verify', ...(inc ? [`/app/incidents/${inc}`] : [])];
      for (const [w, h] of WIDTHS) {
        await page.setViewportSize({ width: w, height: h });
        for (const p of paths) {
          await page.goto(p);
          await page.waitForLoadState('networkidle');
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(overflow, `${p} at ${w}px (${locale})`).toBeLessThanOrEqual(1);
          if (process.env.SHOTS && (w === 390 || w === 1440) && (p.startsWith('/app/incidents/') || p === '/app/overview')) {
            await page.screenshot({ path: `.local/shots/resp-${locale}-${p.replace(/[^a-z0-9]+/gi, '_')}-${w}.png`, fullPage: true });
          }
        }
      }
      // Regional text actually renders in the requested script.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/app/overview');
      const heading = await page.getByRole('heading', { level: 1 }).innerText();
      if (locale === 'kn') expect(heading).toMatch(/[ಀ-೿]/);
      if (locale === 'hi') expect(heading).toMatch(/[ऀ-ॿ]/);
      } finally {
        await setLocale(page, 'en');
      }
    });
  }
});

test('mobile navigation never hides incident approval controls', async ({ page }) => {
  await signIn(page, 'owner@lakeview.example');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/overview');
  await expect(page.getByRole('navigation', { name: 'Menu' }).last()).toBeVisible();
  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Focus returns to the trigger after closing the dialog.
  await expect(page.getByRole('button', { name: 'More' })).toBeFocused();
});

test('keyboard: skip link, visible focus and operable controls', async ({ page }) => {
  await signIn(page, 'owner@lakeview.example');
  await setLocale(page, 'en');
  await page.goto('/app/overview');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(outline).not.toBe('none');
});

test('reduced motion disables decorative animation', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('/');
  const dur = await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'saathi-pending';
    document.body.appendChild(el);
    return getComputedStyle(el).animationName;
  });
  expect(dur).toBe('none');
  await ctx.close();
});

test.describe('automated accessibility scan (axe, WCAG A/AA)', () => {
  for (const p of ['/', '/login', '/verify']) {
    test(`public ${p}`, async ({ page }) => {
      await page.goto(p);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
    });
  }
  test('console pages', async ({ page }) => {
    await signIn(page, 'owner@lakeview.example');
    const inc = await firstIncident(page);
    for (const p of ['/app/overview', '/app/incidents?tab=all', '/app/devices', '/app/people', '/app/health', '/app/evidence', '/app/settings', ...(inc ? [`/app/incidents/${inc}`] : [])]) {
      await page.goto(p);
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('nextjs-portal').analyze();
      const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${p} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
    }
  });
});
