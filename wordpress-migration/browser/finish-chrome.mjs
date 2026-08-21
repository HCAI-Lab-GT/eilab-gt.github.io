import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadEnvFile } from './load-env.mjs';

const browserDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(browserDir, '..');
await loadEnvFile(path.join(rootDir, '.env'));

const wpUrl = (process.env.WP_URL || '').replace(/\/$/, '');
const outputDir = path.join(rootDir, 'build', 'admin-configuration');
const profileDir = path.join(browserDir, '.auth', 'gt-wordpress');
await fs.mkdir(outputDir, { recursive: true });

const menuPages = [
  { title: 'Home', id: '9069' },
  { title: 'People', id: '9070' },
  { title: 'Research', id: '9071' },
  { title: 'Publications', id: '9072' },
  { title: 'Theses', id: '9073' },
  { title: 'Mark Riedl', id: '9074' },
];
const trashIds = ['9036', '9037', '9020', '9021', '9010', '9011', '9012'];

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1440, height: 1000 },
});
const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(25_000);

async function waitForAdmin() {
  await page.goto(`${wpUrl}/wp-admin/`, { waitUntil: 'domcontentloaded' });
  const deadline = Date.now() + 2 * 60 * 60 * 1000;
  console.log('Complete GT SSO/Duo if prompted. Waiting up to 2 hours for #wpadminbar...');
  while (Date.now() < deadline) {
    if (await page.locator('#wpadminbar').count()) return;
    console.log(`Still waiting for dashboard. Current URL: ${page.url()}`);
    await page.waitForTimeout(15_000);
  }
  throw new Error(`Dashboard not reached. Current URL: ${page.url()}`);
}

async function shot(name) {
  await page.screenshot({ path: path.join(outputDir, name), fullPage: true });
}

const result = { startedAt: new Date().toISOString(), actions: [], warnings: [] };
await waitForAdmin();

await page.goto(`${wpUrl}/wp-admin/options-reading.php`, { waitUntil: 'domcontentloaded' });
const frontOptions = await page.locator('#page_on_front option').evaluateAll((opts) =>
  opts.map((opt) => ({ value: opt.value, text: opt.textContent.trim() })),
);
result.frontPageOptions = frontOptions;
result.homeInFrontDropdown = frontOptions.some((opt) => /^Home$/i.test(opt.text));
await shot('reading-options.png');
if (result.homeInFrontDropdown) {
  const home = frontOptions.find((opt) => /^Home$/i.test(opt.text));
  await page.locator('input[name="show_on_front"][value="page"]').check();
  await page.locator('#page_on_front').selectOption(home.value);
  await page.locator('#submit').click();
  await page.waitForLoadState('domcontentloaded');
  result.actions.push(`assigned Home ID ${home.value} as front page`);
} else {
  result.warnings.push('Home is a draft so it is omitted from the Reading dropdown. Preview is the remaining blocker.');
}

await page.goto(`${wpUrl}/wp-admin/nav-menus.php`, { waitUntil: 'domcontentloaded' });
const mostRecent = page.locator('#add-post-type-page').getByRole('link', { name: /Most Recent/i });
if (await mostRecent.count()) await mostRecent.click();
await page.waitForTimeout(600);
for (const item of menuPages) {
  const label = page.locator('#add-post-type-page label').filter({ hasText: new RegExp(`^${item.title}(?:\\s|$)`, 'i') }).first();
  if (await label.count()) {
    await label.click();
    result.actions.push(`checked Most Recent: ${item.title}`);
  }
}
const addVisible = page.locator('#add-post-type-page .button-controls .submit-add-to-menu:visible, #add-post-type-page #submit-posttype-page');
if (await addVisible.count()) {
  await addVisible.first().click();
  await page.waitForTimeout(1200);
}

const searchTab = page.locator('#add-post-type-page').getByRole('link', { name: /^Search$/i });
if (await searchTab.count()) await searchTab.click();
for (const item of menuPages) {
  const already = await page.locator('#menu-to-edit .menu-item-title').filter({ hasText: new RegExp(`^${item.title}$`, 'i') }).count();
  if (already) continue;
  const search = page.locator('#quick-search-posttype-page');
  if (await search.count()) {
    await search.fill(item.title);
    await page.waitForTimeout(900);
  }
  const hit = page.locator('#tabs-panel-posttype-page-search label, #quick-search-results-posttype-page label').filter({ hasText: new RegExp(item.title, 'i') }).first();
  if (await hit.count()) {
    await hit.click();
    const addSearch = page.locator('#tabs-panel-posttype-page-search').locator('input[type="submit"].submit-add-to-menu, .submit-add-to-menu').first();
    if (await addSearch.count()) await addSearch.click();
    else if (await addVisible.count()) await addVisible.first().click();
    await page.waitForTimeout(800);
    result.actions.push(`search-added ${item.title}`);
  } else {
    const custom = page.locator('#add-custom-links .accordion-section-title');
    if (await custom.count()) {
      const parent = page.locator('#add-custom-links');
      if (!((await parent.getAttribute('class')) || '').includes('open')) await custom.click();
    }
    await page.locator('#custom-menu-item-url').fill(`${wpUrl}/?page_id=${item.id}`);
    await page.locator('#custom-menu-item-name').fill(item.title);
    await page.locator('#submit-customlinkdiv, #customlinkdiv input[type="submit"]').first().click();
    await page.waitForTimeout(800);
    result.actions.push(`custom-link ${item.title} -> page_id=${item.id}`);
  }
}

const stale = page.locator('#menu-to-edit .menu-item-title').filter({ hasText: /^(Main page|Sample Page)$/i });
const staleCount = await stale.count();
for (let index = staleCount - 1; index >= 0; index -= 1) {
  const li = stale.nth(index).locator('xpath=ancestor::li[contains(@class,"menu-item")][1]');
  await li.locator('.item-edit').click();
  await page.waitForTimeout(250);
  await li.locator('a.item-delete').click();
  await page.waitForTimeout(250);
}
result.actions.push(`removed ${staleCount} stale items`);

const locationBoxes = page.locator('.menu-settings-input input[type="checkbox"]');
const locCount = await locationBoxes.count();
for (let index = 0; index < locCount; index += 1) {
  const box = locationBoxes.nth(index);
  const label = ((await box.locator('xpath=..').innerText().catch(() => '')) || '').toLowerCase();
  if (label.includes('desktop') || label.includes('mobile') || label.includes('main menu')) {
    await box.check().catch(() => {});
  }
}
await page.locator('#save_menu_header, #save_menu_footer').first().click();
await page.waitForLoadState('domcontentloaded');
result.menuItems = await page.locator('#menu-to-edit .menu-item-title').allInnerTexts().catch(() => []);
await shot('menus-result.png');

await page.goto(`${wpUrl}/wp-admin/upload.php?mode=list`, { waitUntil: 'domcontentloaded' });
for (const id of trashIds) {
  const checkbox = page.locator(`#cb-select-${id}`);
  if (await checkbox.count()) await checkbox.check();
}
const bulk = page.locator('#bulk-action-selector-top');
if (await bulk.count()) {
  const options = await bulk.locator('option').evaluateAll((opts) => opts.map((opt) => ({ value: opt.value, text: opt.textContent.trim() })));
  result.mediaBulkOptions = options;
  const deleteOpt = options.find((opt) => /delete|trash/i.test(opt.value) || /delete|trash/i.test(opt.text));
  if (deleteOpt) {
    await bulk.selectOption(deleteOpt.value);
    page.once('dialog', (dialog) => dialog.accept().catch(() => {}));
    await page.locator('#doaction').click();
    await page.waitForLoadState('domcontentloaded');
    result.actions.push(`bulk media action ${deleteOpt.value} on ${trashIds.join(',')}`);
  }
}
await shot('media-after-trash.png');
result.mediaRemaining = await page.locator('#the-list tr .filename, #the-list tr .row-title, #the-list .has-media-icon + strong').allInnerTexts().catch(() => []);

result.finishedAt = new Date().toISOString();
await fs.writeFile(path.join(outputDir, 'finish-chrome.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await context.close();
