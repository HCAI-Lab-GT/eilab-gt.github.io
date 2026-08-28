import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadEnvFile } from './load-env.mjs';

const browserDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(browserDir, '..');
await loadEnvFile(path.join(rootDir, '.env'));

const wpUrl = (process.env.WP_URL || '').replace(/\/$/, '');
if (!wpUrl) throw new Error('WP_URL is missing from wordpress-migration/.env');

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
const keepMedia = ['davinci-banner.jpeg', 'mark-potato.jpg'];
const trashMedia = [
  'davinci-banner-1.jpeg',
  'davinci-banner-2.jpeg',
  'davinci-banner-3.jpeg',
  'mark-potato-1.jpg',
  'mark-potato-2.jpg',
  'mark-potato-3.jpg',
  'hcai-lab.wordpress.xml.txt',
];

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1440, height: 1000 },
});
const page = context.pages()[0] || (await context.newPage());
page.setDefaultTimeout(20_000);

const result = {
  startedAt: new Date().toISOString(),
  actions: [],
  warnings: [],
  trashedMedia: [],
};

async function shot(name) {
  await page.screenshot({ path: path.join(outputDir, name), fullPage: true }).catch(() => {});
}

async function sleep(ms) {
  try {
    await page.waitForTimeout(ms);
  } catch (error) {
    if (/closed|Target page/i.test(String(error))) throw error;
  }
}

async function waitForAdmin() {
  console.log('SSO WINDOW OPEN — complete GT SSO/Duo in Google Chrome for Testing.');
  console.log('Do not close the window. This script never imports.');
  await page.goto(`${wpUrl}/wp-admin/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const deadline = Date.now() + 2 * 60 * 60 * 1000;
  while (Date.now() < deadline) {
    if (page.isClosed() || !context.pages().length) {
      throw new Error('Chrome for Testing was closed before #wpadminbar appeared.');
    }
    if (await page.locator('#wpadminbar').count()) {
      result.actions.push(`dashboard reached at ${page.url()}`);
      return;
    }
    const url = page.url();
    console.log(`Still waiting for dashboard. Current URL: ${url}`);
    if (url === 'about:blank' || /TicketValidationFilter|idp\.gatech\.edu/i.test(url)) {
      await page.goto(`${wpUrl}/wp-admin/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    await sleep(10_000);
  }
  throw new Error(`Dashboard not reached. Current URL: ${page.url()}`);
}

async function menuTitles() {
  return page.locator('#menu-to-edit .menu-item-title').allInnerTexts().catch(() => []);
}

async function menuHas(title) {
  return (await page.locator('#menu-to-edit .menu-item-title').filter({ hasText: new RegExp(`^${escapeRe(title)}$`, 'i') }).count()) > 0;
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function addCustomLink(title, id) {
  const section = page.locator('#add-custom-links');
  const cls = (await section.getAttribute('class')) || '';
  if (!cls.includes('open')) {
    await section.locator('.accordion-section-title').click();
    await sleep(400);
  }
  await page.locator('#custom-menu-item-url').fill(`${wpUrl}/?page_id=${id}`);
  await page.locator('#custom-menu-item-name').fill(title);
  await page.locator('#submit-customlinkdiv').click();
  await sleep(1400);
  return menuHas(title);
}

async function removeMenuItems(pattern) {
  const titles = page.locator('#menu-to-edit .menu-item-title').filter({ hasText: pattern });
  const count = await titles.count();
  for (let index = count - 1; index >= 0; index -= 1) {
    const li = titles.nth(index).locator('xpath=ancestor::li[contains(@class,"menu-item")][1]');
    await li.locator('.item-edit').click();
    await sleep(250);
    await li.locator('a.item-delete').click();
    await sleep(250);
  }
  return count;
}

async function writeResult() {
  result.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(outputDir, 'finish-chrome.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

try {
  await waitForAdmin();

  try {
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
  } catch (error) {
    result.warnings.push(`Reading settings failed: ${error.message}`);
    await shot('reading-error.png');
  }

  try {
    await page.goto(`${wpUrl}/wp-admin/nav-menus.php`, { waitUntil: 'domcontentloaded' });
    const pagesAccordion = page.locator('#add-post-type-page');
    if (await pagesAccordion.count()) {
      const open = (await pagesAccordion.getAttribute('class')) || '';
      if (!open.includes('open')) await pagesAccordion.locator('.accordion-section-title').click();
    }

    for (const item of menuPages) {
      if (await menuHas(item.title)) {
        result.actions.push(`already in menu: ${item.title}`);
        continue;
      }
      const added = await addCustomLink(item.title, item.id);
      result.actions.push(added ? `custom-link ${item.title} -> page_id=${item.id}` : `FAILED to add ${item.title}`);
      if (!added) result.warnings.push(`menu item missing after custom link: ${item.title}`);
    }

    const staleCount = await removeMenuItems(/^(Main page|Sample Page)$/i);
    result.actions.push(`removed ${staleCount} stale items`);

    const autoAdd = page.locator('input[name="auto-add-pages"]');
    if (await autoAdd.count()) await autoAdd.uncheck().catch(() => {});

    const locationBoxes = page.locator('.menu-settings-input input[type="checkbox"]');
    const locCount = await locationBoxes.count();
    for (let index = 0; index < locCount; index += 1) {
      const box = locationBoxes.nth(index);
      const label = ((await box.locator('xpath=..').innerText().catch(() => '')) || '').toLowerCase();
      if (label.includes('desktop') || label.includes('mobile') || label.includes('main menu')) {
        await box.check().catch(() => {});
      }
    }

    const saveBtn = page.locator('#save_menu_footer');
    await saveBtn.scrollIntoViewIfNeeded();
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      saveBtn.click({ force: true }),
    ]);
    result.menuItems = await menuTitles();
    result.menuLocations = await page.locator('.menu-settings-input').allInnerTexts().catch(() => []);
    result.actions.push('saved menu');
    await shot('menus-result.png');
    const locationsTab = page.getByRole('link', { name: /Manage Locations/i });
    if (await locationsTab.count()) {
      await locationsTab.click();
      await page.waitForLoadState('domcontentloaded');
      result.manageLocations = (await page.locator('#menu-locations-wrap, .manage-menus, form').innerText().catch(() => '')) || '';
      await shot('menu-locations.png');
    }
  } catch (error) {
    result.warnings.push(`Menu update failed: ${error.message}`);
    result.menuItems = await menuTitles();
    await shot('menus-error.png');
  }

  try {
    await page.goto(`${wpUrl}/wp-admin/upload.php?mode=list`, { waitUntil: 'domcontentloaded' });
    page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
    const bulk = page.locator('#bulk-action-selector-top');
    const bulkOptions = await bulk.locator('option').evaluateAll((opts) =>
      opts.map((opt) => ({ value: opt.value, text: opt.textContent.trim() })),
    );
    result.mediaBulkOptions = bulkOptions;
    const deleteOpt = bulkOptions.find((opt) => /delete|trash/i.test(opt.value) || /delete|trash/i.test(opt.text));
    let checked = 0;
    const trashIds = ['9036', '9037', '9020', '9021', '9010', '9011', '9012'];
    for (const id of trashIds) {
      const checkbox = page.locator(`#cb-select-${id}`);
      if (await checkbox.count()) {
        await checkbox.check({ force: true });
        checked += 1;
      }
    }
    if (deleteOpt && checked) {
      await bulk.selectOption(deleteOpt.value);
      await page.locator('#doaction').click();
      await page.waitForLoadState('domcontentloaded');
      result.actions.push(`bulk media ${deleteOpt.value} on ${checked} items`);
    }

    for (const filename of trashMedia) {
      const row = page.locator('#the-list tr').filter({ hasText: filename }).first();
      if (!(await row.count())) {
        if (!result.trashedMedia.includes(filename)) result.trashedMedia.push(filename);
        continue;
      }
      const rowId = (await row.getAttribute('id')) || '';
      if (rowId === 'post-9001' || rowId === 'post-9002') continue;
      const del = row.locator('a.submitdelete, .row-actions .delete a, a:has-text("Delete Permanently")').first();
      if (await del.count()) {
        await del.click({ force: true });
        await sleep(900);
        result.trashedMedia.push(filename);
        result.actions.push(`force-deleted media ${filename}`);
      } else {
        result.warnings.push(`no delete link for ${filename}`);
      }
    }
    await shot('media-after-trash.png');
    result.mediaRemaining = await page
      .locator('#the-list tr')
      .evaluateAll((rows) =>
        rows
          .map((row) => ({
            id: row.id || null,
            title: row.querySelector('.row-title, .filename, strong')?.textContent?.trim() || null,
            text: (row.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 180),
          }))
          .filter((row) => row.title),
      );
    const leftoverCopies = (result.mediaRemaining || []).filter((row) =>
      trashMedia.some((name) => (row.text || '').includes(name)),
    );
    if (leftoverCopies.length) {
      result.warnings.push(`media copies still present: ${leftoverCopies.map((row) => row.text).join(' | ')}`);
    }
    const kept = (result.mediaRemaining || []).filter((row) =>
      keepMedia.some((name) => (row.text || '').includes(name) && !/-(\d+)\.(jpeg|jpg)$/i.test(name)),
    );
    result.keptMedia = kept;
  } catch (error) {
    result.warnings.push(`Media delete failed: ${error.message}`);
    await shot('media-error.png');
  }

  try {
    await page.goto(`${wpUrl}/wp-admin/edit.php?post_type=page&post_status=all`, { waitUntil: 'domcontentloaded' });
    result.pages = await page.locator('#the-list tr').evaluateAll((rows) =>
      rows
        .map((row) => ({
          id: row.id || null,
          title: row.querySelector('.row-title')?.textContent?.trim() || null,
          status: row.querySelector('.post-state')?.textContent?.trim() || 'Published',
        }))
        .filter((row) => row.title),
    );
    result.pageCounts = (await page.locator('.subsubsub').innerText().catch(() => '')) || '';
    await shot('pages-after-chrome.png');
  } catch (error) {
    result.warnings.push(`Page inventory failed: ${error.message}`);
  }
} catch (error) {
  result.warnings.push(`fatal: ${error.message}`);
  await shot('finish-chrome-fatal.png');
} finally {
  await writeResult();
  await context.close().catch(() => {});
}
