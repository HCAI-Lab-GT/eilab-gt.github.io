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

const outputDir = path.join(rootDir, 'build', 'admin-discovery');
const profileDir = path.join(browserDir, '.auth', 'gt-wordpress');
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(profileDir, { recursive: true });

const headless = process.env.PLAYWRIGHT_HEADLESS === '1';
const context = await chromium.launchPersistentContext(profileDir, {
  headless,
  viewport: { width: 1440, height: 1000 },
});
const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(20_000);

async function waitForHumanLogin() {
  await page.goto(`${wpUrl}/wp-admin/`, { waitUntil: 'domcontentloaded' });
  if (!page.url().includes('/wp-admin/')) {
    console.log('\nComplete Georgia Tech SSO and Duo in the opened browser.');
    const rl = readline.createInterface({ input, output });
    await rl.question('When the WordPress dashboard is visible, press Enter here... ');
    rl.close();
    await page.goto(`${wpUrl}/wp-admin/`, { waitUntil: 'domcontentloaded' });
  }
  const adminBar = page.locator('#wpadminbar');
  if (!(await adminBar.count())) {
    throw new Error(`WordPress admin session was not detected. Current URL: ${page.url()}`);
  }
}

async function gotoAdmin(pathname, screenshotName) {
  await page.goto(`${wpUrl}${pathname}`, { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: path.join(outputDir, screenshotName), fullPage: true });
}

await waitForHumanLogin();

const result = {
  target: wpUrl,
  discoveredAt: new Date().toISOString(),
  themes: [],
  plugins: [],
  importers: [],
  settings: {},
  profile: {},
  notes: [],
};

try {
  await gotoAdmin('/wp-admin/themes.php', 'themes.png');
  result.themes = await page.locator('.theme').evaluateAll(cards => cards.map(card => ({
    id: card.getAttribute('data-slug') || card.id || null,
    name: card.querySelector('.theme-name')?.textContent?.trim() || card.textContent?.trim().split('\n')[0] || null,
    active: card.classList.contains('active'),
    actions: Array.from(card.querySelectorAll('a,button')).map(element => element.textContent?.trim()).filter(Boolean),
  })));
} catch (error) {
  result.notes.push(`Theme discovery failed: ${error.message}`);
}

try {
  await gotoAdmin('/wp-admin/plugins.php', 'plugins.png');
  result.plugins = await page.locator('tr[data-plugin]').evaluateAll(rows => rows.map(row => ({
    file: row.getAttribute('data-plugin'),
    name: row.querySelector('.plugin-title strong')?.textContent?.trim() || null,
    active: row.classList.contains('active'),
    actions: Array.from(row.querySelectorAll('.row-actions a')).map(element => element.textContent?.trim()).filter(Boolean),
  })));
} catch (error) {
  result.notes.push(`Plugin discovery failed: ${error.message}`);
}

try {
  await gotoAdmin('/wp-admin/import.php', 'importers.png');
  result.importers = await page.locator('.widefat tr, table tr').evaluateAll(rows => rows.map(row => ({
    text: row.textContent?.replace(/\s+/g, ' ').trim() || '',
    links: Array.from(row.querySelectorAll('a')).map(link => ({
      text: link.textContent?.trim() || '',
      href: link.getAttribute('href') || '',
    })),
  })).filter(row => row.text));
} catch (error) {
  result.notes.push(`Importer discovery failed: ${error.message}`);
}

try {
  await gotoAdmin('/wp-admin/options-general.php', 'general-settings.png');
  result.settings.general = {
    siteTitle: await page.locator('#blogname').inputValue().catch(() => null),
    tagline: await page.locator('#blogdescription').inputValue().catch(() => null),
    adminEmail: await page.locator('#new_admin_email').inputValue().catch(() => null),
  };
} catch (error) {
  result.notes.push(`General settings discovery failed: ${error.message}`);
}

try {
  await gotoAdmin('/wp-admin/options-reading.php', 'reading-settings.png');
  result.settings.reading = {
    showOnFront: await page.locator('input[name="show_on_front"]:checked').getAttribute('value').catch(() => null),
    frontPageValue: await page.locator('#page_on_front').inputValue().catch(() => null),
    frontPageText: await page.locator('#page_on_front option:checked').textContent().catch(() => null),
    postsPageValue: await page.locator('#page_for_posts').inputValue().catch(() => null),
    postsPageText: await page.locator('#page_for_posts option:checked').textContent().catch(() => null),
  };
} catch (error) {
  result.notes.push(`Reading settings discovery failed: ${error.message}`);
}

try {
  await gotoAdmin('/wp-admin/profile.php', 'profile.png');
  const bodyText = await page.locator('body').innerText();
  result.profile = {
    applicationPasswordsVisible: /Application Passwords/i.test(bodyText),
    applicationPasswordsFields: await page.locator('#application-passwords-section, .application-passwords, [data-app-passwords]').count(),
  };
} catch (error) {
  result.notes.push(`Profile discovery failed: ${error.message}`);
}

await fs.writeFile(path.join(outputDir, 'admin-discovery.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
console.log(`\nSaved discovery output to ${outputDir}`);
await context.close();
