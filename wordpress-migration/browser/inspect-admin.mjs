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
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(profileDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1440, height: 1000 },
});
const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(20_000);

await page.goto(`${wpUrl}/wp-admin/`, { waitUntil: 'domcontentloaded' });
console.log('A Chromium window is open. Complete GT SSO/Duo if prompted. Waiting up to 10 minutes for the dashboard...');
try {
  await page.waitForSelector('#wpadminbar', { timeout: 10 * 60 * 1000 });
} catch {
  await context.close();
  throw new Error(`Dashboard not reached. Current URL: ${page.url()}`);
}
await page.goto(`${wpUrl}/wp-admin/`, { waitUntil: 'domcontentloaded' });

async function shot(pathname, name) {
  await page.goto(`${wpUrl}${pathname}`, { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: path.join(outputDir, name), fullPage: true });
}

const rest = await page.evaluate(async (base) => {
  const nonce = window.wpApiSettings?.nonce || null;
  const headers = { Accept: 'application/json' };
  if (nonce) headers['X-WP-Nonce'] = nonce;
  const pagesRes = await fetch(`${base}/wp-json/wp/v2/pages?per_page=100&context=edit&status=draft,publish,private,pending`, {
    credentials: 'same-origin',
    headers,
  });
  const pagesBody = await pagesRes.json();
  return {
    status: pagesRes.status,
    noncePresent: Boolean(nonce),
    pages: Array.isArray(pagesBody)
      ? pagesBody.map((item) => ({
          id: item.id,
          slug: item.slug,
          status: item.status,
          title: item.title?.raw || item.title?.rendered,
          link: item.link,
          contentChars: (item.content?.raw || item.content?.rendered || '').length,
          hasTable: String(item.content?.raw || item.content?.rendered || '').includes('<table'),
          hasHcailabResearch: String(item.content?.raw || item.content?.rendered || '').includes('/hcailab/research/'),
          hasWpMedia: String(item.content?.raw || item.content?.rendered || '').includes('/hcailab/files/'),
        }))
      : pagesBody,
  };
}, wpUrl);

await shot('/wp-admin/edit.php?post_type=page&post_status=all', 'pages-latest.png');
await shot('/wp-admin/options-reading.php', 'reading-latest.png');
await shot('/wp-admin/nav-menus.php', 'menus-latest.png');
await shot('/wp-admin/upload.php', 'media-latest.png');

const reading = {
  showOnFront: await page.locator('input[name="show_on_front"]:checked').getAttribute('value').catch(() => null),
  frontPageText: await page.locator('#page_on_front option:checked').textContent().catch(() => null),
  homeOptionPresent: Boolean(await page.locator('#page_on_front option').filter({ hasText: /^Home$/i }).count()),
};

await page.goto(`${wpUrl}/wp-admin/nav-menus.php`, { waitUntil: 'domcontentloaded' });
const menus = {
  title: await page.title(),
  locations: await page.locator('.menu-theme-locations, #nav-menu-theme-locations, .manage-menus').innerText().catch(() => ''),
};

const result = { rest, reading, menus, savedAt: new Date().toISOString() };
await fs.writeFile(path.join(outputDir, 'inspect-latest.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await context.close();
