# Start Here — HCAI WordPress Migration

The target is already configured as `https://sites.gatech.edu/hcailab/`.

Copy/extract this `migration/` directory into the root of a clone of `HCAI-Lab-GT/eilab-gt.github.io`, then run one command.

## macOS/Linux

```bash
cd migration
chmod +x run-first-pass.sh
./run-first-pass.sh
```

## Windows PowerShell

```powershell
cd migration
Set-ExecutionPolicy -Scope Process Bypass
./run-first-pass.ps1
```

The first pass performs only read-only remote discovery and local file generation. It does not change WordPress, DNS, the old site, or GitHub Pages.

Read these outputs:

```text
build/wordpress-capabilities.md
build/source-audit.md
build/content-review.md
build/migration-summary.md
build/pipeline-report.json
```

If the REST API advertises Application Passwords, create one in your WordPress profile, add `WP_USER` and `WP_APP_PASSWORD` to the untracked `migration/.env`, and run:

```bash
python scripts/discover_wordpress.py
python scripts/sync_wordpress.py --source-root .. --dry-run
```

If REST authentication is unavailable, run the authenticated browser inventory:

```bash
make browser-discover
```

A browser opens. Glenn completes Georgia Tech SSO/Duo once; the script then inventories the exact theme, plugins, importer options, front-page settings, and Application Password visibility.

The default workflow creates no live changes. Do not remove `--dry-run`, set `APPLY=1`, or publish pages until the generated content and action plan have been reviewed.
