import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const browserDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(browserDir, '..');
const pagesDir = path.join(rootDir, 'build', 'pages');
const outDir = path.join(rootDir, 'build', 'preview');
await fs.mkdir(outDir, { recursive: true });

const slugs = ['home', 'people', 'research', 'publications', 'theses', 'mark-riedl'];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
const page = await context.newPage();

for (const slug of slugs) {
  const html = await fs.readFile(path.join(pagesDir, `${slug}.html`), 'utf8');
  const wrapped = `<!doctype html><html><head><meta charset="utf-8"><title>${slug}</title>
<style>
body{font-family:Georgia,serif;max-width:900px;margin:2rem auto;padding:0 1.5rem;line-height:1.5;color:#222}
table{width:100%;border-collapse:collapse;margin:1rem 0}
th,td{border:1px solid #ccc;padding:.5rem .75rem;vertical-align:top}
h2{margin-top:1.75rem}
.publication-kind,.publication-source{display:inline-block;margin-right:.4rem;padding:.05rem .4rem;border:1px solid #333;font-size:.85rem}
details{margin-top:.4rem}
</style></head><body>${html}</body></html>`;
  const file = path.join(outDir, `${slug}.html`);
  await fs.writeFile(file, wrapped);
  await page.goto(`file://${file}`, { waitUntil: 'load' });
  await page.screenshot({ path: path.join(outDir, `${slug}.png`), fullPage: true });
}

await browser.close();
console.log(`Wrote previews to ${outDir}`);
