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
const wxrPath = path.resolve(rootDir, 'build/hcai-lab.wordpress.xml');
const lockPath = path.join(outputDir, 'wxr-import-done.json');
await fs.mkdir(outputDir, { recursive: true });

try {
  const existing = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  if (existing?.imported) {
    console.log(JSON.stringify({ skipped: true, reason: 'import already recorded', lock: existing }, null, 2));
    process.exit(0);
  }
} catch (error) {
  if (error && error.code !== 'ENOENT') throw error;
}

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1440, height: 1000 },
});
const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(45_000);

await page.goto(`${wpUrl}/wp-admin/`, { waitUntil: 'domcontentloaded' });
const ssoDeadline = Date.now() + 2 * 60 * 60 * 1000;
console.log('Complete GT SSO/Duo if prompted. Waiting up to 2 hours for #wpadminbar...');
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

const result = {
  wxrPath,
  startedAt: new Date().toISOString(),
  steps: [],
  imported: false,
};

async function shot(name) {
  await page.screenshot({ path: path.join(outputDir, name), fullPage: true });
}

try {
  await page.goto(`${wpUrl}/wp-admin/import.php`, { waitUntil: 'domcontentloaded' });
  await shot('import-importers.png');
  const wordpressHref = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr')];
    for (const row of rows) {
      const title = (row.querySelector('.importer-title')?.textContent || '').replace(/\s+/g, ' ').trim();
      const firstCell = (row.querySelector('td')?.innerText || '').split('\n')[0].trim();
      if (title === 'WordPress' || firstCell === 'WordPress') {
        return row.querySelector('a[href*="import"]')?.getAttribute('href') || null;
      }
    }
    return null;
  });
  if (wordpressHref) {
    await page.goto(new URL(wordpressHref, page.url()).href, { waitUntil: 'domcontentloaded' });
    result.steps.push(`opened importer ${wordpressHref}`);
  } else {
    await page.goto(`${wpUrl}/wp-admin/admin.php?import=wordpress`, { waitUntil: 'domcontentloaded' });
    result.steps.push('opened admin.php?import=wordpress');
  }
  await shot('import-upload.png');
  const upload = page.locator('input[type="file"]').first();
  if (!(await upload.count())) {
    throw new Error('WXR file input was not found.');
  }
  await upload.setInputFiles(wxrPath);
  result.steps.push(`selected ${wxrPath}`);
  await page.getByRole('button', { name: /Upload file and import/i }).click();
  await page.waitForLoadState('domcontentloaded');
  await shot('import-authors.png');

  const attachments = page.locator('input[name="fetch_attachments"]');
  if (await attachments.count()) {
    await attachments.uncheck();
    result.steps.push('unchecked fetch_attachments');
  }

  const authorSelects = page.locator('select[name^="user_map"], select[name^="user_select"]');
  const selectCount = await authorSelects.count();
  for (let index = 0; index < selectCount; index += 1) {
    const select = authorSelects.nth(index);
    const gmatlin = select.locator('option').filter({ hasText: /gmatlin3/i });
    if (await gmatlin.count()) {
      const value = await gmatlin.first().getAttribute('value');
      if (value) await select.selectOption(value);
      result.steps.push('assigned author gmatlin3');
    }
  }

  const submit = page.getByRole('button', { name: /Submit/i }).or(page.locator('input[type="submit"][value*="Submit"]')).first();
  if (!(await submit.count())) {
    throw new Error('Importer submit button was not found.');
  }
  await submit.click();
  result.steps.push('clicked submit');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3_000);
  await shot('wxr-import-result.png');
  result.imported = true;
  result.finalUrl = page.url();
  result.bodyText = ((await page.locator('#wpbody-content').innerText().catch(() => '')) || '').slice(0, 4000);
} catch (error) {
  result.error = String(error && error.message ? error.message : error);
  await shot('wxr-import-error.png').catch(() => {});
} finally {
  result.finishedAt = new Date().toISOString();
  await fs.writeFile(lockPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await context.close();
}

if (!result.imported) {
  process.exit(2);
}
