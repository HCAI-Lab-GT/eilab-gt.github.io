import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadEnvFile } from './load-env.mjs';

const browserDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(browserDir, '..');
await loadEnvFile(path.join(rootDir, '.env'));
const wpUrl = (process.env.WP_URL || '').replace(/\/$/, '');
const profileDir = path.join(browserDir, '.auth', 'gt-wordpress');
const outPath = path.join(rootDir, 'build', 'admin-discovery', 'draft-pages.json');

const context = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  viewport: { width: 1280, height: 900 },
});
const page = context.pages()[0] || await context.newPage();
await page.goto(`${wpUrl}/wp-admin/`, { waitUntil: 'domcontentloaded' });
if (!page.url().includes('/wp-admin/') || !(await page.locator('#wpadminbar').count())) {
  await context.close();
  throw new Error(`Admin session expired at ${page.url()}`);
}

const payload = await page.evaluate(async (base) => {
  const nonce = window.wpApiSettings?.nonce || window.wp?.apiFetch?.nonce || null;
  const headers = { Accept: 'application/json' };
  if (nonce) headers['X-WP-Nonce'] = nonce;
  const res = await fetch(`${base}/wp-json/wp/v2/pages?per_page=100&context=edit&status=draft,publish,private`, {
    credentials: 'same-origin',
    headers,
  });
  const body = await res.json();
  return {
    status: res.status,
    noncePresent: Boolean(nonce),
    pages: Array.isArray(body)
      ? body.map((item) => ({
          id: item.id,
          slug: item.slug,
          status: item.status,
          title: item.title?.raw || item.title?.rendered,
          link: item.link,
          contentChars: (item.content?.raw || item.content?.rendered || '').length,
        }))
      : { error: body },
  };
}, wpUrl);

await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
console.log(JSON.stringify(payload, null, 2));
await context.close();
