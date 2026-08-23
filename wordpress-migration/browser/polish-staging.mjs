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

const profileDir = path.join(browserDir, '.auth', 'gt-wordpress');
const baselineDir = path.join(rootDir, 'build', 'polish-baseline');
const afterDir = path.join(rootDir, 'build', 'polish-after');
const inventoryDir = path.join(rootDir, 'build', 'polish-inventory');
const pagesDir = path.join(rootDir, 'build', 'pages');
await fs.mkdir(baselineDir, { recursive: true });
await fs.mkdir(afterDir, { recursive: true });
await fs.mkdir(inventoryDir, { recursive: true });

const css = await fs.readFile(path.join(rootDir, 'assets', 'hcai-flex.css'), 'utf8');
const footerHtml = (await fs.readFile(path.join(rootDir, 'assets', 'hcai-footer.html'), 'utf8')).trim();
const importLock = JSON.parse(
  await fs.readFile(path.join(rootDir, 'build', 'admin-discovery', 'wxr-import-done.json'), 'utf8'),
);
if (importLock.imported !== true) {
  throw new Error('WXR lock is not imported:true; polish must not import');
}

const skipBaseline = process.env.SKIP_BASELINE === '1';
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
  imported: importLock.imported === true,
  cssControl: null,
  footerControl: null,
  theme: null,
  appearanceLinks: [],
  customizeSettings: [],
  drafts: [],
  recoveryBefore: {},
  recoveryAfter: {},
};

async function sleep(ms) {
  await page.waitForTimeout(ms);
}

async function shot(dir, name) {
  const file = path.join(dir, name);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}

async function waitForAdmin() {
  console.log('SSO WINDOW OPEN — complete GT SSO/Duo in Google Chrome for Testing if prompted.');
  console.log('This script never imports and never publishes pages.');
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

async function dismissEditorNuisances() {
  await page.keyboard.press('Escape').catch(() => {});
  const closers = page.locator(
    '.edit-post-welcome-guide .components-modal__header button, .components-modal__header button[aria-label="Close"], button:has-text("Skip")',
  );
  const n = await closers.count();
  for (let i = 0; i < n; i += 1) await closers.nth(i).click({ timeout: 500 }).catch(() => {});
}

async function readEditorState(id) {
  await page.goto(`${wpUrl}/wp-admin/post.php?post=${id}&action=edit`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  await dismissEditorNuisances();
  await page.waitForFunction(() => Boolean(window.wp?.data?.select), { timeout: 20_000 }).catch(() => {});
  await sleep(600);
  const state = await page.evaluate(() => {
    const select = window.wp?.data?.select;
    const post = select ? select('core/editor')?.getCurrentPost?.() : null;
    const blocks = select ? select('core/block-editor')?.getBlocks?.() || [] : [];
    function walk(list) {
      return list.flatMap((block) => [
        { name: block.name, isValid: block.isValid !== false },
        ...walk(block.innerBlocks || []),
      ]);
    }
    const walked = walk(blocks);
    return {
      status: post?.status || '',
      slug: post?.slug || '',
      title: post?.title || document.title,
      blockCount: walked.length,
      invalidBlocks: walked.filter((block) => !block.isValid).map((block) => block.name),
    };
  });
  const recoveryButtons = await page.locator('button:has-text("Attempt recovery"), button:has-text("Resolve")').count();
  const warningText = await page.locator('.block-editor-warning, .block-editor-block-list__block-invalid').count();
  return { ...state, recoveryButtons, warningText };
}

async function dismissPreviewChrome() {
  await page.evaluate(() => {
    for (const sel of [
      '#edac-highlight-panel',
      '.edac-highlight-panel',
      '.edac-highlight',
      '#wpadminbar',
    ]) {
      document.querySelectorAll(sel).forEach((el) => {
        if (sel === '#wpadminbar') return;
        el.remove();
      });
    }
    document.querySelectorAll('button').forEach((btn) => {
      const text = (btn.textContent || '').trim();
      if (/^ignore$/i.test(text) || /^clear ignored issues$/i.test(text)) btn.click();
    });
  }).catch(() => {});
  const ignore = page.locator('button:has-text("Ignore")').first();
  if (await ignore.count()) await ignore.click({ timeout: 500 }).catch(() => {});
}

async function screenshotDrafts(dir) {
  for (const draft of drafts) {
    const previewUrl = `${wpUrl}/?page_id=${draft.id}&preview=true`;
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(previewUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await sleep(1200);
      await dismissPreviewChrome();
      await page.waitForFunction(
        () => [...document.images].every((img) => img.complete),
        { timeout: 12_000 },
      ).catch(() => {});
      await shot(dir, `${draft.slug}-${viewport.name}.png`);
      result.actions.push(`screenshot ${path.basename(dir)} ${draft.slug} ${viewport.name}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

async function inventoryChrome() {
  await page.goto(`${wpUrl}/wp-admin/`, { waitUntil: 'domcontentloaded' });
  result.appearanceLinks = await page.evaluate(() => {
    const menu = document.querySelector('#menu-appearance');
    if (!menu) return [];
    return [...menu.querySelectorAll('a')].map((a) => ({
      text: a.textContent.replace(/\s+/g, ' ').trim(),
      href: a.href,
    }));
  });
  await shot(inventoryDir, 'appearance-menu.png');

  const candidatePages = [
    ['/wp-admin/themes.php', 'themes.png'],
    ['/wp-admin/themes.php?page=custom-css', 'custom-css-plugin.png'],
    ['/wp-admin/themes.php?page=simple-custom-css', 'simple-custom-css.png'],
    ['/wp-admin/themes.php?page=sccss', 'sccss.png'],
    ['/wp-admin/admin.php?page=custom-css', 'admin-custom-css.png'],
    ['/wp-admin/widgets.php', 'widgets.png'],
    ['/wp-admin/nav-menus.php', 'menus.png'],
    ['/wp-admin/customize.php', 'customize.png'],
  ];
  for (const item of result.appearanceLinks) {
    if (/footer/i.test(item.text) && item.href) {
      candidatePages.push([item.href.replace(wpUrl, '') || item.href, 'footer-content.png']);
    }
    if (/theme options/i.test(item.text) && item.href) {
      candidatePages.push([item.href.replace(wpUrl, '') || item.href, 'theme-options.png']);
    }
  }
  candidatePages.push(['/wp-admin/admin.php?page=theme-options', 'theme-options-admin.png']);
  for (const [pathname, name] of candidatePages) {
    await page.goto(`${wpUrl}${pathname}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(800);
    await shot(inventoryDir, name);
  }

  await page.goto(`${wpUrl}/wp-admin/themes.php`, { waitUntil: 'domcontentloaded' });
  result.theme = await page.locator('.theme.active .theme-name, .theme.active h2').first().innerText().catch(() => null);
  await page.goto(`${wpUrl}/wp-admin/edit.php?post_type=page&post_status=all`, { waitUntil: 'domcontentloaded' });
  result.pageCounts = (await page.locator('.subsubsub').innerText().catch(() => '')) || '';
  await shot(inventoryDir, 'pages-all.png');
}

async function applyCustomCssPlugin() {
  const urls = [
    ...result.appearanceLinks
      .filter((item) => /custom css/i.test(item.text))
      .map((item) => item.href),
    `${wpUrl}/wp-admin/themes.php?page=custom-css`,
    `${wpUrl}/wp-admin/themes.php?page=sccss`,
    `${wpUrl}/wp-admin/themes.php?page=simple-custom-css`,
  ].filter(Boolean);
  const seen = new Set();
  for (const url of urls) {
    if (seen.has(url) || /customize\.php/i.test(url)) continue;
    seen.add(url);
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(800);
    if (/customize\.php/i.test(page.url())) continue;
    const applied = await page.evaluate((nextCss) => {
      const ta =
        document.querySelector('textarea.sccss-content') ||
        document.querySelector('textarea[name="sccss_settings[sccss-content]"]') ||
        document.querySelector('textarea[name="custom_css"]') ||
        document.querySelector('#sccss_settings\\[sccss-content\\]');
      const cm = document.querySelector('.CodeMirror');
      if (cm && cm.CodeMirror) {
        cm.CodeMirror.setValue(nextCss);
        if (ta) ta.value = nextCss;
        return 'codemirror';
      }
      if (ta) {
        ta.value = nextCss;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        return 'textarea';
      }
      return null;
    }, css);
    if (!applied) continue;
    const save = page.locator('input[type="submit"], button[type="submit"]').filter({ hasText: /save/i }).first();
    if (await save.count()) {
      await save.click();
      await page.waitForLoadState('domcontentloaded');
      result.cssControl = `${page.url()} (${applied})`;
      result.actions.push(`saved CSS via ${result.cssControl}`);
      await shot(inventoryDir, 'custom-css-saved.png');
      return true;
    }
  }
  return false;
}

async function openCustomizer() {
  await page.goto(`${wpUrl}/wp-admin/customize.php`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.wp?.customize), { timeout: 45_000 });
  await sleep(1500);
}

async function customizeSettingIds() {
  return page.evaluate(() => {
    const settings = window.wp?.customize?.settings?.settings || {};
    return Object.keys(settings);
  });
}

async function setCustomize(id, value) {
  return page.evaluate(
    ({ settingId, settingValue }) => {
      const setting = window.wp?.customize?.(settingId);
      if (!setting) return false;
      setting.set(settingValue);
      return true;
    },
    { settingId: id, settingValue: value },
  );
}

async function saveCustomizer() {
  const saved = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve('timeout'), 40_000);
        if (!window.wp?.customize) {
          clearTimeout(timer);
          resolve('missing-customize');
          return;
        }
        wp.customize.bind('saved', () => {
          clearTimeout(timer);
          resolve('saved');
        });
        if (wp.customize.previewer?.save) wp.customize.previewer.save();
        else document.querySelector('#save')?.click();
      }),
  );
  if (saved !== 'saved') {
    const button = page.locator('#save');
    if (await button.count()) {
      await button.click({ force: true }).catch(() => {});
      await sleep(4000);
    }
  }
  result.actions.push(`customizer save result=${saved}`);
  return saved;
}

async function applyViaCustomizer({ includeCss }) {
  await openCustomizer();
  result.customizeSettings = await customizeSettingIds();
  await shot(inventoryDir, 'customize-ready.png');

  if (includeCss) {
    const cssIds = result.customizeSettings.filter((id) => /custom_css/i.test(id));
    let cssSet = false;
    for (const id of cssIds) {
      cssSet = (await setCustomize(id, css)) || cssSet;
    }
    if (!cssSet) {
      cssSet = await page.evaluate((nextCss) => {
        const keys = Object.keys(wp.customize.settings.settings || {}).filter((id) => /custom_css/i.test(id));
        if (!keys.length && wp.customize('custom_css')) {
          wp.customize('custom_css').set(nextCss);
          return 'custom_css';
        }
        keys.forEach((id) => wp.customize(id).set(nextCss));
        return keys[0] || false;
      }, css);
    }
    if (cssSet) {
      result.cssControl = result.cssControl || `customizer:${cssSet}`;
      result.actions.push(`set customizer CSS on ${cssSet}`);
    } else {
      result.warnings.push('no customizer custom_css setting found');
    }
  } else {
    result.actions.push('skipped customizer CSS because plugin page already saved it');
  }

  const footerIds = result.customizeSettings.filter((id) =>
    /footer_main_custom_html|footer_custom|custom_footer/i.test(id),
  );
  let footerSet = false;
  for (const id of footerIds.length ? footerIds : ['footer_main_custom_html']) {
    footerSet = (await setCustomize(id, footerHtml)) || footerSet;
    if (footerSet) {
      result.footerControl = `customizer:${id}`;
      result.actions.push(`set footer HTML on ${id}`);
      break;
    }
  }
  if (!footerSet) result.warnings.push('footer_main_custom_html setting not found');

  if (result.customizeSettings.includes('body_font_size')) {
    const current = await page.evaluate(() => wp.customize('body_font_size')?.get());
    result.actions.push(`body_font_size before=${current}`);
    if (Number(current) < 112) {
      await setCustomize('body_font_size', 112);
      result.actions.push('set body_font_size=112');
    }
  }

  await saveCustomizer();
  await shot(inventoryDir, 'customize-after-save.png');
}

async function applyFooterContentPage() {
  const urls = [
    ...result.appearanceLinks.filter((item) => /footer/i.test(item.text)).map((item) => item.href),
    `${wpUrl}/wp-admin/themes.php?page=footer-content`,
    `${wpUrl}/wp-admin/admin.php?page=footer-content`,
  ].filter(Boolean);
  const seen = new Set();
  for (const url of urls) {
    if (seen.has(url) || /customize\.php|nav-menus|widgets/i.test(url)) continue;
    seen.add(url);
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(800);
    await shot(inventoryDir, 'footer-content-page.png');
    const applied = await page.evaluate((html) => {
      const editors = [
        ...document.querySelectorAll('textarea, .wp-editor-area, .CodeMirror'),
      ];
      for (const el of editors) {
        if (el.classList.contains('CodeMirror') && el.CodeMirror) {
          el.CodeMirror.setValue(html);
          return 'codemirror';
        }
        if (el.tagName === 'TEXTAREA') {
          el.value = html;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return el.name || el.id || 'textarea';
        }
      }
      if (window.tinyMCE?.editors) {
        const ids = Object.keys(window.tinyMCE.editors);
        if (ids.length) {
          window.tinyMCE.editors[ids[0]].setContent(html);
          return `tinymce:${ids[0]}`;
        }
      }
      return null;
    }, footerHtml);
    if (!applied) continue;
    const save = page.locator('input[type="submit"], button[type="submit"]').filter({ hasText: /save|update/i }).first();
    if (await save.count()) {
      await save.click();
      await page.waitForLoadState('domcontentloaded');
      result.footerControl = `${page.url()} (${applied})`;
      result.actions.push(`saved footer via ${result.footerControl}`);
      await shot(inventoryDir, 'footer-content-saved.png');
      return true;
    }
  }
  return false;
}

async function applyFooterWidgetFallback() {
  if (result.footerControl) return;
  await page.goto(`${wpUrl}/wp-admin/widgets.php`, { waitUntil: 'domcontentloaded' });
  await sleep(800);
  const closer = page.locator('.components-modal__header button, button:has-text("Next"), button:has-text("Got it")');
  if (await closer.count()) await closer.first().click({ timeout: 800 }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  const inserted = await page.evaluate(async (html) => {
    if (!window.wp?.data?.dispatch) return false;
    const store = 'core/edit-widgets';
    const select = wp.data.select(store);
    const dispatch = wp.data.dispatch(store);
    if (!select || !dispatch) return false;
    const areas = select.getWidgetAreas ? select.getWidgetAreas() : [];
    const footer =
      (areas || []).find((area) => /footer/i.test(`${area.id || ''} ${area.name || ''}`)) ||
      { id: 'sidebar-1' };
    try {
      const block = wp.blocks.createBlock('core/html', { content: html });
      if (dispatch.insertBlockToWidgetArea) dispatch.insertBlockToWidgetArea(footer.id, block);
      else dispatch.insertBlocks([block]);
      await dispatch.saveEditedWidgetAreas();
      return footer.id || true;
    } catch {
      return false;
    }
  }, footerHtml);
  if (inserted) {
    result.footerControl = `widgets:${inserted}`;
    result.actions.push(`inserted footer HTML widget in ${inserted}`);
  } else {
    result.warnings.push('widget footer fallback failed');
  }
  await shot(inventoryDir, 'widgets-after-footer.png');
}

async function replaceDraftBodies() {
  for (const draft of drafts) {
    const html = await fs.readFile(path.join(pagesDir, `${draft.slug}.html`), 'utf8');
    const before = await readEditorState(draft.id);
    result.recoveryBefore[draft.slug] = before;
    await shot(inventoryDir, `editor-before-${draft.slug}.png`);
    const saved = await page.evaluate(async (nextHtml) => {
      const select = wp.data.select('core/editor');
      const dispatch = wp.data.dispatch('core/editor');
      const post = select.getCurrentPost();
      if (post.status !== 'draft') return { ok: false, reason: `status=${post.status}` };
      const blocks = wp.blocks.parse(nextHtml);
      dispatch.resetBlocks(blocks);
      dispatch.editPost({ status: 'draft', slug: post.slug });
      await dispatch.savePost();
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        if (!select.isSavingPost() && !select.isAutosavingPost()) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const after = select.getCurrentPost();
      const walked = (function walk(list) {
        return list.flatMap((block) => [
          { name: block.name, isValid: block.isValid !== false },
          ...walk(block.innerBlocks || []),
        ]);
      })(wp.data.select('core/block-editor').getBlocks());
      return {
        ok: after.status === 'draft',
        status: after.status,
        slug: after.slug,
        blockCount: walked.length,
        invalid: walked.filter((block) => !block.isValid).map((block) => block.name),
      };
    }, html);
    if (!saved.ok) result.warnings.push(`save failed for ${draft.slug}: ${JSON.stringify(saved)}`);
    else result.actions.push(`replaced body ${draft.id} ${draft.slug} blocks=${saved.blockCount}`);
    await sleep(800);
    const after = await readEditorState(draft.id);
    result.recoveryAfter[draft.slug] = after;
    result.drafts.push({ ...draft, before, saved, after });
    await shot(inventoryDir, `editor-after-${draft.slug}.png`);
    if (after.status && after.status !== 'draft') {
      throw new Error(`Refusing to continue: ${draft.slug} status is ${after.status}`);
    }
    if (after.slug && after.slug !== draft.slug) {
      result.warnings.push(`slug changed for ${draft.id}: ${after.slug}`);
    }
  }
}

try {
  await waitForAdmin();
  await inventoryChrome();
  if (!skipBaseline) {
    for (const draft of drafts) {
      const state = await readEditorState(draft.id);
      result.recoveryBefore[draft.slug] = state;
      result.actions.push(
        `baseline editor ${draft.slug} status=${state.status} slug=${state.slug} invalid=${state.invalidBlocks.length} recovery=${state.recoveryButtons}`,
      );
    }
    await screenshotDrafts(baselineDir);
  } else {
    result.actions.push('skipped baseline screenshots (SKIP_BASELINE=1)');
  }
  const pluginCss = await applyCustomCssPlugin();
  await applyViaCustomizer({ includeCss: !pluginCss });
  if (!pluginCss && !result.cssControl) result.warnings.push('CSS was not applied through plugin or customizer');
  const footerPage = await applyFooterContentPage();
  if (!footerPage) await applyFooterWidgetFallback();
  await replaceDraftBodies();
  await screenshotDrafts(afterDir);

  await page.goto(`${wpUrl}/wp-admin/themes.php`, { waitUntil: 'domcontentloaded' });
  result.themeAfter = await page.locator('.theme.active .theme-name, .theme.active h2').first().innerText().catch(() => null);
  await page.goto(`${wpUrl}/wp-admin/edit.php?post_type=page&post_status=all`, { waitUntil: 'domcontentloaded' });
  result.pageCountsAfter = (await page.locator('.subsubsub').innerText().catch(() => '')) || '';
  await shot(afterDir, 'pages-all.png');

  const lockAfter = JSON.parse(
    await fs.readFile(path.join(rootDir, 'build', 'admin-discovery', 'wxr-import-done.json'), 'utf8'),
  );
  result.imported = lockAfter.imported === true;
  result.recoveryCountAfter = Object.values(result.recoveryAfter).reduce(
    (sum, item) => sum + (item.invalidBlocks?.length || 0) + (item.recoveryButtons || 0),
    0,
  );
  result.stillDraft = Object.values(result.recoveryAfter).every((item) => item.status === 'draft');
  result.slugsOk = drafts.every((draft) => result.recoveryAfter[draft.slug]?.slug === draft.slug);
} catch (error) {
  result.warnings.push(`fatal: ${error.message}`);
  await shot(inventoryDir, 'fatal.png');
} finally {
  result.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(inventoryDir, 'polish-result.json'), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify(
      {
        cssControl: result.cssControl,
        footerControl: result.footerControl,
        theme: result.themeAfter || result.theme,
        imported: result.imported,
        stillDraft: result.stillDraft,
        slugsOk: result.slugsOk,
        recoveryCountAfter: result.recoveryCountAfter,
        actions: result.actions,
        warnings: result.warnings,
      },
      null,
      2,
    ),
  );
  await context.close().catch(() => {});
}
