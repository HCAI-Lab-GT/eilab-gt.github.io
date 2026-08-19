# HCAI WordPress Migration — Agent Handoff

## Goal

Migrate `HCAI-Lab-GT/eilab-gt.github.io` to the existing Sites@GeorgiaTech WordPress staging site:

`https://sites.gatech.edu/hcailab/`

## Agent instructions

1. Obtain or open a local clone of `HCAI-Lab-GT/eilab-gt.github.io`.
2. Copy this package's `migration/` directory into the repository root.
3. Read `migration/PROMPT_FOR_AGENT.md` and follow it.
4. Start by running `migration/run-first-pass.sh` or `migration/run-first-pass.ps1`.
5. Do not ask for the target URL. Do not ask OIT questions that public REST or authenticated dashboard discovery can answer.
6. Keep remote changes as drafts; never publish or alter DNS, the old `CNAME`, or GitHub Pages.
7. Pause only when Glenn must personally complete Georgia Tech SSO/Duo or explicitly approve a guarded mutation.

The package contains no credentials. `migration/.env` contains only the fixed staging URL and safe defaults.
