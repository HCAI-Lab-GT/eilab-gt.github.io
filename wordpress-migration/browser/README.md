# Sites@GT Playwright scripts

These scripts drive the WordPress dashboard after Glenn completes Georgia Tech SSO/Duo in a headed Chromium window. They poll `#wpadminbar`. They do not bypass MFA.

Persistent profile: `browser/.auth/gt-wordpress` (gitignored). Do not commit or share it.

## Install

```bash
cd wordpress-migration/browser
npm install
npx playwright install chromium
```

Copy `../.env.example` to `../.env` if needed. `WP_URL` must be `https://sites.gatech.edu/hcailab`.

## Commands that still matter

**Preview local HTML** (no WordPress):

```bash
npm run preview
```

Writes `../build/preview/*.png`.

**Apply rebuilt bodies and Flex chrome** to the existing six pages:

```bash
npm run apply
ONLY_SLUGS=people npm run apply
SKIP_BODIES=1 npm run apply
```

See `../docs/runbook.md` for the persist contract. This is the post-import write path.

**Discover** (read-only dashboard inventory):

```bash
npm run discover
```

Writes `../build/admin-discovery/`.

**Publish** the six pages and assign Home as the front page. Already done on this host. Do not rerun unless a page was accidentally drafted.

```bash
npm run publish
```

## First-import leftovers

`import-once.mjs`, `configure-site.mjs`, `finish-chrome.mjs`, `verify-import.mjs`, and `verify-slugs.mjs` were for the 2026 staging import. They remain for a from-scratch Sites@GT rebuild. They must not run against the live HCAI site while `wxr-import-done.json` is `imported: true`.

`configure-site.mjs` is a no-op unless `APPLY=1`.

## Security

- `.auth/` stays local and untracked.
- Do not enter credentials into the terminal or an AI prompt.
- Glenn, not the automation, completes Duo.
