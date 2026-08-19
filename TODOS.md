# Lab Website TODOs

Tracked content and maintenance issues for the EI & HCAI lab website.

## Content / Data Quality
- [ ] **Incomplete publication entries** in `pubs.yml` / `lab.bib` — some entries have empty authors or venues (e.g. "Generating rhythm action games using neural networks", "Introducing the concept of 'Rationale Generation'")
- [ ] **Missing thesis institutions** — several 2024 theses show `Ph.D. Dissertation, , 2024` with blank institute fields. All are GT by default but should be explicitly filled.

## Assets
- [ ] **Capabilibara static assets missing from repo** — `capabilibara/static/css/` and `capabilibara/static/images/` are not tracked here but are referenced by `capabilibara/index.html`. May be managed in a separate repo and copied over during deployment.

## Structural / Polish
- [ ] Homepage research-areas table uses raw HTML `<table>` — non-responsive on mobile.
