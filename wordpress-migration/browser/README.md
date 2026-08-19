# Sites@GT Playwright fallback

These scripts automate the WordPress dashboard only after you complete Georgia Tech SSO/Duo in a real browser window.

They are a fallback for settings that are not exposed through the WordPress REST API, especially:

- Discovering the exact official Georgia Tech theme name.
- Discovering visible plugins and import tools.
- Activating the official theme.
- Setting the site title/tagline and static homepage.
- Uploading the generated WXR package through the standard WordPress importer.

## Install

```bash
cd migration/browser
npm install
npx playwright install chromium
```

## Discover, read-only

```bash
npm run discover
```

A browser opens. Complete GT SSO/Duo yourself, make sure the WordPress dashboard loads, then press Enter in the terminal. Results are saved under:

```text
migration/build/admin-discovery/
```

The script records:

- Installed and active themes.
- Visible and active plugins.
- Tools → Import options.
- General and Reading settings.
- Whether an Application Password section is visible in the profile.

## Configure, guarded

No settings change unless `APPLY=1` is supplied.

Dry plan:

```bash
GT_THEME_NAME="<exact theme name from discovery>" \
npm run configure
```

Apply theme, title/tagline, and front page:

```bash
APPLY=1 \
GT_THEME_NAME="<exact theme name>" \
npm run configure
```

Optional standard WXR importer attempt:

```bash
APPLY=1 IMPORT_WXR=1 \
WXR_PATH=../build/hcai-lab.wordpress.xml \
GT_THEME_NAME="<exact theme name>" \
npm run configure
```

The script does not install an importer plugin. It only uses a visible preapproved “Run Importer” route. If that route is absent, it stops and records the remaining action.

## Security

- `.auth/` contains a persistent authenticated browser profile and is ignored by Git.
- Do not share or commit `.auth/`.
- Do not enter credentials into the terminal or an AI prompt.
- The user, not the automation, completes Duo.
