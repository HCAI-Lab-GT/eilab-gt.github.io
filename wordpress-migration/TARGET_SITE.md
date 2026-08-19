# Target Site: HCAI Lab Staging

## Fixed values

- **WordPress staging URL:** `https://sites.gatech.edu/hcailab/`
- **Dashboard:** `https://sites.gatech.edu/hcailab/wp-admin/`
- **Primary REST endpoint candidate:** `https://sites.gatech.edu/hcailab/wp-json/`
- **REST fallback candidate:** `https://sites.gatech.edu/hcailab/?rest_route=/`
- **Current source repository:** `HCAI-Lab-GT/eilab-gt.github.io`
- **Desired site title:** `Human-Centered AI Lab`
- **Desired tagline:** `Georgia Institute of Technology`
- **Default migration status:** `draft`

The staging site already exists and Glenn has administrator access. Do not ask for the site URL again and do not ask OIT for routine platform-capability questions. Discover them directly using the public REST probe and, when needed, authenticated Playwright dashboard inventory.

## First operation

From `migration/` run:

```bash
./run-first-pass.sh
```

Windows PowerShell:

```powershell
./run-first-pass.ps1
```

This installs local dependencies, audits the source, probes WordPress without mutation, builds the normalized content and WXR package, and runs tests. A failed public REST probe is non-fatal; continue the local build and use the Playwright discovery path.

## Mutation boundary

- Safe without further approval: source audit, REST GET discovery, local rendering, WXR generation, tests, dashboard inventory, screenshots, dry-run synchronization.
- Allowed only as drafts after reviewing the dry-run plan: create/update the six migration pages and upload approved media.
- Never do automatically: publish pages, change DNS, alter the old `CNAME`, disable GitHub Pages, delete WordPress content, or request/map a final domain.
