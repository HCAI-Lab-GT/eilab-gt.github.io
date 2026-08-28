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
const ssoDeadline = Date.now() + 2 * 60 * 60 * 1000;
console.log('A Chromium window is open. Complete GT SSO/Duo if prompted. Waiting up to 2 hours for #wpadminbar...');
while (Date.now() < ssoDeadline) {
  if (await page.locator('#wpadminbar').count()) break;
  console.log(`Still waiting for dashboard. Current URL: ${page.url()}`);
  await page.waitForTimeout(15_000);
}
if (!(await page.locator('#wpadminbar').count())) {
  const currentUrl = page.url();
  await context.close();
  throw new Error(`Dashboard not reached. Current URL: ${currentUrl}`);
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
  async function getJson(url) {
    const res = await fetch(url, { credentials: 'same-origin', headers });
    const body = await res.json();
    return { status: res.status, body };
  }
  const pagesRes = await getJson(`${base}/wp-json/wp/v2/pages?per_page=100&context=edit&status=draft,publish,private,pending`);
  const mediaRes = await getJson(`${base}/wp-json/wp/v2/media?per_page=100`);
  const meRes = await getJson(`${base}/wp-json/wp/v2/users/me`);
  const pagesBody = pagesRes.body;
  const mediaBody = mediaRes.body;
  return {
    status: pagesRes.status,
    noncePresent: Boolean(nonce),
    meStatus: meRes.status,
    me: meRes.body && !meRes.body.code
      ? { id: meRes.body.id, slug: meRes.body.slug, name: meRes.body.name }
      : meRes.body,
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
    media: Array.isArray(mediaBody)
      ? mediaBody.map((item) => ({
          id: item.id,
          slug: item.slug,
          title: item.title?.raw || item.title?.rendered,
          sourceUrl: item.source_url,
          mime: item.mime_type,
        }))
      : mediaBody,
  };
}, wpUrl);

await page.goto(`${wpUrl}/wp-admin/edit.php?post_type=page&post_status=all`, { waitUntil: 'domcontentloaded' });
const pageCounts = (await page.locator('.subsubsub').innerText().catch(() => '')) || '';
const adminPages = await page.locator('#the-list tr').evaluateAll((rows) =>
  rows
    .map((row) => {
      const titleLink = row.querySelector('.row-title');
      return {
        id: row.id || null,
        title: titleLink?.textContent?.trim() || null,
        href: titleLink?.getAttribute('href') || null,
        status: row.querySelector('.post-state')?.textContent?.trim() || 'Published',
        author: row.querySelector('.author a, .author')?.textContent?.trim() || '',
      };
    })
    .filter((row) => row.title),
);
await page.screenshot({ path: path.join(outputDir, 'pages-latest.png'), fullPage: true });

await page.goto(`${wpUrl}/wp-admin/options-reading.php`, { waitUntil: 'domcontentloaded' });
const reading = {
  showOnFront: await page.locator('input[name="show_on_front"]:checked').getAttribute('value').catch(() => null),
  frontPageText: await page.locator('#page_on_front option:checked').textContent().catch(() => null),
  homeOptionPresent: Boolean(await page.locator('#page_on_front option').filter({ hasText: /^Home$/i }).count()),
};
await page.screenshot({ path: path.join(outputDir, 'reading-latest.png'), fullPage: true });

await shot('/wp-admin/options-general.php', 'general-latest.png');
const general = {
  title: await page.locator('#blogname').inputValue().catch(() => null),
  tagline: await page.locator('#blogdescription').inputValue().catch(() => null),
};

await page.goto(`${wpUrl}/wp-admin/nav-menus.php`, { waitUntil: 'domcontentloaded' });
const menus = {
  title: await page.title(),
  menuName: await page.locator('#menu-name').inputValue().catch(() => null),
  locations: await page.locator('.menu-settings-group, #nav-menu-theme-locations, .menu-theme-locations').innerText().catch(() => ''),
  items: await page.locator('#menu-to-edit .menu-item-title').allInnerTexts().catch(() => []),
};
await page.screenshot({ path: path.join(outputDir, 'menus-latest.png'), fullPage: true });

await page.goto(`${wpUrl}/wp-admin/upload.php?mode=list`, { waitUntil: 'domcontentloaded' });
const mediaList = await page.locator('#the-list tr').evaluateAll((rows) =>
  rows.slice(0, 40).map((row) => ({
    id: row.id || null,
    title: row.querySelector('.row-title, .filename, strong')?.textContent?.trim() || '',
    text: row.textContent?.replace(/\s+/g, ' ').trim().slice(0, 200) || '',
  })),
);
await page.screenshot({ path: path.join(outputDir, 'media-latest.png'), fullPage: true });

await page.goto(`${wpUrl}/wp-admin/themes.php`, { waitUntil: 'domcontentloaded' });
const theme = {
  title: await page.title(),
  active: await page.locator('.theme.active .theme-name, .theme.active h2').first().innerText().catch(() => null),
};
await page.screenshot({ path: path.join(outputDir, 'themes-latest.png'), fullPage: true });

await page.goto(`${wpUrl}/wp-admin/profile.php`, { waitUntil: 'domcontentloaded' });
const profileText = (await page.locator('#wpbody-content').innerText().catch(() => '')) || '';
const applicationPasswords = {
  sectionPresent: /application passwords/i.test(profileText),
  restMeAuthenticated: rest.meStatus === 200,
  note: 'Application Passwords are advertised but REST Basic Auth writes return 401 rest_not_logged_in. Cookie+nonce after SSO is read/inventory only.',
};
await page.screenshot({ path: path.join(outputDir, 'profile-latest.png'), fullPage: true });

const hcaiTitles = ['Home', 'People', 'Research', 'Publications', 'Theses', 'Mark Riedl'];
const leftoverHcaiDrafts = adminPages.filter((item) =>
  hcaiTitles.includes(item.title) || /-(?:2|3|4|5)$/.test(item.title || ''),
);
const result = {
  rest,
  pageCounts,
  adminPages,
  leftoverHcaiDrafts,
  reading,
  general,
  menus,
  mediaList,
  theme,
  applicationPasswords,
  savedAt: new Date().toISOString(),
};
await fs.writeFile(path.join(outputDir, 'inspect-latest.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await context.close();
