// Developer helper: sign in and screenshot routes at a given viewport.
// node scripts/shoot.mjs <email> <width>x<height> <path> [<path>...]
import { chromium } from '@playwright/test';
const [email, size, ...paths] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
if (email !== '-') {
  await page.goto('http://localhost:3000/login');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'saathi-demo-2026');
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
}
for (const p of paths) {
  await page.goto(`http://localhost:3000${p}`, { waitUntil: 'networkidle', timeout: 60000 });
  const name = `${p.replace(/[^a-z0-9]+/gi, '_')}_${width}`.replace(/^_/, '');
  await page.screenshot({ path: `.local/shots/${name}.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log(`${p} -> ${page.url()} ${overflow ? 'HORIZONTAL OVERFLOW' : ''}`);
}
if (errors.length) console.log('console errors:', errors.slice(0, 8));
await browser.close();
