# Kit Manifest

Configured for migration of `HCAI-Lab-GT/eilab-gt.github.io` to:

`https://sites.gatech.edu/hcailab/`

## Immediate entrypoints

- `START_HERE.md` — one-command user workflow.
- `PROMPT_FOR_AGENT.md` — ready-to-paste execution prompt.
- `TARGET_SITE.md` — fixed target values and mutation boundary.
- `EXECUTION_CHECKLIST.md` — operational acceptance checklist.
- `run-first-pass.sh` — macOS/Linux bootstrap, audit, discovery, build, and tests.
- `run-first-pass.ps1` — Windows PowerShell equivalent.
- `.env` — preconfigured non-secret target settings; ignored by Git.
- `.env.example` — clean template for recreating `.env`.

## Agent instructions

- `AGENTS.md` — binding implementation and safety instructions.
- `CLAUDE.md` and `GEMINI.md` — tool-specific entrypoints.

## Specification and evidence

- `MIGRATION_SPEC.md` — technical specification and acceptance criteria.
- `SECURITY.md` — prompt-injection, credential, and mutation controls.
- `SOURCE_AUDIT_BASELINE.md` — known current-repository findings.
- `PLATFORM_DISCOVERY.md` — REST, importer, theme, and settings discovery without OIT questions.
- `SOURCES.md` — Georgia Tech, CampusPress, and WordPress documentation.
- `site-config.yaml` — target page map, brand exclusions, media rules, redirects, and defaults.

## Python automation

- `scripts/audit_source.py`
- `scripts/discover_wordpress.py`
- `scripts/extract_site.py`
- `scripts/render_site.py`
- `scripts/build_wxr.py`
- `scripts/sync_wordpress.py`
- `scripts/verify_site.py`
- `scripts/run_pipeline.py`

## Browser fallback

- `browser/load-env.mjs` — loads the preconfigured parent `.env`.
- `browser/discover-admin.mjs` — authenticated read-only dashboard inventory.
- `browser/configure-site.mjs` — guarded theme/import/front-page automation.
- `browser/package.json`
- `browser/README.md`

## Tests

- `tests/test_pipeline.py`
- Representative Jekyll fixtures under `tests/fixtures/source/`

Validation completed before packaging:

```text
Python compileall: PASS
Pytest: 3 passed
Node syntax checks: PASS
Mock REST discovery: PASS
Configured staging URL checks: PASS
```
