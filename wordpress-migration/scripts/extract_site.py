from __future__ import annotations

import argparse
import sys
import json
import re
from pathlib import Path
from typing import Any, Iterable, Mapping

from bs4 import BeautifulSoup

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.common import (
    DEFAULT_BUILD_DIR,
    ci_get,
    ensure_build_dir,
    find_first,
    load_config,
    load_yaml,
    markdown_to_html,
    rewrite_internal_urls,
    sanitize_html,
    sanitize_markdown,
    slugify,
    split_front_matter,
    text_content,
    utc_now,
    write_json,
)

PEOPLE_FILES: dict[str, list[str]] = {
    "faculty": ["_data/faculty.yaml", "_data/faculty.yml"],
    "phds": ["_data/phds.yaml", "_data/phds.yml"],
    "masters": ["_data/masters.yaml", "_data/masters.yml"],
    "undergrads": ["_data/undergrads.yaml", "_data/undergrads.yml"],
    "affiliated": ["_data/affiliated.yaml", "_data/affiliated.yml"],
    "alumni": ["_data/alumni.yaml", "_data/alumni.yml"],
}


def normalize_person(raw: Mapping[str, Any]) -> dict[str, Any]:
    name = str(ci_get(raw, "name", default="")).strip()
    website = ci_get(raw, "website", "url")
    if website in {None, "", "None", "none"}:
        website = None
    return {
        "name": name,
        "website": str(website).strip() if website else None,
        "rank": str(ci_get(raw, "rank", default="")).strip() or None,
        "where": str(ci_get(raw, "where", default="")).strip() or None,
    }


def normalize_author(raw: Any) -> str:
    if isinstance(raw, str):
        return raw.strip()
    if not isinstance(raw, Mapping):
        return ""
    parts = [
        str(ci_get(raw, "first", default="")).strip(),
        str(ci_get(raw, "middle", default="")).strip(),
        str(ci_get(raw, "last", default="")).strip(),
    ]
    return " ".join(part for part in parts if part)


def normalize_publication(raw: Mapping[str, Any]) -> dict[str, Any]:
    title = ci_get(raw, "title", default="")
    year = ci_get(raw, "year", default="")
    authors_raw = ci_get(raw, "author", "authors", default=[])
    if isinstance(authors_raw, Mapping):
        authors_raw = [authors_raw]
    if not isinstance(authors_raw, list):
        authors_raw = []
    authors = [name for name in (normalize_author(item) for item in authors_raw) if name]
    venue = ci_get(raw, "journal", "booktitle", "venue", default="")
    publication_id = str(ci_get(raw, "id", default="")).strip()
    return {
        "id": publication_id,
        "type": str(ci_get(raw, "type", default="")).strip() or None,
        "title": str(title).strip(),
        "year": str(year).strip(),
        "authors": authors,
        "venue": str(venue).strip() if venue else None,
        "journal": str(ci_get(raw, "journal", default="")).strip() or None,
        "booktitle": str(ci_get(raw, "booktitle", default="")).strip() or None,
        "volume": str(ci_get(raw, "volume", default="")).strip() or None,
        "pages": str(ci_get(raw, "pages", default="")).strip() or None,
        "month": str(ci_get(raw, "month", default="")).strip() or None,
        "publisher": str(ci_get(raw, "publisher", default="")).strip() or None,
        "url": str(ci_get(raw, "url", default="")).strip() or None,
        "bibtex": str(ci_get(raw, "bibtex", default="")).strip() or None,
    }


def year_sort_key(value: str) -> tuple[int, str]:
    match = re.search(r"\d{4}", value or "")
    return (int(match.group(0)) if match else -1, value or "")


def extract_home(source_root: Path, source_url: str) -> dict[str, Any]:
    home_path = find_first(source_root, ["index.md", "index.markdown"])
    raw_text = home_path.read_text(encoding="utf-8", errors="replace")
    front_matter, body = split_front_matter(raw_text)

    # Prefer the substantive index.md if the first candidate happened to be empty.
    if not body.strip() and (source_root / "index.md").exists() and home_path.name != "index.md":
        home_path = source_root / "index.md"
        front_matter, body = split_front_matter(home_path.read_text(encoding="utf-8", errors="replace"))

    table_match = re.search(r"<table\b.*?</table>", body, flags=re.I | re.S)
    table_html = table_match.group(0) if table_match else ""
    body_without_table = body.replace(table_html, "") if table_html else body
    mission = sanitize_html(markdown_to_html(body_without_table.strip()))
    mission = rewrite_internal_urls(mission, source_url)

    research_areas: list[dict[str, Any]] = []
    if table_html:
        soup = BeautifulSoup(table_html, "html.parser")
        current_titles: list[str] = []
        buckets: dict[str, list[dict[str, Any]]] = {}
        title_order: list[str] = []
        for row in soup.find_all("tr"):
            headers = [cell.get_text(" ", strip=True) for cell in row.find_all("th")]
            if headers:
                current_titles = headers
                for title in headers:
                    if title and title not in buckets:
                        buckets[title] = []
                        title_order.append(title)
                continue
            cells = row.find_all("td")
            for index, cell in enumerate(cells):
                if index >= len(current_titles):
                    continue
                label = cell.get_text(" ", strip=True)
                if not label:
                    continue
                link = cell.find("a")
                href = link.get("href") if link else None
                if href:
                    href_html = rewrite_internal_urls(f'<a href="{href}">x</a>', source_url)
                    href_soup = BeautifulSoup(href_html, "html.parser")
                    href = href_soup.a.get("href") if href_soup.a else href
                buckets[current_titles[index]].append({"label": label, "url": href})
        research_areas = [
            {"name": title, "slug": slugify(title), "items": buckets[title]}
            for title in title_order
        ]

    author = front_matter.get("author") if isinstance(front_matter.get("author"), dict) else {}
    links = author.get("links") if isinstance(author.get("links"), list) else []
    director_links: list[dict[str, str]] = []
    for item in links:
        if isinstance(item, Mapping):
            label = str(item.get("label", "")).strip()
            url = str(item.get("url", "")).strip()
            if label and url:
                director_links.append({"label": label, "url": url})

    return {
        "source_path": str(home_path.relative_to(source_root)),
        "front_matter": front_matter,
        "mission_html": mission,
        "research_areas": research_areas,
        "hero_image": ci_get(front_matter.get("header", {}) if isinstance(front_matter.get("header"), Mapping) else {}, "overlay_image"),
        "director": {
            "name": str(author.get("name", "Mark Riedl")).strip(),
            "bio_html": sanitize_markdown(str(author.get("bio", ""))),
            "avatar": author.get("avatar"),
            "links": director_links,
        },
    }


def extract_people(source_root: Path) -> dict[str, list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for group, candidates in PEOPLE_FILES.items():
        path = find_first(source_root, candidates)
        raw = load_yaml(path) or {}
        members = raw.get("members", []) if isinstance(raw, Mapping) else []
        if not isinstance(members, list):
            raise ValueError(f"Expected members list in {path}")
        normalized = [normalize_person(item) for item in members if isinstance(item, Mapping)]
        groups[group] = [person for person in normalized if person["name"]]
    return groups


def extract_publications(source_root: Path) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    path = find_first(source_root, ["_data/pubs.yml", "_data/pubs.yaml"])
    raw = load_yaml(path) or {}
    entries = raw.get("entries", []) if isinstance(raw, Mapping) else []
    if not isinstance(entries, list):
        raise ValueError(f"Expected entries list in {path}")
    publications = [normalize_publication(item) for item in entries if isinstance(item, Mapping)]
    publications = [item for item in publications if item["id"] or item["title"]]
    publications.sort(key=lambda item: (year_sort_key(item["year"]), item["title"].lower()), reverse=True)
    by_id = {item["id"]: item for item in publications if item["id"]}
    return publications, by_id


def extract_projects(source_root: Path, publications_by_id: Mapping[str, dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    path = find_first(source_root, ["_data/projects.yml", "_data/projects.yaml"])
    raw = load_yaml(path) or []
    if not isinstance(raw, list):
        raise ValueError(f"Expected projects list in {path}")

    projects: list[dict[str, Any]] = []
    unresolved: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, Mapping):
            continue
        name = str(ci_get(item, "name", default="")).strip()
        if not name:
            continue
        pubs_raw = ci_get(item, "pubs", default=[])
        if not isinstance(pubs_raw, list):
            pubs_raw = []
        representative: list[dict[str, Any]] = []
        for reference in pubs_raw:
            if not isinstance(reference, Mapping):
                continue
            pub_id = str(ci_get(reference, "id", default="")).strip()
            context = str(ci_get(reference, "context", default="")).strip() or None
            publication = publications_by_id.get(pub_id)
            if publication is None:
                unresolved.append({"project": name, "publication_id": pub_id})
                representative.append({"id": pub_id, "context_html": sanitize_markdown(context), "publication": None})
            else:
                representative.append(
                    {
                        "id": pub_id,
                        "context_html": sanitize_markdown(context),
                        "publication": publication,
                    }
                )
        projects.append(
            {
                "name": name,
                "slug": slugify(name),
                "description_html": sanitize_markdown(str(ci_get(item, "description", default=""))),
                "representative_publications": representative,
            }
        )
    return projects, unresolved


def extract_theses(source_root: Path) -> list[dict[str, Any]]:
    path = find_first(source_root, ["_data/theses.yml", "_data/theses.yaml"])
    raw = load_yaml(path) or []
    if not isinstance(raw, list):
        raise ValueError(f"Expected theses list in {path}")
    theses: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, Mapping):
            continue
        theses.append(
            {
                "name": str(ci_get(item, "name", default="")).strip(),
                "title": str(ci_get(item, "title", default="")).strip(),
                "url": str(ci_get(item, "url", default="")).strip() or None,
                "institute": str(ci_get(item, "institute", default="")).strip() or None,
                "year": str(ci_get(item, "year", default="")).strip(),
                "abstract_html": sanitize_markdown(str(ci_get(item, "abstract", default=""))),
            }
        )
    theses.sort(key=lambda item: year_sort_key(item["year"]), reverse=True)
    return theses


def extract_mark_page(source_root: Path, source_url: str) -> dict[str, Any]:
    path = find_first(source_root, ["mark-riedl.md", "mark-riedl.markdown"])
    front_matter, body = split_front_matter(path.read_text(encoding="utf-8", errors="replace"))
    html_body = sanitize_html(markdown_to_html(body))
    html_body = rewrite_internal_urls(html_body, source_url)
    sidebar = front_matter.get("sidebar") if isinstance(front_matter.get("sidebar"), list) else []
    sanitized_sidebar: list[dict[str, str]] = []
    for item in sidebar:
        if not isinstance(item, Mapping):
            continue
        if "title" in item:
            sanitized_sidebar.append({"type": "title", "html": sanitize_html(str(item["title"]))})
        if "text" in item:
            sanitized_sidebar.append({"type": "text", "html": sanitize_html(str(item["text"]))})
        if "image" in item:
            sanitized_sidebar.append({"type": "image", "path": str(item["image"]).lstrip("/")})
    return {
        "source_path": str(path.relative_to(source_root)),
        "title": str(front_matter.get("title", "Mark Riedl")),
        "body_html": html_body,
        "sidebar": sanitized_sidebar,
        "plain_text": text_content(html_body),
    }


def extract_site(source_root: Path, config: Mapping[str, Any]) -> dict[str, Any]:
    source_url = str(config["site"]["source_url"])
    people = extract_people(source_root)
    publications, publication_by_id = extract_publications(source_root)
    projects, unresolved = extract_projects(source_root, publication_by_id)
    theses = extract_theses(source_root)
    home = extract_home(source_root, source_url)
    mark_page = extract_mark_page(source_root, source_url)

    media: list[dict[str, Any]] = []
    for item in config.get("media", {}).get("include", []):
        path = source_root / item["path"]
        media.append(
            {
                "path": item["path"],
                "exists": path.exists(),
                "alt_text": item.get("alt_text", ""),
                "role": item.get("role", "content"),
                "source_url": source_url.rstrip("/") + "/" + item["path"].lstrip("/"),
            }
        )

    counts = {
        "people": {group: len(items) for group, items in people.items()},
        "projects": len(projects),
        "publications": len(publications),
        "theses": len(theses),
        "media_candidates": len(media),
        "unresolved_project_publications": len(unresolved),
    }

    return {
        "schema_version": 1,
        "generated_at": utc_now().isoformat(),
        "source_root": str(source_root),
        "site": config["site"],
        "home": home,
        "people": people,
        "projects": projects,
        "publications": publications,
        "theses": theses,
        "mark_riedl": mark_page,
        "media": media,
        "static_microsites": config.get("static_microsites", []),
        "unresolved_project_publications": unresolved,
        "counts": counts,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract and normalize the HCAI Jekyll source site.")
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--build-dir", type=Path, default=DEFAULT_BUILD_DIR)
    parser.add_argument("--config", type=Path, default=None)
    args = parser.parse_args()

    source_root = args.source_root.resolve()
    if not source_root.exists():
        parser.error(f"Source root does not exist: {source_root}")
    build_dir = ensure_build_dir(args.build_dir.resolve())
    config = load_config(args.config)
    normalized = extract_site(source_root, config)
    write_json(build_dir / "normalized-site.json", normalized)
    print(json.dumps(normalized["counts"], indent=2))
    print(f"Wrote {build_dir / 'normalized-site.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
