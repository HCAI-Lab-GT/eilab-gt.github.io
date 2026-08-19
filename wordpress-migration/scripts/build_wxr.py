from __future__ import annotations

import argparse
import sys
import email.utils
import json
import mimetypes
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.common import (
    DEFAULT_BUILD_DIR,
    cdata,
    ensure_build_dir,
    html_escape,
    load_config,
    load_dotenv,
    load_manifest,
    normalize_url,
    read_page_content,
    utc_now,
)


def xml_text(value: Any) -> str:
    return html_escape(value)


def wp_item_page(
    *,
    page: Mapping[str, Any],
    content: str,
    post_id: int,
    base_url: str,
    author_login: str,
    post_date: datetime,
    status_override: str | None,
) -> str:
    slug = str(page["slug"])
    status = status_override or str(page.get("status", "draft"))
    link = base_url + ("/" if page["key"] == "home" else f"/{slug}/")
    date_local = post_date.strftime("%Y-%m-%d %H:%M:%S")
    date_gmt = post_date.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    pub_date = email.utils.format_datetime(post_date.astimezone(timezone.utc))
    excerpt = f"Migrated page: {page['title']}"
    return f"""
    <item>
      <title>{cdata(str(page['title']))}</title>
      <link>{xml_text(link)}</link>
      <pubDate>{xml_text(pub_date)}</pubDate>
      <dc:creator>{cdata(author_login)}</dc:creator>
      <guid isPermaLink="false">{xml_text(base_url + '/?page_id=' + str(post_id))}</guid>
      <description></description>
      <content:encoded>{cdata(content)}</content:encoded>
      <excerpt:encoded>{cdata(excerpt)}</excerpt:encoded>
      <wp:post_id>{post_id}</wp:post_id>
      <wp:post_date>{cdata(date_local)}</wp:post_date>
      <wp:post_date_gmt>{cdata(date_gmt)}</wp:post_date_gmt>
      <wp:post_modified>{cdata(date_local)}</wp:post_modified>
      <wp:post_modified_gmt>{cdata(date_gmt)}</wp:post_modified_gmt>
      <wp:comment_status>closed</wp:comment_status>
      <wp:ping_status>closed</wp:ping_status>
      <wp:post_name>{cdata(slug)}</wp:post_name>
      <wp:status>{cdata(status)}</wp:status>
      <wp:post_parent>0</wp:post_parent>
      <wp:menu_order>{int(page.get('order', 0))}</wp:menu_order>
      <wp:post_type>page</wp:post_type>
      <wp:post_password></wp:post_password>
      <wp:is_sticky>0</wp:is_sticky>
      <wp:postmeta>
        <wp:meta_key>{cdata('_wp_page_template')}</wp:meta_key>
        <wp:meta_value>{cdata('default')}</wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>{cdata('_hcai_migration_key')}</wp:meta_key>
        <wp:meta_value>{cdata(str(page['key']))}</wp:meta_value>
      </wp:postmeta>
    </item>""".rstrip()


def wp_item_attachment(
    *,
    media: Mapping[str, Any],
    post_id: int,
    base_url: str,
    author_login: str,
    post_date: datetime,
) -> str:
    source_url = str(media["source_url"])
    filename = Path(str(media["path"])).name
    stem = Path(filename).stem.replace("-", " ").replace("_", " ").title()
    mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    date_local = post_date.strftime("%Y-%m-%d %H:%M:%S")
    date_gmt = post_date.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    pub_date = email.utils.format_datetime(post_date.astimezone(timezone.utc))
    return f"""
    <item>
      <title>{cdata(stem)}</title>
      <link>{xml_text(base_url + '/?attachment_id=' + str(post_id))}</link>
      <pubDate>{xml_text(pub_date)}</pubDate>
      <dc:creator>{cdata(author_login)}</dc:creator>
      <guid isPermaLink="false">{xml_text(source_url)}</guid>
      <description></description>
      <content:encoded>{cdata('')}</content:encoded>
      <excerpt:encoded>{cdata(str(media.get('alt_text', '')))}</excerpt:encoded>
      <wp:post_id>{post_id}</wp:post_id>
      <wp:post_date>{cdata(date_local)}</wp:post_date>
      <wp:post_date_gmt>{cdata(date_gmt)}</wp:post_date_gmt>
      <wp:post_modified>{cdata(date_local)}</wp:post_modified>
      <wp:post_modified_gmt>{cdata(date_gmt)}</wp:post_modified_gmt>
      <wp:comment_status>open</wp:comment_status>
      <wp:ping_status>closed</wp:ping_status>
      <wp:post_name>{cdata(Path(filename).stem)}</wp:post_name>
      <wp:status>inherit</wp:status>
      <wp:post_parent>0</wp:post_parent>
      <wp:menu_order>0</wp:menu_order>
      <wp:post_type>attachment</wp:post_type>
      <wp:post_password></wp:post_password>
      <wp:is_sticky>0</wp:is_sticky>
      <wp:attachment_url>{cdata(source_url)}</wp:attachment_url>
      <wp:postmeta>
        <wp:meta_key>{cdata('_wp_attached_file')}</wp:meta_key>
        <wp:meta_value>{cdata(filename)}</wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>{cdata('_wp_attachment_image_alt')}</wp:meta_key>
        <wp:meta_value>{cdata(str(media.get('alt_text', '')))}</wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>{cdata('_hcai_original_mime_type')}</wp:meta_key>
        <wp:meta_value>{cdata(mime_type)}</wp:meta_value>
      </wp:postmeta>
    </item>""".rstrip()


def build_wxr(
    build_dir: Path,
    config: Mapping[str, Any],
    output_path: Path,
    target_url: str,
    status_override: str | None = None,
) -> None:
    manifest = load_manifest(build_dir)
    target_url = normalize_url(target_url)
    author_login = str(config["site"].get("author_login", "admin"))
    generated = utc_now()

    page_items: list[str] = []
    for index, page in enumerate(manifest["pages"], start=1001):
        content = read_page_content(build_dir, page)
        page_items.append(
            wp_item_page(
                page=page,
                content=content,
                post_id=index,
                base_url=target_url,
                author_login=author_login,
                post_date=generated,
                status_override=status_override,
            )
        )

    attachment_items: list[str] = []
    skip_attachments = bool(config.get("migration", {}).get("skip_wxr_attachments", False))
    if not skip_attachments:
        for index, media in enumerate(manifest.get("media", []), start=9001):
            attachment_items.append(
                wp_item_attachment(
                    media=media,
                    post_id=index,
                    base_url=target_url,
                    author_login=author_login,
                    post_date=generated,
                )
            )

    title = str(config["site"]["title"])
    description = str(config["site"]["description"])
    pub_date = email.utils.format_datetime(generated.astimezone(timezone.utc))
    items = "\n".join(page_items + attachment_items)
    xml = f"""<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:wfw="http://wellformedweb.org/CommentAPI/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>{cdata(title)}</title>
    <link>{xml_text(target_url)}</link>
    <description>{cdata(description)}</description>
    <pubDate>{xml_text(pub_date)}</pubDate>
    <language>en-US</language>
    <wp:wxr_version>1.2</wp:wxr_version>
    <wp:base_site_url>{cdata(target_url)}</wp:base_site_url>
    <wp:base_blog_url>{cdata(target_url)}</wp:base_blog_url>
    <wp:author>
      <wp:author_id>1</wp:author_id>
      <wp:author_login>{cdata(author_login)}</wp:author_login>
      <wp:author_email>{cdata('')}</wp:author_email>
      <wp:author_display_name>{cdata(author_login)}</wp:author_display_name>
      <wp:author_first_name>{cdata('')}</wp:author_first_name>
      <wp:author_last_name>{cdata('')}</wp:author_last_name>
    </wp:author>
{items}
  </channel>
</rss>
"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(xml, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate a WordPress WXR import package.")
    parser.add_argument("--build-dir", type=Path, default=DEFAULT_BUILD_DIR)
    parser.add_argument("--config", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--target-url", default=None)
    parser.add_argument("--status", choices=["draft", "publish", "private", "pending"], default=None)
    args = parser.parse_args()

    load_dotenv()
    build_dir = ensure_build_dir(args.build_dir.resolve())
    config = load_config(args.config)
    target_url = (
        args.target_url
        or os.getenv("WP_URL")
        or config["site"].get("staging_url")
        or "https://sites.gatech.edu/hcailab"
    )
    output_path = args.output.resolve() if args.output else build_dir / "hcai-lab.wordpress.xml"
    build_wxr(build_dir, config, output_path, str(target_url), args.status)
    print(f"Wrote {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
