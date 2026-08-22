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
const afterDir = path.join(rootDir, 'build', 'polish-after');
const inventoryDir = path.join(rootDir, 'build', 'polish-inventory');
const pagesDir = path.join(rootDir, 'build', 'pages');
await fs.mkdir(afterDir, { recursive: true });
await fs.mkdir(inventoryDir, { recursive: true });

const css = await fs.readFile(path.join(rootDir, 'assets', 'hcai-flex.css'), 'utf8');
const footerHtml = (await fs.readFile(path.join(rootDir, 'assets', 'hcai-footer.html'), 'utf8')).trim();
const importLock = JSON.parse(
  await fs.readFile(path.join(rootDir, 'build', 'admin-discovery', 'wxr-import-done.json'), 'utf8'),
);
if (importLock.imported !== true) throw new Error('WXR lock is not imported:true');

const drafts = [
  { title: 'Home', id: '9069', slug: 'home' },
  { title: 'People', id: '9070', slug: 'people' },
  { title: 'Research', id: '9071', slug: 'research' },
  { title: 'Publications', id: '9072', slug: 'publications' },
  { title: 'Theses', id: '9073', slug: 'theses' },
  { title: 'Mark Riedl', id: '9074', slug: 'mark-riedl' },
];
const viewports = [
  { name: '1440', width: 1440, height: 1000 },
  { name: '390', width: 390, height: 844 },
];

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
  imported: true,
};

async function sleep(ms) {
  await page.waitForTimeout(ms);
}

async function shot(name) {
  await page.screenshot({ path: path.join(inventoryDir, name), fullPage: true }).catch(() => {});
}

async function waitForAdmin() {
  console.log('SSO WINDOW OPEN — complete GT SSO/Duo if prompted. Never imports, never publishes pages.');
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

async function appearanceHref(pattern) {
  await page.goto(`${wpUrl}/wp-admin/`, { waitUntil: 'domcontentloaded' });
  return page.evaluate((reSource) => {
    const re = new RegExp(reSource, 'i');
    const links = [...document.querySelectorAll('#adminmenu a, #menu-appearance a')];
    const hit = links.find((a) => re.test(a.textContent || '') && !/customize\.php/i.test(a.href));
    return hit ? hit.href : null;
  }, pattern);
}

async function saveCustomCss() {
  const href = (await appearanceHref('^\\s*Custom CSS\\s*$')) || `${wpUrl}/wp-admin/themes.php?page=custom-css`;
  await page.goto(href, { waitUntil: 'domcontentloaded' });
  await page.locator('.CodeMirror').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  await page.locator('textarea.sccss-content').waitFor({ state: 'attached', timeout: 8_000 });
  await sleep(700);
  const set = await page.evaluate((nextCss) => {
    const ta = document.querySelector('textarea.sccss-content, textarea[name="sccss_settings[sccss-content]"]');
    const cm = document.querySelector('.CodeMirror');
    if (cm && cm.CodeMirror) cm.CodeMirror.setValue(nextCss);
    if (ta) {
      ta.value = nextCss;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return {
      hasCm: Boolean(cm && cm.CodeMirror),
      taLen: ta ? ta.value.length : 0,
      cmLen: cm && cm.CodeMirror ? cm.CodeMirror.getValue().length : 0,
    };
  }, css);
  result.actions.push(`css editor set ${JSON.stringify(set)}`);
  await shot('custom-css-before-save.png');
  const save = page.getByRole('button', { name: /save css/i }).or(page.locator('input[value="Save CSS"], #submit'));
  await save.first().click({ force: true });
  await page.waitForLoadState('domcontentloaded');
  await sleep(800);
  await page.goto(href, { waitUntil: 'domcontentloaded' });
  await page.locator('.CodeMirror').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  await page.locator('textarea.sccss-content').waitFor({ state: 'attached', timeout: 8_000 });
  await sleep(500);
  const verified = await page.evaluate(() => {
    const ta = document.querySelector('textarea.sccss-content, textarea[name="sccss_settings[sccss-content]"]');
    const cm = document.querySelector('.CodeMirror');
    const text = (cm && cm.CodeMirror ? cm.CodeMirror.getValue() : ta?.value) || '';
    return { hasHero: text.includes('.hcai-hero'), hasPub: text.includes('.hcai-publication'), length: text.length };
  });
  result.cssControl = href;
  result.cssVerified = verified;
  result.actions.push(`css verified ${JSON.stringify(verified)}`);
  await shot('custom-css-saved.png');
  if (!verified.hasHero) result.warnings.push('CSS save did not persist .hcai-hero');
}

async function saveFooter() {
  const href = (await appearanceHref('Footer Content')) || `${wpUrl}/wp-admin/themes.php?page=footer-content`;
  await page.goto(href, { waitUntil: 'domcontentloaded' });
  await sleep(700);
  await shot('footer-content-before.png');
  const set = await page.evaluate((html) => {
    const ta = document.querySelector('#footer-content textarea, textarea[name="footer_content"], textarea[name*="footer"], textarea');
    if (window.tinyMCE?.editors && Object.keys(window.tinyMCE.editors).length) {
      const id = Object.keys(window.tinyMCE.editors)[0];
      window.tinyMCE.editors[id].setContent(html);
      return { via: `tinymce:${id}` };
    }
    if (ta) {
      ta.value = html;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      return { via: ta.name || ta.id || 'textarea', len: ta.value.length };
    }
    return { via: null };
  }, footerHtml);
  result.actions.push(`footer editor set ${JSON.stringify(set)}`);
  const save = page.getByRole('button', { name: /save changes/i }).or(page.locator('input[value="Save Changes"], #submit'));
  await save.first().click({ force: true });
  await page.waitForLoadState('domcontentloaded');
  await sleep(800);
  await page.goto(href, { waitUntil: 'domcontentloaded' });
  await sleep(600);
  const verified = await page.evaluate(() => {
    const ta = document.querySelector('#footer-content textarea, textarea[name="footer_content"], textarea[name*="footer"], textarea');
    const text =
      (window.tinyMCE?.editors && Object.keys(window.tinyMCE.editors).length
        ? window.tinyMCE.editors[Object.keys(window.tinyMCE.editors)[0]].getContent()
        : ta?.value) || '';
    return {
      mastodon: text.includes('sigmoid.social/@Riedl'),
      twitter: text.includes('twitter.com/mark_riedl'),
      linkedin: text.includes('linkedin.com/in/markriedl'),
      bluesky: text.includes('bsky.app/profile/markriedl.bsky.social'),
      length: text.length,
    };
  });
  result.footerControl = href;
  result.footerVerified = verified;
  result.actions.push(`footer verified ${JSON.stringify(verified)}`);
  await shot('footer-content-saved.png');
  if (!verified.mastodon || !verified.bluesky) result.warnings.push('footer save missing social URLs');
}

async function replaceDraft(draft) {
  const html = await fs.readFile(path.join(pagesDir, `${draft.slug}.html`), 'utf8');
  const needle = html.includes('Databricks')
    ? 'Databricks'
    : html.includes('Wayfarer Labs, Amphia')
      ? 'Wayfarer Labs, Amphia'
      : html.slice(120, 180).replace(/\s+/g, ' ').trim();
  await page.goto(`${wpUrl}/wp-admin/post.php?post=${draft.id}&action=edit`, { waitUntil: 'domcontentloaded' });
  await sleep(1400);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForFunction(() => Boolean(window.wp?.data?.select && window.wp?.blocks?.parse), { timeout: 25_000 });
  const saved = await page.evaluate(async ({ nextHtml, postId, needle: check }) => {
    const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const select = wp.data.select('core/editor');
    const dispatch = wp.data.dispatch('core/editor');
    const post = select.getCurrentPost();
    if (post.status !== 'draft' && post.status !== 'publish') {
      return { ok: false, reason: `status=${post.status}` };
    }
    const blocks = wp.blocks.parse(nextHtml);
    dispatch.resetBlocks(blocks);
    dispatch.editPost({ content: nextHtml, status: post.status, slug: post.slug });
    await sleepMs(500);
    const dirtyBefore = select.isEditedPostDirty();
    await dispatch.savePost();
    const deadline = Date.now() + 90_000;
    let sawSaving = false;
    while (Date.now() < deadline) {
      if (select.isSavingPost() || select.isAutosavingPost()) sawSaving = true;
      if (sawSaving && !select.isSavingPost() && !select.isAutosavingPost()) break;
      await sleepMs(250);
    }
    while (Date.now() < deadline && select.isEditedPostDirty()) await sleepMs(250);

    async function restWrite() {
      const nonce = window.wpApiSettings?.nonce;
      const res = await fetch(`/hcailab/wp-json/wp/v2/pages/${postId}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(nonce ? { 'X-WP-Nonce': nonce } : {}),
        },
        body: JSON.stringify({ content: nextHtml, status: post.status, slug: post.slug }),
      });
      const text = await res.text();
      let body = {};
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text.slice(0, 240) };
      }
      const rendered = String(body.content?.raw || body.content?.rendered || '');
      return {
        http: res.status,
        ok: res.ok,
        wpStatus: body.status,
        slug: body.slug,
        hasNeedle: rendered.includes(check),
        error: body.code || body.message || null,
      };
    }

    let rest = await restWrite();
    function walk(list) {
      return list.flatMap((block) => [
        { name: block.name, isValid: block.isValid !== false },
        ...walk(block.innerBlocks || []),
      ]);
    }
    const walked = walk(wp.data.select('core/block-editor').getBlocks());
    const after = select.getCurrentPost();
    const editorHasNeedle = String(select.getEditedPostContent() || '').includes(check);
    return {
      ok: (after.status === post.status && after.slug === post.slug && (rest.ok || editorHasNeedle)),
      status: after.status,
      slug: after.slug,
      invalid: walked.filter((block) => !block.isValid).map((block) => block.name),
      blockCount: walked.length,
      dirtyBefore,
      dirtyAfter: select.isEditedPostDirty(),
      sawSaving,
      saveSucceeded: select.didPostSaveRequestSucceed(),
      editorHasNeedle,
      rest,
    };
  }, { nextHtml: html, postId: draft.id, needle });
  await sleep(400);
  const recoveryButtons = await page.locator('button:has-text("Attempt recovery")').count();
  result.actions.push(`saved ${draft.slug} ${JSON.stringify(saved)} recoveryButtons=${recoveryButtons}`);
  if (!saved.ok) result.warnings.push(`save issue ${draft.slug}: ${JSON.stringify(saved)}`);
  if (saved.invalid?.length || recoveryButtons) {
    result.warnings.push(`${draft.slug} still invalid=${JSON.stringify(saved.invalid)} recovery=${recoveryButtons}`);
  }
  const publicUrl = draft.slug === 'home' ? `${wpUrl}/` : `${wpUrl}/${draft.slug}/`;
  await page.goto(`${publicUrl}?v=${Date.now()}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const publicHasNeedle = await page.evaluate((check) => (document.body.innerText || '').includes(check), needle).catch(() => false);
  result.actions.push(`public ${draft.slug} hasNeedle=${publicHasNeedle} needle=${needle}`);
  if (!publicHasNeedle) result.warnings.push(`public ${draft.slug} missing ${needle}`);
  await page.screenshot({ path: path.join(inventoryDir, `editor-after-${draft.slug}.png`), fullPage: true }).catch(() => {});
  return { ...saved, recoveryButtons, publicHasNeedle, needle };
}

async function clearExcerpts() {
  for (const draft of drafts) {
    await page.goto(`${wpUrl}/wp-admin/post.php?post=${draft.id}&action=edit`, { waitUntil: 'domcontentloaded' });
    await sleep(1200);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForFunction(() => Boolean(window.wp?.data?.dispatch), { timeout: 20_000 }).catch(() => {});
    const saved = await page.evaluate(async () => {
      const select = wp.data.select('core/editor');
      const dispatch = wp.data.dispatch('core/editor');
      const post = select.getCurrentPost();
      if (post.status !== 'draft') return { ok: false, reason: `status=${post.status}` };
      dispatch.editPost({ excerpt: '', status: 'draft', slug: post.slug });
      await dispatch.savePost();
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (!select.isSavingPost() && !select.isAutosavingPost()) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const after = select.getCurrentPost();
      return { ok: after.status === 'draft', excerpt: after.excerpt || '', slug: after.slug };
    });
    result.actions.push(`cleared excerpt ${draft.slug} ${JSON.stringify(saved)}`);
    if (saved.excerpt) result.warnings.push(`excerpt still set on ${draft.slug}`);
  }
}

async function screenshotAfter() {
  for (const draft of shotDrafts) {
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      let loaded = false;
      for (let attempt = 0; attempt < 4 && !loaded; attempt += 1) {
        try {
          const publicUrl = draft.slug === 'home' ? `${wpUrl}/` : `${wpUrl}/${draft.slug}/`;
          await page.goto(publicUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
          loaded = !/ERR_|interrupted|offline/i.test(await page.title());
        } catch (error) {
          result.warnings.push(`preview retry ${draft.slug} ${viewport.name}: ${error.message}`);
          await sleep(4000);
        }
      }
      await sleep(1000);
      await page.evaluate(() => {
        document.querySelectorAll('#edac-highlight-panel, .edac-highlight-panel').forEach((el) => el.remove());
      }).catch(() => {});
      const ignore = page.locator('button:has-text("Ignore")').first();
      if (await ignore.count()) await ignore.click({ timeout: 400 }).catch(() => {});
      await page.waitForFunction(() => [...document.images].every((img) => img.complete), { timeout: 12_000 }).catch(() => {});
      const proof = await page.evaluate(() => {
        const hero = document.querySelector('.hcai-hero img, .hcai-hero, .wp-block-image img');
        const th = document.querySelector('.entry-content th, table th');
        const text = document.body.innerText || '';
        const heroStyle = hero ? getComputedStyle(hero) : null;
        const thStyle = th ? getComputedStyle(th) : null;
        const portrait = document.querySelector('.hcai-director-photo img, .hcai-profile-photo img');
        const migrated = [...document.querySelectorAll('p, div, span')].find((el) =>
          /^\s*Migrated page:/i.test(el.textContent || ''),
        );
        return {
          url: location.href,
          title: document.title,
          hasHeroClass: Boolean(document.querySelector('.hcai-hero')),
          heroMaxWidth: heroStyle?.maxWidth || '',
          heroWidth: hero ? Math.round(hero.getBoundingClientRect().width) : 0,
          portraitWidth: portrait ? Math.round(portrait.getBoundingClientRect().width) : 0,
          thBg: thStyle?.backgroundColor || '',
          migrated: Boolean(migrated),
          migratedClass: migrated ? `${migrated.tagName}.${migrated.className}` : '',
          mastodon: /Mastodon/.test(text),
          bluesky: /BlueSky|Bluesky/.test(text),
        };
      });
      result.actions.push(`after ${draft.slug} ${viewport.name} ${JSON.stringify(proof)}`);
      await page.screenshot({
        path: path.join(afterDir, `${draft.slug}-${viewport.name}.png`),
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

const skipBodies = process.env.SKIP_BODIES === '1';
const skipExcerpts = process.env.SKIP_EXCERPTS === '1';
const onlySlugs = (process.env.ONLY_SLUGS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const shotDrafts = onlySlugs.length ? drafts.filter((item) => onlySlugs.includes(item.slug)) : drafts;
const bodyDrafts = shotDrafts;

try {
  await waitForAdmin();
  await saveCustomCss();
  await saveFooter();
  result.drafts = [];
  if (!skipBodies) {
    for (const draft of bodyDrafts) result.drafts.push({ ...draft, ...(await replaceDraft(draft)) });
  } else {
    result.actions.push('skipped draft body replace (SKIP_BODIES=1)');
    if (!skipExcerpts) await clearExcerpts();
    else result.actions.push('skipped excerpt clear (SKIP_EXCERPTS=1)');
  }
  await screenshotAfter();
  await page.goto(`${wpUrl}/wp-admin/themes.php`, { waitUntil: 'domcontentloaded' });
  result.theme = await page.locator('.theme.active .theme-name, .theme.active h2').first().innerText().catch(() => null);
  await page.goto(`${wpUrl}/wp-admin/edit.php?post_type=page&post_status=all`, { waitUntil: 'domcontentloaded' });
  result.pageCounts = (await page.locator('.subsubsub').innerText().catch(() => '')) || '';
  result.stillDraft = (result.drafts || []).every((item) => item.status === 'draft');
  result.slugsOk = (result.drafts || []).every((item) => item.slug === drafts.find((d) => d.id === item.id)?.slug);
  result.recoveryCountAfter = (result.drafts || []).reduce(
    (sum, item) => sum + (item.invalid?.length || 0) + (item.recoveryButtons || 0),
    0,
  );
} catch (error) {
  result.warnings.push(`fatal: ${error.message}`);
  await shot('apply-flex-fatal.png');
} finally {
  result.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(inventoryDir, 'apply-flex-chrome.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await context.close().catch(() => {});
}
