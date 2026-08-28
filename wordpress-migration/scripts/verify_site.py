from __future__ import annotations

import argparse
import sys
import json
import os
import re
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from requests.auth import HTTPBasicAuth

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.common import DEFAULT_BUILD_DIR, ensure_build_dir, load_dotenv, load_manifest, normalize_url, write_json

BANNED_PATTERNS = {
    "custom-logo": re.compile(r"ei-logo\.gif", re.I),
    "prompt-role-tag": re.compile(r"</?(?:user|assistant|system|developer)\b", re.I),
    "hidden-content": re.compile(r"(?:display\s*:\s*none|visibility\s*:\s*hidden|color\s*:\s*(?:#fff(?:fff)?|white)\b)", re.I),
    "script-tag": re.compile(r"<script\b", re.I),
}


def public_page_url(base_url: str, page: Mapping[str, Any]) -> str:
    return base_url + ("/" if page["key"] == "home" else f"/{page['slug']}/")


def check_content(content: str) -> list[str]:
    issues: list[str] = []
    for name, pattern in BANNED_PATTERNS.items():
        if pattern.search(content):
            issues.append(name)
    return issues


def verify_public(session: requests.Session, base_url: str, page: Mapping[str, Any], timeout: int) -> dict[str, Any]:
    url = public_page_url(base_url, page)
    try:
        response = session.get(url, timeout=timeout, allow_redirects=True)
    except requests.RequestException as exc:
        return {"key": page["key"], "url": url, "ok": False, "error": str(exc)}
    text = response.text
    soup = BeautifulSoup(text, "html.parser")
    title = soup.title.get_text(" ", strip=True) if soup.title else None
    brand_text_present = "Georgia Institute of Technology" in soup.get_text(" ", strip=True)
    issues = check_content(text)
    if not brand_text_present:
        issues.append("missing-georgia-tech-brand-text")
    if response.status_code != 200:
        issues.append(f"http-{response.status_code}")
    return {
        "key": page["key"],
        "url": url,
        "final_url": response.url,
        "status": response.status_code,
        "title": title,
        "brand_text_present": brand_text_present,
        "issues": issues,
        "ok": not issues,
    }


def verify_rest(
    session: requests.Session,
    base_url: str,
    page: Mapping[str, Any],
    auth: HTTPBasicAuth,
    timeout: int,
) -> dict[str, Any]:
    url = base_url + f"/wp-json/wp/v2/pages?slug={page['slug']}&context=edit&per_page=10"
    try:
        response = session.get(url, auth=auth, timeout=timeout)
    except requests.RequestException as exc:
        return {"key": page["key"], "url": url, "ok": False, "error": str(exc)}
    try:
        body = response.json()
    except ValueError:
        body = None
    if response.status_code != 200 or not isinstance(body, list) or not body:
        return {
            "key": page["key"],
            "url": url,
            "status": response.status_code,
            "ok": False,
            "issues": ["page-not-found-via-rest"],
        }
    post = body[0]
    rendered = str(post.get("content", {}).get("rendered", ""))
    raw = str(post.get("content", {}).get("raw", ""))
    issues = check_content(rendered + "\n" + raw)
    if str(post.get("title", {}).get("raw") or post.get("title", {}).get("rendered", "")).strip() != str(page["title"]).strip():
        issues.append("title-mismatch")
    return {
        "key": page["key"],
        "url": url,
        "status": response.status_code,
        "post_id": post.get("id"),
        "post_status": post.get("status"),
        "post_link": post.get("link"),
        "issues": issues,
        "ok": not issues,
    }


def render_markdown(report: Mapping[str, Any]) -> str:
    lines = [
        "# WordPress Verification Report",
        "",
        f"Target: `{report['target']}`",
        f"Mode: `{report['mode']}`",
        f"Overall pass: **{report['ok']}**",
        "",
        "| Page | Result | Status | Issues |",
        "|---|---|---:|---|",
    ]
    for result in report["pages"]:
        lines.append(
            f"| {result['key']} | {'PASS' if result.get('ok') else 'FAIL'} | {result.get('status', '—')} | {', '.join(result.get('issues', [])) or 'None'} |"
        )
    lines.extend(
        [
            "",
            "## Interpretation",
            "",
            "- Public mode verifies rendered pages and looks for the Georgia Tech brand text supplied by the official theme.",
            "- REST mode can verify draft pages but cannot prove the public theme/header/footer is correct.",
            "- A public brand failure usually means the official GT theme is not active or the page is not publicly reachable.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the migrated Sites@GT WordPress site.")
    parser.add_argument("--url", default=None)
    parser.add_argument("--build-dir", type=Path, default=DEFAULT_BUILD_DIR)
    parser.add_argument("--username", default=None)
    parser.add_argument("--app-password", default=None)
    parser.add_argument("--timeout", type=int, default=20)
    args = parser.parse_args()

    load_dotenv()
    base_url = normalize_url(args.url or os.getenv("WP_URL") or "")
    if not base_url:
        parser.error("Set --url or WP_URL")
    username = args.username or os.getenv("WP_USER") or None
    app_password = args.app_password or os.getenv("WP_APP_PASSWORD") or None
    if bool(username) != bool(app_password):
        parser.error("Supply both username and application password, or neither")

    build_dir = ensure_build_dir(args.build_dir.resolve())
    manifest = load_manifest(build_dir)
    session = requests.Session()
    session.headers.update({"User-Agent": "HCAI-WordPress-Migration-Verify/1.0"})

    if username and app_password:
        mode = "authenticated-rest"
        auth = HTTPBasicAuth(username, app_password)
        pages = [verify_rest(session, base_url, page, auth, args.timeout) for page in manifest["pages"]]
    else:
        mode = "public-rendered"
        pages = [verify_public(session, base_url, page, args.timeout) for page in manifest["pages"]]

    report = {
        "target": base_url,
        "mode": mode,
        "ok": all(result.get("ok") for result in pages),
        "pages": pages,
    }
    write_json(build_dir / "verification-report.json", report)
    (build_dir / "verification-report.md").write_text(render_markdown(report), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Wrote {build_dir / 'verification-report.json'}")
    print(f"Wrote {build_dir / 'verification-report.md'}")
    return 0 if report["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
