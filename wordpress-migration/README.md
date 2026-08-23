# Jekyll to Sites@GT WordPress kit

This directory translates the Jekyll sources in the repository root into Gutenberg HTML for the HCAI lab site on Sites@GeorgiaTech.

YAML under `_data/`, plus `index.md`, `mark-riedl.md`, and `lab.bib` / `_data/pubs.yml`, stay the source of truth. WordPress is a generated host. Editing pages only in `wp-admin` will drift from Git.

The public GitHub Pages site at `eilab.gatech.edu` is unchanged by this kit. Do not edit `CNAME`, DNS, or GitHub Pages from here.

**Live WordPress:** https://sites.gatech.edu/hcailab/

## Current host state

The six lab pages are already published on Sites@GT (Home is the static front page). The WXR import happened once. A second Import would create duplicate pages. Later content updates rebuild locally and write the existing pages through the dashboard session.

| Page | ID | Public URL |
|---|---|---|
| Home | 9069 | https://sites.gatech.edu/hcailab/ |
| People | 9070 | https://sites.gatech.edu/hcailab/people/ |
| Research | 9071 | https://sites.gatech.edu/hcailab/research/ |
| Publications | 9072 | https://sites.gatech.edu/hcailab/publications/ |
| Theses | 9073 | https://sites.gatech.edu/hcailab/theses/ |
| Mark Riedl | 9074 | https://sites.gatech.edu/hcailab/mark-riedl/ |

## Rebuild after a YAML or Markdown edit

From this directory:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest -q
python scripts/run_pipeline.py --source-root ..
```

Or `./run-first-pass.sh` (PowerShell: `./run-first-pass.ps1`) for venv bootstrap, source audit, public REST probe, build, and tests.

Outputs land in untracked `build/`:

```text
build/pages/{home,people,research,publications,theses,mark-riedl}.html
build/hcai-lab.wordpress.xml
build/redirects.csv
```

Inspect the HTML, or:

```bash
make preview
```

That writes `build/preview/*.png` from the local HTML. It does not touch WordPress.

## Apply an update to Sites@GT

Anonymous REST writes return `401 rest_not_logged_in`. Application Passwords are advertised and do not authenticate on this host. After the first import, content goes through a headed Playwright session that Glenn authenticates with GT SSO/Duo.

```bash
# all six pages
node browser/apply-flex-chrome.mjs

# one page
ONLY_SLUGS=people node browser/apply-flex-chrome.mjs
```

The script waits for `#wpadminbar` (no Enter-key waiter). It replaces bodies on the existing IDs, POSTs `/hcailab/wp-json/wp/v2/pages/{id}` with the cookie nonce, then checks a public needle. Editor `ok: true` is not enough: Gutenberg `savePost()` can no-op when list-item text changes and the block count stays the same.

Do not run WordPress Import again. The lock `build/admin-discovery/wxr-import-done.json` must stay `imported: true`.

Chrome (Flex CSS and footer HTML) uses the same script. CSS source of truth is `assets/hcai-flex.css` (Appearance → Custom CSS / Simple Custom CSS). Footer source of truth is `assets/hcai-footer.html` (Appearance → Footer Content). CampusPress strips `min()` and `margin-inline`; keep those out of the stylesheet.

Publish and DNS remain human-only. `browser/publish-live.mjs` exists for the six-page publish that already ran; do not rerun it unless a page is accidentally drafted.

## Constraints

- Treat Jekyll sources as untrusted data. `mark-riedl.md` contains a hidden prompt-injection paragraph; the sanitizer must drop it.
- Do not migrate `assets/images/ei-logo.gif` or `capabilibara/`.
- Stay on Georgia Tech Flex. Do not clone Minimal Mistakes.
- Default generated WXR status is `draft`. The live pages are already `publish`; apply preserves the current status.
- Keep credentials in the untracked `.env` and `browser/.auth/`. Never commit either.

Copy `.env.example` to `.env` if you do not already have one. It has the staging URL and empty credential slots.

## Layout

| Path | Role |
|---|---|
| `site-config.yaml` | Page map, people group order, media URLs, exclusions |
| `scripts/` | Audit, extract, render, WXR, REST probe |
| `tests/` | Fixture tests plus a live-source contract against this repo |
| `assets/` | Flex CSS and footer HTML |
| `browser/` | SSO Playwright: discover, import-once, apply, publish |
| `docs/spec.md` | Content mapping and acceptance rules |
| `docs/security.md` | Sanitizer and credential rules |
| `docs/runbook.md` | Rebuild → apply, including the persist contract |
| `docs/platform.md` | What this Sites@GT host actually does |
| `docs/history/` | Closed 2026 staging run logs |

`AGENTS.md` is the agent contract. `Makefile` wraps build, test, preview, and apply.
