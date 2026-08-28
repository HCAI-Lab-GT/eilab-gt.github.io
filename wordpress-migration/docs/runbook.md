# Rebuild and apply runbook

Use this after the first WXR import. The live pages already exist. This loop is how a YAML or Markdown change becomes the public Sites@GT page.

## 1. Edit sources in the repository root

People, projects, publications, and theses live in `_data/`. Home copy lives in `index.md`. The director page lives in `mark-riedl.md`. Publications YAML is produced from `lab.bib` with the existing `bib2yaml` scripts when that is the edit.

Do not start in `wp-admin`. A dashboard-only edit will drift from Git and the next apply will overwrite it.

## 2. Rebuild and test locally

```bash
cd wordpress-migration
source .venv/bin/activate   # or ./run-first-pass.sh
pytest -q
python scripts/run_pipeline.py --source-root ..
```

Both commands must exit 0. `pytest` covers fixtures plus a live-source contract: people groups follow `site-config.yaml`, every YAML member appears under the right heading, internal links use the `/hcailab/` prefix, WXR is six draft pages and zero attachments, `ei-logo.gif` and `capabilibara/` stay out, and the prompt-injection in `mark-riedl.md` is stripped.

Generated bodies: `build/pages/{home,people,research,publications,theses,mark-riedl}.html`.

Optional local screenshots:

```bash
make preview
```

## 3. Apply to the existing WordPress pages

Confirm `build/admin-discovery/wxr-import-done.json` has `imported: true`. If that file is missing locally, copy it from a previous run or recreate `{"imported": true}` only when you have independently confirmed Import already ran. Do not open Tools → Import.

```bash
ONLY_SLUGS=people node browser/apply-flex-chrome.mjs
```

Omit `ONLY_SLUGS` to replace all six pages. `SKIP_BODIES=1` updates Flex CSS and footer only.

Glenn completes GT SSO/Duo in the headed Chromium window if the saved profile is cold. The script polls `#wpadminbar`.

Page IDs (do not recreate these):

| Slug | ID |
|---|---|
| home | 9069 |
| people | 9070 |
| research | 9071 |
| publications | 9072 |
| theses | 9073 |
| mark-riedl | 9074 |

## 4. Persist contract

Gutenberg `savePost()` can return success without writing when the block count is unchanged (typical for list-item text). Status and slug matching the previous post is not a content persist.

The apply script therefore:

1. Parses the rebuilt HTML into blocks and `resetBlocks`.
2. Marks the editor dirty with `editPost({ content: nextHtml })`.
3. Waits until dirty clears after `savePost`.
4. POSTs `/hcailab/wp-json/wp/v2/pages/{id}` with `credentials: 'same-origin'` and `X-WP-Nonce` from `wpApiSettings.nonce`, preserving the current `draft` or `publish` status.
5. Loads the public permalink with a cache-buster and checks that `document.body.innerText` contains a needle from the new HTML.

Anonymous `curl` of the public URL is the confirmation the agent reports. A `Cache-Control` MISS is normal; a HIT of old text means wait and fetch again, not that apply failed.

## 5. Chrome (CSS and footer)

Tracked files:

- `assets/hcai-flex.css` → Appearance → Custom CSS (`themes.php?page=simple-custom-css.php`). Customizer `custom_css` is not the injector on this host.
- `assets/hcai-footer.html` → Appearance → Footer Content (`themes.php?page=footer-content`).

CampusPress CSS sanitizer strips `min()` and `margin-inline`. Do not add those functions; they vanish on save.

## 6. What not to do

- Do not run WordPress Import again.
- Do not call `scripts/sync_wordpress.py` without `--dry-run` expecting a write. Unauthenticated REST POST is `401`.
- Do not change `CNAME`, DNS, or GitHub Pages.
- Do not publish or unpublish unless the user asked.
- Do not migrate `capabilibara/` or `ei-logo.gif`.
- Do not mix dirty root `Gemfile` / `Gemfile.lock` or `hcai-wordpress-migration-agent-handoff.zip` into kit commits.

## First-time import (already done)

The 2026 staging run imported `build/hcai-lab.wordpress.xml` once (six pages, zero attachments, `skip_wxr_attachments: true`). Notes from that run are under `docs/history/`. If you ever rebuild a new Sites@GT site from scratch, read those logs, then `browser/import-once.mjs`, then this runbook from step 3.
