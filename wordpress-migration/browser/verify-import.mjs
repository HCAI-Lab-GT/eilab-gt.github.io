import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadEnvFile } from './load-env.mjs';

const browserDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(browserDir, '..');
await loadEnvFile(path.join(rootDir, '.env'));

const wpUrl = (process.env.WP_URL || '').replace(/\/$/, '');
const outputDir = path.join(rootDir, 'build', 'admin-discovery');
const profileDir = path.join(browserDir, '.auth', 'gt-wordpress');

const context = await chromium.launchPersistentContext(profileDir, {
  headless: process.env.PLAYWRIGHT_HEADLESS !== '0',
  viewport: { width: 1440, height: 1000 },
});
const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(25_000);

await page.goto(`${wpUrl}/wp-admin/edit.php?post_type=page&post_status=all`, { waitUntil: 'domcontentloaded' });
if (!page.url().includes('/wp-admin/') || !(await page.locator('#wpadminbar').count())) {
  await context.close();
  throw new Error(`Admin session expired. Current URL: ${page.url()}`);
}

const pages = await page.locator('#the-list tr').evaluateAll((rows) =>
  rows
    .map((row) => {
      const titleLink = row.querySelector('.row-title');
      const status = row.querySelector('.post-state')?.textContent?.trim() || 'Published';
      const date = row.querySelector('.date')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const author = row.querySelector('.author a, .author')?.textContent?.trim() || '';
      return {
        id: row.id || null,
        title: titleLink?.textContent?.trim() || null,
        href: titleLink?.getAttribute('href') || null,
        status,
        date,
        author,
        classes: row.className,
      };
    })
    .filter((row) => row.title),
);
await page.screenshot({ path: path.join(outputDir, 'pages-after-import.png'), fullPage: true });

await page.goto(`${wpUrl}/wp-admin/upload.php`, { waitUntil: 'domcontentloaded' });
const media = await page.locator('.attachment, .wp-list-table tbody tr').evaluateAll((nodes) =>
  nodes.slice(0, 20).map((node) => ({
    text: node.textContent?.replace(/\s+/g, ' ').trim().slice(0, 200) || '',
    aria: node.getAttribute('aria-label') || null,
  })),
);
await page.screenshot({ path: path.join(outputDir, 'media-after-import.png'), fullPage: true });

await page.goto(`${wpUrl}/wp-admin/options-reading.php`, { waitUntil: 'domcontentloaded' });
const reading = {
  showOnFront: await page.locator('input[name="show_on_front"]:checked').getAttribute('value').catch(() => null),
  frontPageText: await page.locator('#page_on_front option:checked').textContent().catch(() => null),
};

const expected = ['Home', 'People', 'Research', 'Publications', 'Theses', 'Mark Riedl'];
const titles = new Set(pages.map((item) => item.title));
const result = {
  target: wpUrl,
  verifiedAt: new Date().toISOString(),
  pages,
  media,
  reading,
  expectedPagesPresent: Object.fromEntries(expected.map((title) => [title, titles.has(title)])),
  mainPageStillPresent: titles.has('Main page'),
};

await fs.writeFile(path.join(outputDir, 'import-verify.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await context.close();
