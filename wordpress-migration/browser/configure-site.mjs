import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { chromium } from 'playwright';
import { loadEnvFile } from './load-env.mjs';

const browserDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(browserDir, '..');
await loadEnvFile(path.join(rootDir, '.env'));

const wpUrl = (process.env.WP_URL || '').replace(/\/$/, '');
if (!wpUrl) {
  throw new Error('Set WP_URL in migration/.env; expected https://sites.gatech.edu/hcailab');
}

const apply = process.env.APPLY === '1';
const importWxr = process.env.IMPORT_WXR === '1';
const themeName = (process.env.GT_THEME_NAME || '').trim();
const siteTitle = process.env.SITE_TITLE || 'Human-Centered AI Lab';
const tagline = process.env.SITE_TAGLINE || 'Georgia Institute of Technology';

const outputDir = path.join(rootDir, 'build', 'admin-configuration');
const profileDir = path.join(browserDir, '.auth', 'gt-wordpress');
const wxrPath = path.resolve(browserDir, process.env.WXR_PATH || '../build/hcai-lab.wordpress.xml');
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(profileDir, { recursive: true });

const plan = {
  target: wpUrl,
  apply,
  themeName: themeName || null,
  siteTitle,
  tagline,
  importWxr,
  wxrPath,
  actions: [],
  warnings: [],
};

if (!apply) {
  plan.actions.push('Would authenticate via existing/local SSO browser profile.');
  if (themeName) plan.actions.push(`Would activate theme matching: ${themeName}`);
  plan.actions.push(`Would set site title to: ${siteTitle}`);
  plan.actions.push(`Would set tagline to: ${tagline}`);
  plan.actions.push('Would assign the page titled Home as the static front page.');
  if (importWxr) plan.actions.push(`Would attempt standard WordPress WXR import from: ${wxrPath}`);
  console.log(JSON.stringify(plan, null, 2));
  console.log('\nNo changes made. Set APPLY=1 to execute.');
  process.exit(0);
}

const headless = process.env.PLAYWRIGHT_HEADLESS === '1';
const context = await chromium.launchPersistentContext(profileDir, {
  headless,
  viewport: { width: 1440, height: 1000 },
});
const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(25_000);

async function waitForHumanLogin() {
  await page.goto(`${wpUrl}/wp-admin/`, { waitUntil: 'domcontentloaded' });
  if (!page.url().includes('/wp-admin/')) {
    console.log('\nComplete Georgia Tech SSO and Duo in the opened browser.');
    const rl = readline.createInterface({ input, output });
    await rl.question('When the WordPress dashboard is visible, press Enter here... ');
    rl.close();
    await page.goto(`${wpUrl}/wp-admin/`, { waitUntil: 'domcontentloaded' });
  }
  if (!(await page.locator('#wpadminbar').count())) {
    throw new Error(`WordPress admin session was not detected. Current URL: ${page.url()}`);
  }
}

async function saveScreenshot(name) {
  await page.screenshot({ path: path.join(outputDir, name), fullPage: true });
}

await waitForHumanLogin();

if (importWxr) {
  try {
    await fs.access(wxrPath);
    await page.goto(`${wpUrl}/wp-admin/import.php`, { waitUntil: 'domcontentloaded' });
    const wordpressRow = page.locator('tr').filter({ hasText: /WordPress/i }).first();
    const runImporter = wordpressRow.getByRole('link', { name: /Run Importer/i });
    if (!(await runImporter.count())) {
      throw new Error('A visible preapproved WordPress “Run Importer” link was not found. The script will not install a plugin automatically.');
    }
    await runImporter.click();
    await page.waitForLoadState('domcontentloaded');
    const upload = page.locator('input[type="file"]').first();
    if (!(await upload.count())) {
      throw new Error('WXR file input was not found on the importer page.');
    }
    await upload.setInputFiles(wxrPath);
    await page.getByRole('button', { name: /Upload file and import/i }).click();
    await page.waitForLoadState('domcontentloaded');
    const attachments = page.locator('input[name="fetch_attachments"]');
    if (await attachments.count()) {
      await attachments.uncheck();
    }
    const submit = page.getByRole('button', { name: /Submit/i }).or(page.locator('input[type="submit"]')).first();
    if (!(await submit.count())) {
      throw new Error('Importer confirmation submit button was not found.');
    }
    await submit.click();
    await page.waitForLoadState('domcontentloaded');
    plan.actions.push(`Imported WXR: ${wxrPath}`);
    await saveScreenshot('wxr-import-result.png');
  } catch (error) {
    plan.warnings.push(`WXR import was not completed: ${error.message}`);
  }
}

if (themeName) {
  try {
    await page.goto(`${wpUrl}/wp-admin/themes.php`, { waitUntil: 'domcontentloaded' });
    const card = page.locator('.theme').filter({ hasText: new RegExp(themeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
    if (!(await card.count())) {
      throw new Error(`No installed theme matched “${themeName}”. Run discover-admin.mjs and use the exact displayed name.`);
    }
    if (!(await card.evaluate(element => element.classList.contains('active')))) {
      const activate = card.locator('a.activate, .theme-actions a').filter({ hasText: /Activate/i }).first();
      if (!(await activate.count())) {
        throw new Error(`Theme matched, but an Activate action was not found for “${themeName}”.`);
      }
      await activate.click();
      await page.waitForLoadState('domcontentloaded');
      plan.actions.push(`Activated theme: ${themeName}`);
    } else {
      plan.actions.push(`Theme already active: ${themeName}`);
    }
    await saveScreenshot('theme-result.png');
  } catch (error) {
    plan.warnings.push(`Theme activation failed: ${error.message}`);
  }
} else {
  plan.warnings.push('GT_THEME_NAME was not set; theme activation was skipped. Use the exact official theme name from admin discovery.');
}

try {
  await page.goto(`${wpUrl}/wp-admin/options-general.php`, { waitUntil: 'domcontentloaded' });
  await page.locator('#blogname').fill(siteTitle);
  await page.locator('#blogdescription').fill(tagline);
  await page.locator('#submit').click();
  await page.waitForLoadState('domcontentloaded');
  plan.actions.push(`Set site title: ${siteTitle}`);
  plan.actions.push(`Set tagline: ${tagline}`);
  await saveScreenshot('general-settings-result.png');
} catch (error) {
  plan.warnings.push(`General settings update failed: ${error.message}`);
}

try {
  await page.goto(`${wpUrl}/wp-admin/options-reading.php`, { waitUntil: 'domcontentloaded' });
  const homeOption = page.locator('#page_on_front option').filter({ hasText: /^Home$/i }).first();
  if (!(await homeOption.count())) {
    throw new Error('A page titled exactly “Home” is not available. Import or sync the pages first.');
  }
  const homeValue = await homeOption.getAttribute('value');
  await page.locator('input[name="show_on_front"][value="page"]').check();
  await page.locator('#page_on_front').selectOption(homeValue);
  await page.locator('#submit').click();
  await page.waitForLoadState('domcontentloaded');
  plan.actions.push(`Assigned WordPress page ID ${homeValue} as the static front page.`);
  await saveScreenshot('reading-settings-result.png');
} catch (error) {
  plan.warnings.push(`Front-page assignment failed: ${error.message}`);
}

plan.actions.push('Primary navigation still requires theme-specific verification; use the generated page order and admin discovery output.');
await fs.writeFile(path.join(outputDir, 'configuration-result.json'), JSON.stringify(plan, null, 2));
console.log(JSON.stringify(plan, null, 2));
console.log(`\nSaved result to ${outputDir}`);
await context.close();
