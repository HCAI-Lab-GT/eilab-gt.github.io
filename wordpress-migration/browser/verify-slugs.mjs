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

const outputDir = path.join(rootDir, 'build', 'admin-discovery');
const profileDir = path.join(browserDir, '.auth', 'gt-wordpress');
await fs.mkdir(outputDir, { recursive: true });

const expected = [
  { title: 'Home', id: '9069', slug: 'home' },
  { title: 'People', id: '9070', slug: 'people' },
  { title: 'Research', id: '9071', slug: 'research' },
  { title: 'Publications', id: '9072', slug: 'publications' },
  { title: 'Theses', id: '9073', slug: 'theses' },
  { title: 'Mark Riedl', id: '9074', slug: 'mark-riedl' },
];
const expectedSlugs = new Set(expected.map((item) => item.slug));

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1440, height: 1000 },
});
const page = context.pages()[0] || (await context.newPage());
page.setDefaultTimeout(20_000);
page.on('dialog', (dialog) => dialog.accept().catch(() => {}));

const result = {
  startedAt: new Date().toISOString(),
  actions: [],
  warnings: [],
  drafts: [],
  trash: [],
  imported: false,
};

async function sleep(ms) {
  try {
    await page.waitForTimeout(ms);
  } catch (error) {
    if (/closed|Target page/i.test(String(error))) throw error;
  }
}

async function shot(name) {
  await page.screenshot({ path: path.join(outputDir, name), fullPage: true }).catch(() => {});
}

async function waitForAdmin() {
  console.log('SSO WINDOW OPEN — complete GT SSO/Duo in Google Chrome for Testing.');
  console.log('This script never imports and never publishes.');
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

async function showSlugColumn() {
  const toggle = page.locator('#show-settings-link');
  if (await toggle.count()) {
    await toggle.click().catch(() => {});
    await sleep(300);
  }
  const box = page.locator('#slug-hide');
  if (await box.count()) await box.check().catch(() => {});
  const apply = page.locator('#screen-options-apply, #adv-settings .button');
  if (await apply.count()) await apply.first().click().catch(() => {});
  await sleep(400);
}

function pickSlug(parts) {
  const candidates = [parts.gutenberg, parts.hidden, parts.full, parts.short, parts.quickEdit]
    .map((value) => String(value || '').trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);
  for (const value of candidates) {
    const last = value.split('/').filter(Boolean).pop();
    if (last && last !== 'hcailab') return last;
  }
  const permalink = String(parts.permalink || parts.sample || parts.urlToggle || '');
  const match = permalink.match(/\/hcailab\/([^/\s]+)\/?/);
  if (match) return match[1];
  return '';
}

async function readEditorSlug(id) {
  await page.goto(`${wpUrl}/wp-admin/post.php?post=${id}&action=edit`, { waitUntil: 'domcontentloaded' });
  await sleep(1200);
  const gutenbergReady = await page.locator('.block-editor, .edit-post-layout, #editor').count();
  if (gutenbergReady) {
    await page.waitForFunction(() => Boolean(window.wp?.data?.select), { timeout: 15_000 }).catch(() => {});
    await sleep(400);
  }
  const parts = await page.evaluate(() => {
    const hidden = document.querySelector('#post_name')?.value || '';
    const full =
      document.querySelector('#editable-post-name-full')?.value ||
      document.querySelector('#editable-post-name-full')?.textContent ||
      '';
    const short = document.querySelector('#editable-post-name')?.textContent || '';
    const sample = document.querySelector('#sample-permalink')?.innerText || '';
    const urlToggle =
      document.querySelector('.edit-post-post-url__toggle, .editor-post-url__link, .editor-post-panel__row a')
        ?.textContent || '';
    let gutenberg = '';
    try {
      gutenberg = window.wp?.data?.select('core/editor')?.getCurrentPost?.()?.slug || '';
    } catch {
      gutenberg = '';
    }
    const status = window.wp?.data?.select('core/editor')?.getCurrentPost?.()?.status || '';
    return { hidden, full, short, sample, urlToggle, gutenberg, status, title: document.title };
  });
  const slug = pickSlug(parts);
  return { id, ...parts, slug };
}

async function scrapeList(status) {
  const url =
    status === 'trash'
      ? `${wpUrl}/wp-admin/edit.php?post_type=page&post_status=trash`
      : `${wpUrl}/wp-admin/edit.php?post_type=page&post_status=all`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await showSlugColumn();
  const rows = await page.locator('#the-list tr').evaluateAll((nodes) =>
    nodes
      .map((row) => {
        const titleLink = row.querySelector('.row-title');
        const slugCell = row.querySelector('.column-slug, td.slug');
        return {
          id: (row.id || '').replace(/^post-/, ''),
          title: titleLink?.textContent?.trim() || null,
          status: row.querySelector('.post-state')?.textContent?.trim() || status,
          slug: slugCell?.textContent?.trim() || null,
          href: titleLink?.getAttribute('href') || null,
          classes: row.className,
        };
      })
      .filter((row) => row.title),
  );
  return rows;
}

async function emptyTrashIfHcai() {
  await page.goto(`${wpUrl}/wp-admin/edit.php?post_type=page&post_status=trash`, { waitUntil: 'domcontentloaded' });
  await showSlugColumn();
  result.trash = await scrapeList('trash');
  await shot('pages-trash-before-slug-fix.png');
  const counts = (await page.locator('.subsubsub').innerText().catch(() => '')) || '';
  result.trashCounts = counts;
  const nonHcai = result.trash.filter((row) => {
    const hay = `${row.title} ${row.slug}`.toLowerCase();
    return !/home|people|research|publications|theses|mark|riedl|hcai/i.test(hay);
  });
  if (nonHcai.length) {
    result.warnings.push(`trash has non-HCAI rows; deleting colliding rows only: ${JSON.stringify(nonHcai)}`);
    for (const row of result.trash) {
      const hay = `${row.title} ${row.slug}`.toLowerCase();
      const collides = [...expectedSlugs].some((slug) => hay.includes(slug) || hay.includes(slug.replace('-', ' ')));
      if (!collides) continue;
      const del = page.locator(`#post-${row.id} a.submitdelete, #post-${row.id} .delete a`).first();
      if (await del.count()) {
        await del.click({ force: true });
        await sleep(400);
        result.actions.push(`permanently deleted trash ${row.id} ${row.title} ${row.slug}`);
      }
    }
    return;
  }
  const emptyBtn = page.locator('#delete_all, input[name="delete_all"]').first();
  if (await emptyBtn.count()) {
    await emptyBtn.click({ force: true });
    await page.waitForLoadState('domcontentloaded');
    result.actions.push('emptied page trash (HCAI leftovers only)');
  } else {
    const checkboxes = page.locator('#the-list th.check-column input[type="checkbox"]');
    const n = await checkboxes.count();
    for (let i = 0; i < n; i += 1) await checkboxes.nth(i).check({ force: true }).catch(() => {});
    const bulk = page.locator('#bulk-action-selector-top');
    if (await bulk.count()) {
      const options = await bulk.locator('option').evaluateAll((opts) =>
        opts.map((opt) => ({ value: opt.value, text: opt.textContent.trim() })),
      );
      const del = options.find((opt) => /delete/i.test(opt.value) || /delete/i.test(opt.text));
      if (del) {
        await bulk.selectOption(del.value);
        await page.locator('#doaction').click();
        await page.waitForLoadState('domcontentloaded');
        result.actions.push(`bulk-deleted ${n} trash pages`);
      }
    }
  }
  await shot('pages-trash-after-empty.png');
}

async function quickEditSlug(id, slug) {
  await page.goto(`${wpUrl}/wp-admin/edit.php?post_type=page&post_status=all`, { waitUntil: 'domcontentloaded' });
  const row = page.locator(`#post-${id}`);
  await row.hover();
  const quick = row.locator('.editinline, button.editinline, a.editinline').first();
  await quick.click({ force: true });
  await sleep(400);
  const slugInput = page.locator(`#edit-${id} input[name="post_name"], tr.inline-edit-row input[name="post_name"]`).first();
  await slugInput.fill(slug);
  const status = page.locator(`#edit-${id} select[name="_status"], tr.inline-edit-row select[name="_status"]`).first();
  if (await status.count()) await status.selectOption('draft').catch(() => {});
  await page.locator(`#edit-${id} .save, tr.inline-edit-row .save`).first().click();
  await sleep(1200);
  result.actions.push(`quick-edited ${id} slug to ${slug}`);
}

async function editorSetSlug(id, slug) {
  await page.goto(`${wpUrl}/wp-admin/post.php?post=${id}&action=edit`, { waitUntil: 'domcontentloaded' });
  await sleep(1200);
  const usedGutenberg = await page.evaluate(async (nextSlug) => {
    if (!window.wp?.data?.dispatch) return false;
    const current = window.wp.data.select('core/editor').getCurrentPost();
    if (current?.status && current.status !== 'draft') return 'abort-status';
    window.wp.data.dispatch('core/editor').editPost({ slug: nextSlug });
    await window.wp.data.dispatch('core/editor').savePost();
    return true;
  }, slug);
  if (usedGutenberg === 'abort-status') {
    result.warnings.push(`refusing to save ${id}: editor status is not draft`);
    return;
  }
  if (usedGutenberg) {
    await sleep(1500);
    result.actions.push(`gutenberg-saved ${id} slug to ${slug}`);
    return;
  }
  const nameFull = page.locator('#editable-post-name, #editable-post-name-full').first();
  if (await nameFull.count()) {
    await nameFull.click().catch(() => {});
    const input = page.locator('#new-post-slug, #editable-post-name');
    if (await input.count()) await input.fill(slug);
    const ok = page.locator('#edit-slug-buttons .save, #edit-slug-box .save');
    if (await ok.count()) await ok.click();
  }
  const hidden = page.locator('#post_name');
  if (await hidden.count()) await hidden.fill(slug);
  const save = page.locator('#save-post');
  if (await save.count()) await save.click();
  await page.waitForLoadState('domcontentloaded');
  result.actions.push(`classic-saved ${id} slug to ${slug}`);
}

try {
  await waitForAdmin();

  result.listBefore = await scrapeList('all');
  await shot('pages-with-slug-column.png');

  for (const item of expected) {
    const observed = await readEditorSlug(item.id);
    const record = { ...item, observed, slugOk: observed.slug === item.slug };
    result.drafts.push(record);
    await shot(`slug-editor-${item.slug}.png`);
    result.actions.push(`observed ${item.id} ${item.title} slug=${observed.slug || '(empty)'} status=${observed.status || ''}`);
  }

  result.trash = await scrapeList('trash');
  await shot('pages-trash-slugs.png');

  const bad = result.drafts.filter((item) => item.observed.slug !== item.slug);
  if (bad.length) {
    result.warnings.push(`non-canonical slugs: ${bad.map((item) => `${item.id}=${item.observed.slug}`).join(', ')}`);
    await emptyTrashIfHcai();
    for (const item of bad) {
      try {
        await quickEditSlug(item.id, item.slug);
      } catch (error) {
        result.warnings.push(`quick edit failed for ${item.id}: ${error.message}`);
        await editorSetSlug(item.id, item.slug);
      }
    }
    result.draftsAfter = [];
    for (const item of expected) {
      const observed = await readEditorSlug(item.id);
      result.draftsAfter.push({ ...item, observed, slugOk: observed.slug === item.slug });
      await shot(`slug-editor-after-${item.slug}.png`);
    }
  } else {
    result.draftsAfter = result.drafts;
  }

  result.listAfter = await scrapeList('all');
  await shot('pages-after-slug-verify.png');
  result.pageCounts = (await page.locator('.subsubsub').innerText().catch(() => '')) || '';
  result.canonical = (result.draftsAfter || result.drafts).every((item) => item.slugOk);
  result.stillDraft = (result.listAfter || []).filter((row) => expected.some((item) => item.id === row.id)).every((row) =>
    /draft/i.test(row.status),
  );
} catch (error) {
  result.warnings.push(`fatal: ${error.message}`);
  await shot('slug-verify-fatal.png');
} finally {
  result.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(outputDir, 'slug-verify.json'), JSON.stringify(result, null, 2));
  const phaseC = {
    verifiedAt: result.finishedAt,
    target: wpUrl,
    drafts: (result.draftsAfter || result.drafts).map((item) => ({
      id: item.id,
      title: item.title,
      expectedSlug: item.slug,
      actualSlug: item.observed?.slug || null,
      permalinkParts: item.observed,
      slugOk: item.slugOk,
      status: item.observed?.status || null,
    })),
    canonical: result.canonical || false,
    stillDraft: result.stillDraft || false,
    trashCount: (result.trash || []).length,
    actions: result.actions,
    warnings: result.warnings,
    imported: false,
  };
  await fs.writeFile(path.join(outputDir, 'import-verify-slugs.json'), JSON.stringify(phaseC, null, 2));
  console.log(JSON.stringify({ ...phaseC, actions: result.actions, warnings: result.warnings }, null, 2));
  await context.close().catch(() => {});
}
