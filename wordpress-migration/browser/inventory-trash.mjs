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
  headless: false,
  viewport: { width: 1440, height: 1000 },
});
const page = context.pages()[0] || (await context.newPage());
page.setDefaultTimeout(20_000);

console.log('SSO WINDOW OPEN — this script never imports.');
await page.goto(`${wpUrl}/wp-admin/edit.php?post_type=page&post_status=trash`, { waitUntil: 'domcontentloaded' });
const deadline = Date.now() + 2 * 60 * 60 * 1000;
while (Date.now() < deadline) {
  if (await page.locator('#wpadminbar').count()) break;
  console.log(`Waiting. ${page.url()}`);
  await page.waitForTimeout(10_000);
}
await page.goto(`${wpUrl}/wp-admin/edit.php?post_type=page&post_status=trash`, { waitUntil: 'domcontentloaded' });
await page.screenshot({ path: path.join(outputDir, 'pages-trash.png'), fullPage: true });

const rows = await page.locator('#the-list tr').evaluateAll((nodes) =>
  nodes
    .map((row) => {
      const checkbox = row.querySelector('input[type="checkbox"][name="post[]"], th.check-column input[type="checkbox"]');
      const title =
        row.querySelector('.row-title')?.textContent?.trim() ||
        row.querySelector('.column-title strong, td.title strong, td.column-title')?.textContent?.trim() ||
        (row.querySelector('td')?.innerText || '').split('\n')[0].trim();
      return {
        id: (row.id || '').replace(/^post-/, '') || checkbox?.value || null,
        title: title || null,
        checkboxValue: checkbox?.value || null,
        classes: row.className,
        text: (row.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 240),
      };
    })
    .filter((row) => row.title && row.title !== 'Title'),
);
const sampleSlugs = [];
for (const row of rows.slice(0, 6)) {
  if (!row.id) continue;
  await page.goto(`${wpUrl}/wp-admin/post.php?post=${row.id}&action=edit`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const observed = await page.evaluate(() => {
    let slug = '';
    let status = '';
    try {
      const post = window.wp?.data?.select('core/editor')?.getCurrentPost?.();
      slug = post?.slug || '';
      status = post?.status || '';
    } catch {
      slug = '';
    }
    return { slug, status, title: document.title };
  });
  sampleSlugs.push({ id: row.id, title: row.title, ...observed });
}
await page.goto(`${wpUrl}/wp-admin/edit.php?post_type=page&post_status=trash&paged=2`, { waitUntil: 'domcontentloaded' });
await page.screenshot({ path: path.join(outputDir, 'pages-trash-page2.png'), fullPage: true });
const counts = (await page.locator('.subsubsub').innerText().catch(() => '')) || '';
const result = {
  verifiedAt: new Date().toISOString(),
  counts,
  count: rows.length,
  rows,
  sampleSlugs,
  note: 'Trash is leftover from earlier import loops. Live drafts 9069-9074 already hold canonical slugs; trash was not emptied.',
};
await fs.writeFile(path.join(outputDir, 'pages-trash.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await context.close();
