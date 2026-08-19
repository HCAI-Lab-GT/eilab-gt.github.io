from __future__ import annotations

import argparse
import sys
import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests
from requests.auth import HTTPBasicAuth

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.common import DEFAULT_BUILD_DIR, ensure_build_dir, load_dotenv, normalize_url, write_json

ROUTE_PROBES = {
    "pages": "/wp-json/wp/v2/pages?per_page=1&context=view",
    "media": "/wp-json/wp/v2/media?per_page=1&context=view",
    "settings": "/wp-json/wp/v2/settings",
    "current_user": "/wp-json/wp/v2/users/me?context=edit",
    "plugins": "/wp-json/wp/v2/plugins?per_page=100&context=edit",
    "themes": "/wp-json/wp/v2/themes?per_page=100&context=edit",
    "navigation": "/wp-json/wp/v2/navigation?per_page=100&context=edit",
    "menus": "/wp-json/wp/v2/menus?per_page=100&context=edit",
    "menu_items": "/wp-json/wp/v2/menu-items?per_page=100&context=edit",
    "menu_locations": "/wp-json/wp/v2/menu-locations?context=edit",
}


def safe_json(response: requests.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return None


def probe(
    session: requests.Session,
    base_url: str,
    path: str,
    auth: HTTPBasicAuth | None,
    timeout: int,
) -> dict[str, Any]:
    url = urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))
    try:
        response = session.get(url, auth=auth, timeout=timeout, allow_redirects=True)
        body = safe_json(response)
        error_code = body.get("code") if isinstance(body, dict) else None
        error_message = body.get("message") if isinstance(body, dict) else None
        return {
            "url": url,
            "status": response.status_code,
            "ok": response.ok,
            "content_type": response.headers.get("content-type"),
            "error_code": error_code,
            "error_message": error_message,
            "body_type": type(body).__name__ if body is not None else None,
            "count": len(body) if isinstance(body, list) else None,
        }
    except requests.RequestException as exc:
        return {
            "url": url,
            "status": None,
            "ok": False,
            "error": str(exc),
        }


def discover(base_url: str, username: str | None, app_password: str | None, timeout: int) -> dict[str, Any]:
    base_url = normalize_url(base_url)
    session = requests.Session()
    session.headers.update({"User-Agent": "HCAI-WordPress-Migration-Discovery/1.0"})

    root_candidates = [
        base_url + "/wp-json/",
        base_url + "/?rest_route=/",
    ]
    root_response: requests.Response | None = None
    root_body: dict[str, Any] = {}
    root_url = root_candidates[0]
    root_attempts: list[dict[str, Any]] = []

    for candidate in root_candidates:
        try:
            response = session.get(candidate, timeout=timeout, allow_redirects=True)
            body = safe_json(response)
            attempt = {
                "url": candidate,
                "final_url": response.url,
                "status": response.status_code,
                "content_type": response.headers.get("content-type"),
                "json_object": isinstance(body, dict),
                "has_routes": bool(isinstance(body, dict) and isinstance(body.get("routes"), dict)),
            }
            root_attempts.append(attempt)
            if isinstance(body, dict) and (isinstance(body.get("routes"), dict) or isinstance(body.get("namespaces"), list)):
                root_response = response
                root_body = body
                root_url = candidate
                break
            if root_response is None:
                root_response = response
                root_url = candidate
        except requests.RequestException as exc:
            root_attempts.append({"url": candidate, "status": None, "error": str(exc)})

    if not root_body:
        return {
            "base_url": base_url,
            "rest_root": root_url,
            "rest_root_attempts": root_attempts,
            "rest_status": root_response.status_code if root_response is not None else None,
            "rest_available": False,
            "error": "No WordPress REST index was returned as a JSON object with routes or namespaces.",
            "recommendation": "Continue the local build, then use authenticated Playwright dashboard discovery. Also retry this probe from the user's network.",
            "notes": [
                "This script performs GET requests only and does not modify WordPress.",
                "A proxy, VPN, unpublished/private site, or network restriction can prevent public REST discovery even when WordPress admin access works.",
            ],
        }
    routes = root_body.get("routes", {}) if isinstance(root_body.get("routes"), dict) else {}
    namespaces = root_body.get("namespaces", []) if isinstance(root_body.get("namespaces"), list) else []
    authentication = root_body.get("authentication", {}) if isinstance(root_body.get("authentication"), dict) else {}
    app_auth = authentication.get("application-passwords", {}) if isinstance(authentication.get("application-passwords"), dict) else {}
    endpoints = app_auth.get("endpoints", {}) if isinstance(app_auth.get("endpoints"), dict) else {}
    authorization_endpoint = endpoints.get("authorization")

    auth = HTTPBasicAuth(username, app_password) if username and app_password else None
    probes = {
        name: probe(session, base_url, path, auth if name not in {"pages", "media"} else auth, timeout)
        for name, path in ROUTE_PROBES.items()
    }

    route_presence = {
        "pages": "/wp/v2/pages" in routes,
        "media": "/wp/v2/media" in routes,
        "settings": "/wp/v2/settings" in routes,
        "plugins": "/wp/v2/plugins" in routes,
        "themes": "/wp/v2/themes" in routes,
        "navigation": "/wp/v2/navigation" in routes,
        "menus": "/wp/v2/menus" in routes,
        "menu_items": "/wp/v2/menu-items" in routes,
        "menu_locations": "/wp/v2/menu-locations" in routes,
    }

    authenticated = bool(auth and probes["current_user"].get("status") == 200)
    can_read_settings = bool(authenticated and probes["settings"].get("status") == 200)
    can_read_plugins = bool(authenticated and probes["plugins"].get("status") == 200)
    can_read_themes = bool(authenticated and probes["themes"].get("status") == 200)
    likely_rest_write = bool(authenticated and route_presence["pages"] and route_presence["media"])

    if likely_rest_write:
        recommendation = "Use REST sync after a dry run. Keep migrated pages as drafts for staging review."
    elif authorization_endpoint and not auth:
        recommendation = "Application Passwords appear available. Create one in the WordPress user profile, set WP_USER and WP_APP_PASSWORD, then rerun discovery."
    else:
        recommendation = "Use the generated WXR package and Playwright admin discovery/import fallback."

    return {
        "base_url": base_url,
        "rest_root": root_url,
        "rest_status": root_response.status_code if root_response is not None else None,
        "rest_available": bool(root_response is not None and root_response.ok and root_body),
        "rest_root_attempts": root_attempts,
        "site_name": root_body.get("name"),
        "site_description": root_body.get("description"),
        "site_home": root_body.get("home"),
        "namespaces": namespaces,
        "route_count": len(routes),
        "route_presence": route_presence,
        "authentication": {
            "application_passwords_advertised": bool(authorization_endpoint),
            "authorization_endpoint": authorization_endpoint,
            "credentials_supplied": bool(auth),
            "authenticated": authenticated,
        },
        "capabilities": {
            "likely_page_media_rest_write": likely_rest_write,
            "can_read_settings": can_read_settings,
            "can_read_plugins": can_read_plugins,
            "can_read_themes": can_read_themes,
            "navigation_api_present": any(
                route_presence[key] for key in ["navigation", "menus", "menu_items", "menu_locations"]
            ),
            "importer_discoverable_via_rest": False,
        },
        "probes": probes,
        "recommendation": recommendation,
        "notes": [
            "This script performs GET requests only and does not modify WordPress.",
            "Import tools and the exact official GT theme must be discovered through the authenticated dashboard if they are not exposed through REST.",
            "A 401/403 on settings/plugins/themes may reflect capability restrictions rather than a missing route.",
        ],
    }


def render_markdown(result: dict[str, Any]) -> str:
    auth = result.get("authentication", {})
    capabilities = result.get("capabilities", {})
    lines = [
        "# WordPress Capability Discovery",
        "",
        f"Target: `{result.get('base_url')}`",
        "",
        f"- REST available: **{result.get('rest_available')}**",
        f"- REST route count: {result.get('route_count', 0)}",
        f"- Application Passwords advertised: **{auth.get('application_passwords_advertised')}**",
        f"- Credentials supplied: **{auth.get('credentials_supplied')}**",
        f"- Authenticated as current user: **{auth.get('authenticated')}**",
        f"- Likely REST page/media writes: **{capabilities.get('likely_page_media_rest_write')}**",
        f"- Can read settings: **{capabilities.get('can_read_settings')}**",
        f"- Can read plugins: **{capabilities.get('can_read_plugins')}**",
        f"- Can read themes: **{capabilities.get('can_read_themes')}**",
        f"- Navigation API present: **{capabilities.get('navigation_api_present')}**",
        "",
        "## REST root attempts",
        "",
        "| URL | HTTP status | JSON routes | Result |",
        "|---|---:|---|---|",
    ]
    for attempt in result.get("rest_root_attempts", []):
        attempt_result = attempt.get("error") or attempt.get("final_url") or "No usable REST index"
        lines.append(
            f"| `{attempt.get('url')}` | {attempt.get('status') if attempt.get('status') is not None else '—'} | "
            f"{attempt.get('has_routes', False)} | {attempt_result} |"
        )
    lines.extend([
        "",
        "## Recommendation",
        "",
        str(result.get("recommendation", "")),
        "",
        "## Route probes",
        "",
        "| Probe | HTTP status | Result |",
        "|---|---:|---|",
    ])
    for name, details in result.get("probes", {}).items():
        status = details.get("status")
        result_text = "OK" if details.get("ok") else details.get("error_code") or details.get("error") or "Unavailable"
        lines.append(f"| {name} | {status if status is not None else '—'} | {result_text} |")
    lines.extend(["", "## Next discovery step", ""])
    if auth.get("application_passwords_advertised") and not auth.get("authenticated"):
        lines.append("Create a WordPress Application Password from the user's WordPress profile, set `WP_USER` and `WP_APP_PASSWORD`, and rerun this script.")
    elif capabilities.get("likely_page_media_rest_write"):
        lines.append("Run `scripts/sync_wordpress.py --dry-run` after building the migration package.")
    else:
        lines.append("Run `browser/discover-admin.mjs` after completing SSO/Duo to inventory the exact GT theme, plugins, and import tools.")
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Discover Sites@GT WordPress capabilities without mutation.")
    parser.add_argument("--url", default=None)
    parser.add_argument("--username", default=None)
    parser.add_argument("--app-password", default=None)
    parser.add_argument("--build-dir", type=Path, default=DEFAULT_BUILD_DIR)
    parser.add_argument("--timeout", type=int, default=20)
    args = parser.parse_args()

    load_dotenv()
    url = (args.url or os.getenv("WP_URL") or "").strip()
    if not url:
        parser.error("Set --url or WP_URL")
    username = (args.username or os.getenv("WP_USER") or "").strip() or None
    app_password = (args.app_password or os.getenv("WP_APP_PASSWORD") or "").strip() or None
    if app_password and not username:
        parser.error("WP_APP_PASSWORD was supplied without WP_USER")
    if username and not app_password:
        print("NOTE: WP_USER is set without WP_APP_PASSWORD; running unauthenticated discovery.", file=sys.stderr)
        username = None

    build_dir = ensure_build_dir(args.build_dir.resolve())
    result = discover(url, username, app_password, args.timeout)
    write_json(build_dir / "wordpress-capabilities.json", result)
    (build_dir / "wordpress-capabilities.md").write_text(render_markdown(result), encoding="utf-8")
    print(json.dumps(result, indent=2))
    print(f"Wrote {build_dir / 'wordpress-capabilities.json'}")
    print(f"Wrote {build_dir / 'wordpress-capabilities.md'}")
    return 0 if result.get("rest_available") else 2


if __name__ == "__main__":
    raise SystemExit(main())
