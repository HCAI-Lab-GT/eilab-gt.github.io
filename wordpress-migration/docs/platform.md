# Sites@GT host facts

Discovery scripts still probe the live site because CampusPress settings vary. For this HCAI host, the answers are already known. Use them; do not rediscover from a clean slate unless the site is rebuilt.

## Observed on https://sites.gatech.edu/hcailab/

- Theme: Georgia Tech Flex. Stay on it.
- Anonymous REST GET works for public pages. Anonymous REST POST returns `401 rest_not_logged_in`.
- Application Passwords are advertised in the REST index and fail for `/wp-json/wp/v2/users/me`. Do not spend a loop on app-password login.
- Cookie + `X-WP-Nonce` from a logged-in `wp-admin` session can POST `/hcailab/wp-json/wp/v2/pages/{id}`. That is the persist path after import.
- WXR Tools → Import is create-not-update. Import ran once. A second import duplicates `home`, `people`, and the rest.
- Customizer `custom_css` is not the live injector. Appearance → Custom CSS (Simple Custom CSS, `themes.php?page=simple-custom-css.php`) is.
- Footer HTML is Appearance → Footer Content (`themes.php?page=footer-content`).
- CampusPress CSS sanitizer strips `min()` and `margin-inline`.
- Drafts cannot be the Reading front page. Home had to be published before it could be assigned.
- Equalize Digital Accessibility Checker flags four-character link text. Year chips and `PDF`/`Link`/`arXiv` labels need longer accessible names (see render output).
- Playwright must poll `#wpadminbar`. Do not wait for an Enter key.

`scripts/discover_wordpress.py` remains useful as a GET-only health check. It is not a write path.

## 1. Public command-line discovery

The staging URL is preconfigured in `wordpress-migration/.env` as `https://sites.gatech.edu/hcailab`:

```bash
python scripts/discover_wordpress.py
```

WordPress exposes a self-describing REST index at:

```text
<WP_URL>/wp-json/
```

The discovery output tells you:

- Whether REST is available.
- Whether page and media routes exist.
- Whether WordPress advertises an Application Password authorization endpoint.
- Whether settings, themes, plugins, and navigation routes exist.
- Whether the likely path is REST sync or WXR import.

Output:

```text
build/wordpress-capabilities.json
build/wordpress-capabilities.md
```

This step performs GET requests only.

## 2. Determine whether Application Passwords work

If discovery reports:

```text
application_passwords_advertised: true
```

log into WordPress and inspect your user profile for an **Application Passwords** section. CampusPress network administrators can disable this feature globally, so the presence of the authorization endpoint and profile controls is the actual answer for your site.

Create a password named something like:

```text
HCAI migration CLI
```

Then set it locally:

```bash
export WP_USER=<wordpress-username>
export WP_APP_PASSWORD='<generated-application-password>'
python scripts/discover_wordpress.py
```

Successful authentication to `/wp-json/wp/v2/users/me` means the command-line agent can probably create pages and upload media. The discovery script also checks whether it can read settings, themes, and plugins.

Do not use your Georgia Tech SSO password as an API password.

## 3. REST dry run

After building the package:

```bash
python scripts/run_pipeline.py --source-root ..
python scripts/sync_wordpress.py --source-root .. --dry-run
```

The dry run authenticates, reads current pages/media, and writes `build/sync-plan.json`, but does not create or modify content.

When the plan is correct:

```bash
python scripts/sync_wordpress.py --source-root .. --status draft
```

To set the Home page as the front page through REST as part of a later run:

```bash
python scripts/sync_wordpress.py \
  --source-root .. \
  --status draft \
  --set-front-page
```

WordPress core exposes site title, tagline, timezone, `show_on_front`, and `page_on_front` through the authenticated Settings REST endpoint when the user has the necessary capability.

## 4. Authenticated dashboard discovery with almost no manual UI work

When REST cannot answer theme/import questions:

```bash
cd browser
npm install
npx playwright install chromium
npm run discover
```

The browser opens. Complete SSO/Duo. The script polls `#wpadminbar`, then inventories:

- Installed themes and the active theme.
- Visible plugins.
- Tools → Import entries and links.
- General settings.
- Reading/front-page settings.
- Whether the Application Password section appears in the user profile.

The results and screenshots are written under:

```text
build/admin-discovery/
```

This is the reliable way to obtain the **exact displayed name of the official Georgia Tech WordPress theme** without asking OIT or manually exploring every dashboard page.

## 5. Determine whether WXR import is available

Inspect:

```text
build/admin-discovery/admin-discovery.json
```

Look for an importer row containing:

- `WordPress`
- `Run Importer`
- `Advanced Importer`

CampusPress documents an Advanced WordPress Importer, but access can be restricted to network super administrators. Georgia Tech's actual configuration is discovered from your dashboard rather than assumed.

The fallback package is:

```text
build/hcai-lab.wordpress.xml
```

The guarded browser configurator can attempt the standard visible WordPress importer without installing a plugin:

```bash
APPLY=1 IMPORT_WXR=1 \
WXR_PATH=../build/hcai-lab.wordpress.xml \
WP_URL="$WP_URL" \
npm run configure
```

If no visible `Run Importer` route exists, the script stops and records that result. It does not install an unapproved plugin.

## 6. Determine the official theme name and activate it

Run browser discovery, then find the active/installed theme whose name and preview correspond to the Georgia Tech theme.

Use the exact displayed name:

```bash
APPLY=1 \
WP_URL="$WP_URL" \
GT_THEME_NAME='<exact name from discovery>' \
npm run configure
```

The configurator also sets:

- Site title: `Human-Centered AI Lab`
- Tagline: `Georgia Institute of Technology`
- Static front page: the page titled `Home`

No change occurs unless `APPLY=1` is set.

## 7. What remains outside command-line discovery

The following are not needed to build the staging site and should be deferred:

- Final custom-domain approval.
- DNS cutover.
- Keeping the old domain as a redirecting alias.
- A hosting decision for the standalone `capabilibara/` microsite.

The custom-domain request happens after the staging site uses the official GT theme and passes review. Sites@GT publicly documents support for only one custom domain per site, so the old-domain redirect ultimately requires Georgia Tech's domain/redirect infrastructure rather than ordinary WordPress content migration.
