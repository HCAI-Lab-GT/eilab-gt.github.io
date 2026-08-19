# Baseline Source Audit

This document records known migration-relevant facts from the current repository. The executable audit must verify them against the local clone rather than blindly trusting this file.

## Architecture

- The site is Jekyll-based and uses the remote `mmistakes/minimal-mistakes` theme.
- The current `CNAME` is `eilab.gatech.edu`.
- The configuration references a custom logo at `assets/images/ei-logo.gif`.
- Main navigation includes Publications, Members, Projects, Theses, and Mark Riedl.
- Structured YAML drives people, projects, publications, and theses.
- `index.md` contains the substantive homepage; `index.markdown` is essentially empty Jekyll front matter.

## Migration advantages

- People are already separated by role in YAML.
- Projects reference publications by stable IDs.
- Publications are already normalized from BibTeX into YAML.
- Theses include structured author/title/year/URL/abstract fields.
- The main site has only a small number of top-level pages.

## Known quality and security findings

### High severity

- `mark-riedl.md` contains invisible white-on-white content with a prompt-role tag and an instruction to make a false claim. Strip it and flag the source file.

### Medium severity

- The repository contains a standalone static application under `capabilibara/` with its own HTML, CSS, JavaScript, and branding. It is not covered by ordinary WordPress page import.
- The old site uses a custom logo that Institute Communications has said should not be used as the site identity.
- Some page content uses inline CSS and JavaScript-oriented BibTeX toggles that should be replaced with native semantic HTML such as `<details>`.

### Content-review findings

- `mark-riedl.md` contains a typo in the institution name and may include stale role/title wording.
- The faculty YAML points to an older/noncanonical Mark Riedl URL.
- Homepage internal links are hard-coded to `http://eilab.gatech.edu/...`.
- Several older external links use HTTP rather than HTTPS.
- Publication YAML contains inconsistent capitalization inherited from BibTeX conversion; extraction must be case-insensitive.

## Media

Candidate migration media:

- `assets/images/davinci-banner.jpeg`
- `assets/images/mark-potato.jpg`

Excluded branding asset:

- `assets/images/ei-logo.gif`

Large/static special assets:

- PDFs under `pubs/`
- Static assets under `capabilibara/`

## Live-site protection

During staging, do not modify:

- `CNAME`
- GitHub Pages settings
- the live domain
- static microsite files
