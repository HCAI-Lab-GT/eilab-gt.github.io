import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadEnvFile } from './load-env.mjs';

const browserDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(browserDir, '..');
await loadEnvFile(path.join(rootDir, '.env'));

const wpUrl = (process.env.WP_URL || '').replace(/\/$/, '');
if (!wpUrl) throw new Error('WP_URL is missing');

const profileDir = path.join(browserDir, '.auth', 'gt-wordpress');
const outputDir = path.join(rootDir, 'build', 'publish-live');
await fs.mkdir(outputDir, { recursive: true });

const pagesToPublish = [
  { title: 'Home', id: '9069', slug: 'home', path: '/' },
  { title: 'People', id: '9070', slug: 'people', path: '/people/' },
  { title: 'Research', id: '9071', slug: 'research', path: '/research/' },
  { title: 'Publications', id: '9072', slug: 'publications', path: '/publications/' },
  { title: 'Theses', id: '9073', slug: 'theses', path: '/theses/' },
  { title: 'Mark Riedl', id: '9074', slug: 'mark-riedl', path: '/mark-riedl/' },
];
const retireTitles = /^(Sample Page|Main page)$/i;

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1440, height: 1000 },
});
const page = context.pages()[0] || (await context.newPage());
page.setDefaultTimeout(30_000);
page.on('dialog', (dialog) => dialog.accept().catch(() => {}));

const result = {
  startedAt: new Date().toISOString(),
  actions: [],
  warnings: [],
  published: [],
  publicUrls: [],
};

async function sleep(ms) {
  await page.waitForTimeout(ms);
}

async function shot(name) {
  await page.screenshot({ path: path.join(outputDir, name), fullPage: true }).catch(() => {});
}

async function waitForAdmin() {
  console.log('SSO WINDOW OPEN — complete GT SSO/Duo if prompted.');
  await page.goto(`${wpUrl}/wp-admin/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const deadline = Date.now() + 2 * 60 * 60 * 1000;
  while (Date.now() < deadline) {
    if (page.isClosed() || !context.pages().length) throw new Error('browser closed');
    if (await page.locator('#wpadminbar').count()) {
      result.actions.push(`dashboard ${page.url()}`);
      return;
    }
    const url = page.url();
    console.log(`waiting for dashboard at ${url}`);
    if (url === 'about:blank' || /TicketValidationFilter|idp\.gatech\.edu/i.test(url)) {
      await page.goto(`${wpUrl}/wp-admin/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    await sleep(10_000);
  }
  throw new Error(`dashboard not reached: ${page.url()}`);
}

async function publishPage(item) {
  await page.goto(`${wpUrl}/wp-admin/post.php?post=${item.id}&action=edit`, { waitUntil: 'domcontentloaded' });
  await sleep(1400);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForFunction(() => Boolean(window.wp?.data?.select && window.wp?.data?.dispatch), { timeout: 25_000 });
  const saved = await page.evaluate(async (nextSlug) => {
    const select = wp.data.select('core/editor');
    const dispatch = wp.data.dispatch('core/editor');
    const post = select.getCurrentPost();
    if (post.slug !== nextSlug) {
      dispatch.editPost({ slug: nextSlug });
    }
    dispatch.editPost({ status: 'publish', slug: nextSlug });
    await dispatch.savePost();
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      if (!select.isSavingPost() && !select.isAutosavingPost()) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const after = select.getCurrentPost();
    return { status: after.status, slug: after.slug, id: after.id, link: after.link };
  }, item.slug);
  result.published.push({ ...item, ...saved });
  result.actions.push(`published ${item.slug} status=${saved.status} slug=${saved.slug}`);
  await shot(`editor-${item.slug}.png`);
  if (saved.status !== 'publish') result.warnings.push(`${item.slug} status is ${saved.status}`);
  if (saved.slug !== item.slug) result.warnings.push(`${item.id} slug became ${saved.slug}`);
}

async function retirePage(id, title) {
  await page.goto(`${wpUrl}/wp-admin/post.php?post=${id}&action=edit`, { waitUntil: 'domcontentloaded' });
  await sleep(1200);
  await page.keyboard.press('Escape').catch(() => {});
  const usedGutenberg = await page.evaluate(async () => {
    if (!window.wp?.data?.dispatch) return false;
    const select = wp.data.select('core/editor');
    const dispatch = wp.data.dispatch('core/editor');
    dispatch.editPost({ status: 'draft' });
    await dispatch.savePost();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (!select.isSavingPost()) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return select.getCurrentPost().status;
  }).catch(() => null);
  if (usedGutenberg) {
    result.actions.push(`retired ${title} (${id}) to ${usedGutenberg}`);
    return;
  }
  const status = page.locator('#post_status, select[name="post_status"]');
  if (await status.count()) await status.selectOption('draft').catch(() => {});
  const save = page.locator('#save-post, #publish');
  if (await save.count()) await save.first().click();
  await page.waitForLoadState('domcontentloaded');
  result.actions.push(`retired ${title} (${id}) via classic`);
}

async function setFrontPage() {
  await page.goto(`${wpUrl}/wp-admin/options-reading.php`, { waitUntil: 'domcontentloaded' });
  const options = await page.locator('#page_on_front option').evaluateAll((opts) =>
    opts.map((opt) => ({ value: opt.value, text: opt.textContent.trim() })),
  );
  result.frontPageOptions = options;
  const home = options.find((opt) => /^Home$/i.test(opt.text) || opt.value === '9069');
  if (!home) {
    result.warnings.push('Home still missing from Reading dropdown');
    await shot('reading-missing-home.png');
    return;
  }
  await page.locator('input[name="show_on_front"][value="page"]').check();
  await page.locator('#page_on_front').selectOption(home.value);
  await page.locator('#submit').click();
  await page.waitForLoadState('domcontentloaded');
  result.actions.push(`front page = ${home.text} (${home.value})`);
  await shot('reading-after.png');
}

async function updateMenuUrls() {
  await page.goto(`${wpUrl}/wp-admin/nav-menus.php`, { waitUntil: 'domcontentloaded' });
  await sleep(800);
  const items = page.locator('#menu-to-edit .menu-item');
  const n = await items.count();
  for (let i = 0; i < n; i += 1) {
    const item = items.nth(i);
    const title = ((await item.locator('.menu-item-title').innerText().catch(() => '')) || '').trim();
    const match = pagesToPublish.find((p) => p.title.toLowerCase() === title.toLowerCase());
    if (!match) continue;
    await item.locator('.item-edit').click({ force: true }).catch(() => {});
    await sleep(250);
    const urlBox = item.locator('input.edit-menu-item-url, input[name*="[url]"]');
    if (await urlBox.count()) {
      const next = match.slug === 'home' ? `${wpUrl}/` : `${wpUrl}${match.path}`;
      await urlBox.fill(next);
      result.actions.push(`menu ${title} -> ${next}`);
    }
  }
  const saveBtn = page.locator('#save_menu_footer');
  if (await saveBtn.count()) {
    await saveBtn.scrollIntoViewIfNeeded();
    await saveBtn.click({ force: true });
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await sleep(800);
    result.actions.push('saved menu URLs');
  }
  await shot('menu-after.png');
}

async function verifyPublic() {
  for (const item of pagesToPublish) {
    const url = item.slug === 'home' ? `${wpUrl}/` : `${wpUrl}${item.path}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    await sleep(800);
    const title = await page.title();
    const body = (await page.locator('body').innerText().catch(() => '')) || '';
    const proof = {
      url: page.url(),
      title,
      hasPreviewQuery: /preview=true/.test(page.url()),
      hasContent: body.length > 200,
      hasMigrated: /Migrated page/.test(body),
    };
    result.publicUrls.push(proof);
    result.actions.push(`public ${item.slug} ${JSON.stringify(proof)}`);
    await page.screenshot({ path: path.join(outputDir, `public-${item.slug}.png`), fullPage: true }).catch(() => {});
  }
}

try {
  await waitForAdmin();
  await page.goto(`${wpUrl}/wp-admin/edit.php?post_type=page&post_status=all`, { waitUntil: 'domcontentloaded' });
  const retire = await page.locator('#the-list tr').evaluateAll((rows, patternSource) => {
    const re = new RegExp(patternSource, 'i');
    return rows
      .map((row) => ({
        id: (row.id || '').replace(/^post-/, ''),
        title: row.querySelector('.row-title')?.textContent?.trim() || '',
      }))
      .filter((row) => re.test(row.title));
  }, retireTitles.source);
  result.retireCandidates = retire;

  for (const item of pagesToPublish) await publishPage(item);
  for (const row of retire) {
    if (!row.id) continue;
    await retirePage(row.id, row.title);
  }
  await setFrontPage();
  await updateMenuUrls();

  await page.goto(`${wpUrl}/wp-admin/edit.php?post_type=page&post_status=all`, { waitUntil: 'domcontentloaded' });
  result.pageCounts = (await page.locator('.subsubsub').innerText().catch(() => '')) || '';
  await shot('pages-after.png');
  await verifyPublic();

  result.theme = await page.goto(`${wpUrl}/wp-admin/themes.php`, { waitUntil: 'domcontentloaded' }).then(async () =>
    page.locator('.theme.active .theme-name, .theme.active h2').first().innerText().catch(() => null),
  );
  result.cnameUntouched = true;
} catch (error) {
  result.warnings.push(`fatal: ${error.message}`);
  await shot('publish-fatal.png');
} finally {
  result.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(outputDir, 'publish-live.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await context.close().catch(() => {});
}
