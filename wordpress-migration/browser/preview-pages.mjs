import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const browserDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(browserDir, '..');
const repoRoot = path.resolve(rootDir, '..');
const pagesDir = path.join(rootDir, 'build', 'pages');
const outDir = path.join(rootDir, 'build', 'preview');
await fs.mkdir(outDir, { recursive: true });

const localMedia = {
  'https://sites.gatech.edu/hcailab/files/2026/08/davinci-banner.jpeg': path.join(repoRoot, 'assets/images/davinci-banner.jpeg'),
  'https://sites.gatech.edu/hcailab/files/2026/08/mark-potato.jpg': path.join(repoRoot, 'assets/images/mark-potato.jpg'),
};

const slugs = ['home', 'people', 'research', 'publications', 'theses', 'mark-riedl'];
const flexCss = await fs.readFile(path.join(rootDir, 'assets', 'hcai-flex.css'), 'utf8');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
const page = await context.newPage();

for (const slug of slugs) {
  let html = await fs.readFile(path.join(pagesDir, `${slug}.html`), 'utf8');
  for (const [remote, localPath] of Object.entries(localMedia)) {
    html = html.split(remote).join(pathToFileURL(localPath).href);
  }
  const wrapped = `<!doctype html><html><head><meta charset="utf-8"><title>${slug}</title>
<style>
body{font-family:Georgia,serif;max-width:900px;margin:2rem auto;padding:0 1.5rem;line-height:1.5;color:#222}
${flexCss}
</style></head><body><div class="entry-content">${html}</div></body></html>`;
  const file = path.join(outDir, `${slug}.html`);
  await fs.writeFile(file, wrapped);
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await page.waitForFunction(
    () => [...document.images].every((img) => img.complete),
    { timeout: 10_000 },
  ).catch(() => {});
  await page.screenshot({ path: path.join(outDir, `${slug}.png`), fullPage: true });
}

await browser.close();
console.log(`Wrote previews to ${outDir}`);
