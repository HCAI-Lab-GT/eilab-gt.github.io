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

const tagline = 'Georgia Institute of Technology';
const menuPages = ['Home', 'People', 'Research', 'Publications', 'Theses', 'Mark Riedl'];
const trashMediaNames = [
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
const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(30_000);

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

const result = {
  startedAt: new Date().toISOString(),
  actions: [],
  warnings: [],
};

await waitForAdmin();

try {
  await page.goto(`${wpUrl}/wp-admin/options-general.php`, { waitUntil: 'domcontentloaded' });
  const currentTitle = await page.locator('#blogname').inputValue();
  await page.locator('#blogdescription').fill(tagline);
  await page.locator('#submit').click();
  await page.waitForLoadState('domcontentloaded');
  result.actions.push(`kept site title: ${currentTitle}`);
  result.actions.push(`set tagline: ${tagline}`);
  await shot('general-settings-result.png');
} catch (error) {
  result.warnings.push(`General settings failed: ${error.message}`);
}

try {
  await page.goto(`${wpUrl}/wp-admin/options-reading.php`, { waitUntil: 'domcontentloaded' });
  const homeOption = page.locator('#page_on_front option').filter({ hasText: /^Home$/i }).first();
  if (!(await homeOption.count())) {
    throw new Error('Home is not in the front-page dropdown.');
  }
  const homeValue = await homeOption.getAttribute('value');
  await page.locator('input[name="show_on_front"][value="page"]').check();
  await page.locator('#page_on_front').selectOption(homeValue);
  await page.locator('#submit').click();
  await page.waitForLoadState('domcontentloaded');
  result.actions.push(`assigned Home (ID ${homeValue}) as static front page`);
  result.frontPageId = homeValue;
  await shot('reading-settings-result.png');
} catch (error) {
  result.warnings.push(`Front-page assignment failed: ${error.message}`);
}

try {
  await page.goto(`${wpUrl}/wp-admin/nav-menus.php`, { waitUntil: 'domcontentloaded' });
  const pageAccordion = page.locator('#add-post-type-page');
  if (await pageAccordion.count()) {
    const open = await pageAccordion.getAttribute('class');
    if (open && !open.includes('open')) {
      await pageAccordion.locator('.accordion-section-title').click();
    }
  }
  const viewAll = page.locator('#add-post-type-page').getByRole('link', { name: /^View All$/i });
  if (await viewAll.count()) await viewAll.click();
  await page.waitForTimeout(500);
  for (const title of menuPages) {
    const box = page.locator('#add-post-type-page label').filter({ hasText: new RegExp(`^${title}$`, 'i') }).first();
    if (await box.count()) {
      await box.click();
      result.actions.push(`checked menu page: ${title}`);
    } else {
      result.warnings.push(`menu page checkbox missing: ${title}`);
    }
  }
  const addToMenu = page.locator('#add-post-type-page .button-controls .submit-add-to-menu, #add-post-type-page input[type="submit"]');
  if (await addToMenu.count()) await addToMenu.first().click();
  await page.waitForTimeout(1500);

  const stale = page.locator('#menu-to-edit .menu-item-title').filter({ hasText: /^(Main page|Sample Page)$/i });
  const staleCount = await stale.count();
  for (let index = staleCount - 1; index >= 0; index -= 1) {
    const item = stale.nth(index).locator('xpath=ancestor::li[contains(@class,"menu-item")]').first();
    await item.locator('.item-edit').click();
    await page.waitForTimeout(300);
    await item.locator('.item-delete, a.item-delete').click();
    await page.waitForTimeout(300);
  }
  result.actions.push(`removed ${staleCount} stale menu items`);

  for (const loc of ['#locations-gt-flex-desktop', '#locations-primary', 'input[name="menu-locations[desktop-main-menu]"]', 'input[name="menu-locations[mobile-menu]"]']) {
    const box = page.locator(loc);
    if (await box.count()) await box.check().catch(() => {});
  }
  const locationBoxes = page.locator('.menu-settings-input input[type="checkbox"]');
  const locCount = await locationBoxes.count();
  for (let index = 0; index < locCount; index += 1) {
    const box = locationBoxes.nth(index);
    const label = ((await box.locator('xpath=..').innerText().catch(() => '')) || '').toLowerCase();
    if (label.includes('desktop') || label.includes('mobile') || label.includes('primary') || label.includes('main menu')) {
      await box.check().catch(() => {});
    }
  }
  await page.locator('#save_menu_header, #save_menu_footer, input[name="save_menu"]').first().click();
  await page.waitForLoadState('domcontentloaded');
  result.menuItems = await page.locator('#menu-to-edit .menu-item-title').allInnerTexts().catch(() => []);
  result.actions.push('saved menu');
  await shot('menus-result.png');
} catch (error) {
  result.warnings.push(`Menu update failed: ${error.message}`);
  await shot('menus-error.png').catch(() => {});
}

try {
  await page.goto(`${wpUrl}/wp-admin/upload.php?mode=list`, { waitUntil: 'domcontentloaded' });
  result.trashedMedia = [];
  for (const filename of trashMediaNames) {
    const row = page.locator('#the-list tr').filter({ hasText: filename }).first();
    if (!(await row.count())) {
      result.warnings.push(`media not found to trash: ${filename}`);
      continue;
    }
    await row.hover();
    const trash = row.getByRole('link', { name: /Trash|Delete/i }).first();
    if (await trash.count()) {
      await trash.click();
      await page.waitForTimeout(800);
      result.trashedMedia.push(filename);
    }
  }
  await shot('media-after-trash.png');
} catch (error) {
  result.warnings.push(`Media trash failed: ${error.message}`);
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

result.finishedAt = new Date().toISOString();
await fs.writeFile(path.join(outputDir, 'chrome-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await context.close();
