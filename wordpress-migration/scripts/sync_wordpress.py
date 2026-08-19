from __future__ import annotations

import argparse
import sys
import json
import mimetypes
import os
from pathlib import Path
from typing import Any, Mapping

import requests
from requests.auth import HTTPBasicAuth

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.common import (
    DEFAULT_BUILD_DIR,
    ensure_build_dir,
    load_config,
    load_dotenv,
    load_manifest,
    normalize_url,
    read_page_content,
    slugify,
    write_json,
)


class WordPressError(RuntimeError):
    pass


class WordPressClient:
    def __init__(self, base_url: str, username: str, app_password: str, timeout: int = 30) -> None:
        self.base_url = normalize_url(base_url)
        self.api_base = self.base_url + "/wp-json/wp/v2"
        self.auth = HTTPBasicAuth(username, app_password)
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "HCAI-WordPress-Migration-Sync/1.0"})

    def request(self, method: str, path: str, *, expected: set[int] | None = None, **kwargs: Any) -> requests.Response:
        url = self.api_base + "/" + path.lstrip("/")
        response = self.session.request(method, url, auth=self.auth, timeout=self.timeout, **kwargs)
        allowed = expected or {200, 201}
        if response.status_code not in allowed:
            try:
                body = response.json()
            except ValueError:
                body = response.text[:500]
            raise WordPressError(f"{method} {url} returned {response.status_code}: {body}")
        return response

    def get_json(self, path: str) -> Any:
        return self.request("GET", path, expected={200}).json()

    def post_json(self, path: str, payload: Mapping[str, Any]) -> Any:
        return self.request("POST", path, json=payload, expected={200, 201}).json()

    def current_user(self) -> Mapping[str, Any]:
        body = self.get_json("users/me?context=edit")
        if not isinstance(body, Mapping):
            raise WordPressError("Unexpected current-user response")
        return body

    def find_page_by_slug(self, slug: str) -> Mapping[str, Any] | None:
        body = self.get_json(f"pages?slug={slug}&context=edit&per_page=10")
        if isinstance(body, list) and body:
            return body[0]
        return None

    def find_media_by_slug(self, slug: str) -> Mapping[str, Any] | None:
        body = self.get_json(f"media?slug={slug}&context=edit&per_page=10")
        if isinstance(body, list) and body:
            return body[0]
        return None

    def upload_media(self, local_path: Path, alt_text: str) -> Mapping[str, Any]:
        mime_type = mimetypes.guess_type(local_path.name)[0] or "application/octet-stream"
        headers = {
            "Content-Disposition": f'attachment; filename="{local_path.name}"',
            "Content-Type": mime_type,
        }
        response = self.request(
            "POST",
            "media",
            data=local_path.read_bytes(),
            headers=headers,
            expected={201},
        )
        media = response.json()
        media_id = int(media["id"])
        if alt_text:
            media = self.post_json(f"media/{media_id}", {"alt_text": alt_text})
        return media


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"pages": {}, "media": {}}
    try:
        body = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"pages": {}, "media": {}}
    if not isinstance(body, dict):
        return {"pages": {}, "media": {}}
    body.setdefault("pages", {})
    body.setdefault("media", {})
    return body


def main() -> int:
    parser = argparse.ArgumentParser(description="Create or update HCAI WordPress pages through the REST API.")
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--build-dir", type=Path, default=DEFAULT_BUILD_DIR)
    parser.add_argument("--config", type=Path, default=None)
    parser.add_argument("--url", default=None)
    parser.add_argument("--username", default=None)
    parser.add_argument("--app-password", default=None)
    parser.add_argument("--status", choices=["draft", "publish", "private", "pending"], default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--set-front-page", action="store_true")
    parser.add_argument("--skip-media", action="store_true")
    parser.add_argument("--skip-settings", action="store_true")
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args()

    load_dotenv()
    base_url = (args.url or os.getenv("WP_URL") or "").strip()
    username = (args.username or os.getenv("WP_USER") or "").strip()
    app_password = args.app_password or os.getenv("WP_APP_PASSWORD") or ""
    if not base_url:
        parser.error("Set --url or WP_URL")
    if not username or not app_password:
        parser.error("Set WP_USER and WP_APP_PASSWORD after Application Password discovery")

    source_root = args.source_root.resolve()
    build_dir = ensure_build_dir(args.build_dir.resolve())
    config = load_config(args.config)
    manifest = load_manifest(build_dir)
    state_path = build_dir / "wp-state.json"
    state = load_state(state_path)
    status = args.status or os.getenv("WP_STATUS") or config["site"].get("default_status", "draft")

    client = WordPressClient(base_url, username, app_password, timeout=args.timeout)
    current_user = client.current_user()
    print(f"Authenticated to {normalize_url(base_url)} as WordPress user ID {current_user.get('id')} ({current_user.get('slug')})")

    actions: list[dict[str, Any]] = []
    media_url_map: dict[str, str] = {}

    if not args.skip_media:
        for media in manifest.get("media", []):
            relative_path = str(media["path"])
            local_path = source_root / relative_path
            if not local_path.exists():
                actions.append({"action": "media-missing", "path": relative_path})
                print(f"WARNING: media source is missing: {local_path}")
                continue

            source_url = str(media["source_url"])
            slug = slugify(local_path.stem)
            known = state["media"].get(relative_path)
            existing: Mapping[str, Any] | None = None
            if known and known.get("id"):
                try:
                    body = client.get_json(f"media/{int(known['id'])}?context=edit")
                    if isinstance(body, Mapping):
                        existing = body
                except WordPressError:
                    existing = None
            if existing is None:
                existing = client.find_media_by_slug(slug)

            if existing:
                target_url = str(existing.get("source_url") or existing.get("guid", {}).get("rendered") or "")
                media_url_map[source_url] = target_url
                state["media"][relative_path] = {"id": existing.get("id"), "source_url": target_url}
                actions.append({"action": "reuse-media", "path": relative_path, "id": existing.get("id"), "target_url": target_url})
                print(f"Reuse media {relative_path} -> ID {existing.get('id')}")
                continue

            actions.append({"action": "create-media", "path": relative_path, "alt_text": media.get("alt_text", "")})
            print(f"Create media {relative_path}")
            if not args.dry_run:
                created = client.upload_media(local_path, str(media.get("alt_text", "")))
                target_url = str(created.get("source_url") or "")
                media_url_map[source_url] = target_url
                state["media"][relative_path] = {"id": created.get("id"), "source_url": target_url}

    page_ids: dict[str, int] = {}
    for page in manifest["pages"]:
        content = read_page_content(build_dir, page)
        for old_url, new_url in media_url_map.items():
            if new_url:
                content = content.replace(old_url, new_url)

        existing = client.find_page_by_slug(str(page["slug"]))
        payload = {
            "title": str(page["title"]),
            "slug": str(page["slug"]),
            "status": status,
            "content": content,
            "menu_order": int(page.get("order", 0)),
            "comment_status": "closed",
            "ping_status": "closed",
        }
        if existing:
            page_id = int(existing["id"])
            page_ids[str(page["key"])] = page_id
            actions.append({"action": "update-page", "key": page["key"], "slug": page["slug"], "id": page_id, "status": status})
            print(f"Update page {page['slug']} -> ID {page_id} ({status})")
            if not args.dry_run:
                updated = client.post_json(f"pages/{page_id}", payload)
                state["pages"][str(page["key"])] = {
                    "id": updated.get("id"),
                    "slug": updated.get("slug"),
                    "link": updated.get("link"),
                    "status": updated.get("status"),
                }
        else:
            actions.append({"action": "create-page", "key": page["key"], "slug": page["slug"], "status": status})
            print(f"Create page {page['slug']} ({status})")
            if not args.dry_run:
                created = client.post_json("pages", payload)
                page_id = int(created["id"])
                page_ids[str(page["key"])] = page_id
                state["pages"][str(page["key"])] = {
                    "id": created.get("id"),
                    "slug": created.get("slug"),
                    "link": created.get("link"),
                    "status": created.get("status"),
                }

    if not args.skip_settings:
        settings_payload: dict[str, Any] = {
            "title": config["site"]["title"],
            "description": config["site"]["description"],
            "timezone": config["site"].get("timezone", "America/New_York"),
        }
        home_page_id = page_ids.get("home") or state["pages"].get("home", {}).get("id")
        if args.set_front_page and home_page_id:
            settings_payload.update({"show_on_front": "page", "page_on_front": int(home_page_id)})
        actions.append({"action": "update-settings", "payload": settings_payload})
        print("Update WordPress site settings" + (" and set static front page" if args.set_front_page and home_page_id else ""))
        if not args.dry_run:
            try:
                client.post_json("settings", settings_payload)
            except WordPressError as exc:
                print(f"WARNING: settings update failed; use Playwright fallback: {exc}")
                actions.append({"action": "settings-failed", "error": str(exc)})

    plan = {
        "target": normalize_url(base_url),
        "dry_run": args.dry_run,
        "status": status,
        "authenticated_user_id": current_user.get("id"),
        "actions": actions,
    }
    write_json(build_dir / "sync-plan.json", plan)
    if not args.dry_run:
        write_json(state_path, state)
        print(f"Wrote {state_path}")
    print(f"Wrote {build_dir / 'sync-plan.json'}")
    print("No content was deleted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
