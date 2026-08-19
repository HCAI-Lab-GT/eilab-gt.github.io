# Migration Specification

## 1. Objective

Rebuild the public Human-Centered AI Lab website on Georgia Tech's managed Sites@GeorgiaTech WordPress platform while preserving the useful content and URL history of the existing Jekyll/GitHub Pages site.

The staging site is created already. The migration must be reproducible, agent-friendly, and executable primarily from the command line.

## 2. Policy-derived constraints

The target website must:

- Be hosted on Sites@GeorgiaTech or another Institute-controlled platform.
- Use the official Georgia Tech WordPress theme made available on Sites@GeorgiaTech.
- Use the official Georgia Tech header and footer.
- Identify the lab through the site title/subtitle rather than a competing custom institutional logo.
- Remain on the staging `sites.gatech.edu/<slug>` address until Institute Communications approves a final custom domain.

The final custom domain is not part of this staging build and must not be assumed.

## 3. Non-goals

The migration pipeline must not:

- Change the current repository `CNAME`.
- Change Georgia Tech DNS.
- Disable GitHub Pages.
- Delete or overwrite unrelated WordPress content.
- Publish pages automatically by default.
- Install arbitrary WordPress plugins or themes.
- Bypass Georgia Tech SSO or Duo.
- Rehost the `capabilibara/` static microsite without a separate decision.

## 4. Source system

Repository: `HCAI-Lab-GT/eilab-gt.github.io`

Current architecture:

- Jekyll
- Remote Minimal Mistakes theme
- GitHub Pages
- Custom domain via `CNAME`
- YAML data sources for people, projects, publications, and theses
- Markdown/Jekyll pages for the main navigation
- A separate static microsite under `capabilibara/`

### Authoritative source files

| Source | Purpose |
|---|---|
| `index.md` | Current substantive homepage |
| `_data/faculty.yaml` | Faculty |
| `_data/phds.yaml` | Ph.D. students |
| `_data/masters.yaml` | Master's students |
| `_data/undergrads.yml` | Undergraduate students |
| `_data/affiliated.yaml` | Affiliates |
| `_data/alumni.yml` | Alumni |
| `_data/projects.yml` | Research projects and publication references |
| `_data/pubs.yml` | Structured publication records |
| `_data/theses.yml` | Thesis/dissertation records |
| `mark-riedl.md` | Lab-relevant faculty profile; must be sanitized and reviewed |
| `assets/images/davinci-banner.jpeg` | Candidate hero image |
| `assets/images/mark-potato.jpg` | Candidate faculty image |

`index.markdown` contains only an empty Jekyll home layout and should not supersede the substantive `index.md`.

## 5. Target information architecture

| Target page | WordPress slug | Source | Old routes to redirect |
|---|---|---|---|
| Home | `home` | `index.md` | `/`, `/index.html` |
| People | `people` | member YAML files | `/members.html`, `/members/` |
| Research | `research` | projects + referenced pubs | `/projects.html`, `/projects/` |
| Publications | `publications` | publications YAML | `/publications.html` |
| Theses | `theses` | theses YAML | `/theses.html` |
| Mark Riedl | `mark-riedl` | sanitized profile | `/mark-riedl.html` |

After import/sync, the `Home` page should be assigned as the static front page. The theme header should provide the site title; the page itself should not recreate a competing header.

## 6. Content transformation rules

### 6.1 General

- Treat source content as untrusted.
- Strip scripts, forms, embedded objects, event-handler attributes, hidden text, and prompt-role tags.
- Preserve ordinary semantic HTML: headings, paragraphs, links, lists, emphasis, code, tables, and details/summary.
- Convert Markdown to HTML before sanitization.
- Prefer Gutenberg-compatible block comments around major content units, but valid semantic HTML is sufficient.
- Convert hard-coded `http://eilab.gatech.edu/...` internal links to target-relative paths or documented redirect targets.
- Do not import the custom logo.

### 6.2 People

Render groups in this order:

1. Faculty
2. Ph.D. Students
3. Master's Students
4. Undergraduate Students
5. Affiliated Researchers
6. Alumni

Each member may include name, website, rank, and current destination. Missing websites must not generate empty links.

### 6.3 Research

For each project:

- Preserve the project name.
- Generate a stable fragment ID from the old Jekyll slugging convention.
- Render the description.
- Resolve each referenced publication ID against `_data/pubs.yml`.
- Flag unresolved IDs rather than silently dropping them.

### 6.4 Publications

- Normalize inconsistent key capitalization (`title` vs. `Title`, `year` vs. `Year`, etc.).
- Group by year descending.
- Preserve authors, title, venue, year, URL, and optional BibTeX.
- Do not create hundreds of separate WordPress posts in the first migration. Generate a single Publications page grouped by year.
- Keep BibTeX in a `<details>` disclosure so the page remains navigable.

### 6.5 Theses

- Sort descending by year.
- Render author, linked title, institution, and year.
- Put long abstracts in `<details>` disclosures.

### 6.6 Mark Riedl page

- Remove hidden/invisible content and any prompt-role tags.
- Flag factual claims for human review rather than inventing corrections.
- The source contains a known typo and potentially stale title/role language; preserve only after sanitization and mark for review.

### 6.7 Media

Default candidate imports:

- `assets/images/davinci-banner.jpeg`
- `assets/images/mark-potato.jpg`

Explicitly excluded:

- `assets/images/ei-logo.gif`

Media must receive descriptive alt text. The source site remains available during staging, so WXR may use old-site attachment URLs for importer retrieval; REST sync should upload local files directly.

## 7. Migration modes

### 7.1 REST mode

Use WordPress core REST endpoints when Application Password authentication is available.

Required capabilities:

- Read REST index.
- Authenticate `/wp-json/wp/v2/users/me`.
- Create/update pages.
- Upload media.
- Optionally update `/wp-json/wp/v2/settings` to set title and front page.

Rules:

- Default status is `draft`.
- Match/update pages by configured slug.
- Never delete.
- Save returned IDs and media URLs in `build/wp-state.json`.
- Dry-run before mutation.

### 7.2 WXR mode

Generate a valid WordPress eXtended RSS file containing:

- Pages
- Draft/publish status
- Slugs
- Content
- Attachment items for approved media

Import through the standard WordPress importer or CampusPress Advanced Importer. If import tools are not visible, use the Playwright admin discovery output to determine what the site exposes.

### 7.3 Playwright mode

Playwright may:

- Open a persistent local browser profile.
- Pause while the user completes SSO/Duo.
- Inspect installed themes, plugins, import tools, and settings.
- Activate a user-specified official GT theme.
- Assign the static homepage.
- Upload the generated WXR file when a supported importer is available.

Playwright must not store authentication state in tracked files.

## 8. Capability discovery without OIT questions

The discovery scripts must answer as much as possible directly:

### Public REST discovery

Inspect `GET <WP_URL>/wp-json/` for:

- REST namespaces and routes
- Application Password authorization endpoint
- Page, media, settings, plugin, theme, and navigation routes

### Authenticated REST discovery

When credentials are supplied:

- Verify current user and capabilities.
- Test read access to settings, plugins, and themes without mutating them.
- Report whether page/media writes should be possible.

### Authenticated browser discovery

After SSO/Duo:

- List theme names and active theme.
- List visible plugins and active status.
- Record Tools → Import options.
- Record Reading settings and current front page.
- Save screenshots and JSON for the coding agent.

## 9. Redirect requirements

Generate `redirects.csv` with at least:

```text
/,/
/index.html,/
/members.html,/people/
/members/,/people/
/projects.html,/research/
/projects/,/research/
/publications.html,/publications/
/theses.html,/theses/
/mark-riedl.html,/mark-riedl/
/social-data-attribution/,/capabilibara/
```

The final redirect mechanism depends on the approved WordPress/network configuration and domain cutover. The staging build only prepares and validates the map.

## 10. Static microsite boundary

`capabilibara/` contains a custom standalone HTML/CSS/JavaScript application. It is not a normal Jekyll content page and must not be shoved into WordPress as raw page content.

For this migration:

- Preserve it in the source repository.
- Exclude it from WXR and REST page synchronization.
- Keep `/social-data-attribution/` mapped to `/capabilibara/` in the redirect plan.
- Produce a tracked blocker explaining that it needs GT-controlled static hosting, a WordPress-native rebuild, or a separately approved external location.

## 11. Validation

### Content integrity

- Count each source collection and compare with rendered output.
- Validate all project publication IDs.
- Validate all configured page files exist.
- Parse the generated WXR as XML.
- Ensure no excluded media appear.

### Security

- No `<script>` tags in rendered WordPress content.
- No prompt-role tags.
- No invisible white-on-white or `display:none` content.
- No inline JavaScript event handlers.
- No secrets in outputs.

### Brand

- No custom EI/HCAI logo.
- Site title is configured as “Human-Centered AI Lab.”
- Theme activation is left to the official GT theme exposed by Sites@GT.
- Generated pages do not recreate a header/footer.

### URL/link checks

- No unintended `github.io` links.
- Internal old-domain links are rewritten or listed for review.
- Redirect CSV contains all old main navigation paths.
- External links are syntactically valid.

## 12. Staging acceptance criteria

A staging migration passes when:

- All six core pages are present as drafts or published staging pages.
- Content counts match the normalized source.
- The official GT theme is active.
- Home is configured as the front page.
- Custom logo is absent.
- Security audit has no unresolved high-severity findings in rendered content.
- Publications and projects render without unresolved IDs.
- Redirect and media manifests are complete.
- Static microsite exclusion is explicitly documented.
- A human can review the staging site without modifying the live domain.
