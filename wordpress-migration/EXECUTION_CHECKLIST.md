# Execution Checklist

- [ ] Confirm `migration/` is inside the source repository clone.
- [ ] Run `./run-first-pass.sh` or `./run-first-pass.ps1`.
- [ ] Confirm target is `https://sites.gatech.edu/hcailab` in `build/pipeline-report.json`.
- [ ] Resolve every local build/test failure.
- [ ] Review security audit; known hidden content must be excluded from rendered pages.
- [ ] Review six generated page files and source counts.
- [ ] Review redirect and media manifests.
- [ ] Review public REST capability discovery.
- [ ] If needed, run `make browser-discover` and let Glenn complete SSO/Duo.
- [ ] Select REST dry-run or WXR import based on discovered capabilities.
- [ ] Keep all imported/synchronized pages as drafts.
- [ ] Verify official Georgia Tech theme is active.
- [ ] Set Home as static front page only after it exists.
- [ ] Run target verification and accessibility/link checks.
- [ ] Report unresolved `capabilibara/` hosting separately.
- [ ] Do not alter DNS, `CNAME`, GitHub Pages, or publish status.
