from __future__ import annotations

import argparse
import sys
import html
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable, Mapping
from urllib.parse import urlparse

from bs4 import BeautifulSoup

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.common import (
    DEFAULT_BUILD_DIR,
    ensure_build_dir,
    html_escape,
    load_config,
    rewrite_internal_urls,
    rewrite_legacy_hrefs_in_html,
    rewrite_legacy_site_url,
    sanitize_html,
    slugify,
    text_content,
    utc_now,
    write_csv,
    write_json,
)


def wp_paragraph(inner_html: str, css_class: str | None = None) -> str:
    attr = f' {{"className":"{css_class}"}}' if css_class else ""
    cls = f' class="{html_escape(css_class)}"' if css_class else ""
    return f"<!-- wp:paragraph{attr} -->\n<p{cls}>{inner_html}</p>\n<!-- /wp:paragraph -->"


def wp_heading(text: str, level: int = 2, anchor: str | None = None) -> str:
    attrs: dict[str, Any] = {"level": level}
    if anchor:
        attrs["anchor"] = anchor
    attr_json = json.dumps(attrs, separators=(",", ":"))
    anchor_attr = f' id="{html_escape(anchor)}"' if anchor else ""
    return f"<!-- wp:heading {attr_json} -->\n<h{level}{anchor_attr}>{html_escape(text)}</h{level}>\n<!-- /wp:heading -->"


def wp_list(items: Iterable[str], ordered: bool = False) -> str:
    tag = "ol" if ordered else "ul"
    block = "list"
    attr = ' {"ordered":true}' if ordered else ""
    body = "\n".join(f"<li>{item}</li>" for item in items)
    return f"<!-- wp:{block}{attr} -->\n<{tag}>\n{body}\n</{tag}>\n<!-- /wp:{block} -->"


def wp_group(inner: str, css_class: str | None = None) -> str:
    attrs = {"className": css_class} if css_class else {}
    attr = " " + json.dumps(attrs, separators=(",", ":")) if attrs else ""
    cls = f' class="wp-block-group {html_escape(css_class)}"' if css_class else ' class="wp-block-group"'
    return (
        f"<!-- wp:group{attr} -->\n"
        f"<div{cls}>\n<div class=\"wp-block-group__inner-container\">\n{inner}\n</div>\n</div>\n"
        "<!-- /wp:group -->"
    )


def wp_table(table_html: str) -> str:
    soup = BeautifulSoup(table_html, "html.parser")
    table = soup.find("table")
    markup = str(table) if table else table_html
    return f'<!-- wp:table -->\n<figure class="wp-block-table">{markup}</figure>\n<!-- /wp:table -->'


def wp_image(url: str, alt_text: str, css_class: str = "") -> str:
    cls_attr = f" {html_escape(css_class)}" if css_class else ""
    return (
        '<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->\n'
        f'<figure class="wp-block-image size-large{cls_attr}"><img src="{html_escape(url)}" alt="{html_escape(alt_text)}" loading="lazy"/></figure>\n'
        '<!-- /wp:image -->'
    )


def clean_fragment(value: str) -> str:
    return sanitize_html(value).strip()


def site_path_prefix(config: Mapping[str, Any]) -> str:
    staging = str(config.get("site", {}).get("staging_url") or "")
    return urlparse(staging).path.rstrip("/")


def with_site_prefix(url: str | None, prefix: str) -> str | None:
    if not url:
        return url
    rewritten = rewrite_legacy_site_url(url) or url
    if prefix and rewritten.startswith("/") and not rewritten.startswith("//") and not rewritten.startswith(prefix + "/") and rewritten != prefix:
        return prefix + rewritten
    return rewritten


def prefix_internal_urls(content: str, prefix: str) -> str:
    if not content or not prefix:
        return content
    soup = BeautifulSoup(content, "html.parser")
    for tag in soup.find_all(["a", "img"]):
        attr = "href" if tag.name == "a" else "src"
        raw = tag.get(attr)
        updated = with_site_prefix(raw, prefix)
        if updated:
            tag[attr] = updated
    return str(soup)


def external_link(url: str | None, label: str, prefix: str = "") -> str:
    rewritten = with_site_prefix(url, prefix) if url else None
    if not rewritten:
        return html_escape(label)
    return f'<a href="{html_escape(rewritten)}">{html_escape(label)}</a>'


def format_author_list(authors: Iterable[str]) -> str:
    names = [str(author).strip() for author in authors if str(author).strip()]
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return ", ".join(names[:-1]) + ", and " + names[-1]


def publication_link_label(url: str) -> str:
    lowered = url.lower()
    if "arxiv" in lowered:
        return "arXiv"
    if "openreview" in lowered:
        return "OpenReview"
    if "ssrn" in lowered:
        return "SSRN"
    if "zenodo" in lowered:
        return "zenodo"
    if "dl.acm.org" in lowered:
        return "ACM/DL"
    if "ieee" in lowered:
        return "IEEE"
    if ".pdf" in lowered:
        return "PDF"
    return "Link"


def publication_kind_labels(publication: Mapping[str, Any]) -> list[str]:
    journal = str(publication.get("journal") or "").strip()
    booktitle = str(publication.get("booktitle") or "").strip()
    volume = str(publication.get("volume") or "").strip()
    labels: list[str] = []
    if journal and volume:
        labels.append("Journal")
    if journal and "Findings" in journal:
        labels.append("Conference")
    if booktitle:
        labels.append("Workshop" if "Workshop" in booktitle else "Conference")
    return labels


def publication_html(publication: Mapping[str, Any], include_bibtex: bool = True) -> str:
    authors = format_author_list(publication.get("authors", []))
    title = str(publication.get("title", "")).strip() or "Untitled publication"
    url = str(publication.get("url") or "").strip()
    venue = str(publication.get("journal") or publication.get("booktitle") or publication.get("venue") or "").strip()
    volume = str(publication.get("volume") or "").strip()
    year = str(publication.get("year") or "").strip()
    chunks: list[str] = []
    if authors:
        chunks.append(f'<span class="publication-authors">{html_escape(authors)}</span>')
    chunks.append(f'<strong class="publication-title">{html_escape(title)}</strong>')
    venue_line = venue
    if volume:
        venue_line = f"{venue_line} {volume}".strip()
    if year:
        venue_line = f"{venue_line} ({year})".strip()
    if venue_line:
        chunks.append(f'<span class="publication-venue"><em>{html_escape(venue_line)}</em>.</span>')
    body = "<br>".join(chunks)
    badges: list[str] = []
    if url:
        badges.append(
            f'<a class="publication-source" href="{html_escape(url)}">{html_escape(publication_link_label(url))}</a>'
        )
    for label in publication_kind_labels(publication):
        badges.append(f'<span class="publication-kind">{html_escape(label)}</span>')
    if badges:
        body += "<br>" + " ".join(badges)
    bibtex = publication.get("bibtex")
    if include_bibtex and bibtex:
        body += (
            "\n<details class=\"publication-bibtex\">"
            "<summary>BibTeX</summary>"
            f"<pre><code>{html.escape(str(bibtex))}</code></pre>"
            "</details>"
        )
    return body


def render_home(data: Mapping[str, Any], config: Mapping[str, Any]) -> str:
    home = data["home"]
    source_url = str(config["site"]["source_url"])
    parts: list[str] = []

    media_by_role = {item.get("role"): item for item in data.get("media", [])}
    hero = media_by_role.get("hero")
    if hero:
        parts.append(wp_image(hero["source_url"], hero.get("alt_text", ""), "hcai-hero"))

    if home.get("tagline"):
        parts.append(wp_paragraph(html_escape(str(home["tagline"])), "hcai-tagline"))

    mission_html = rewrite_legacy_hrefs_in_html(
        rewrite_internal_urls(str(home.get("mission_html", "")), source_url)
    )
    if mission_html:
        parts.append(wp_group(mission_html, "hcai-mission"))

    table_html = str(home.get("research_table_html") or "").strip()
    areas = home.get("research_areas", [])
    if table_html:
        parts.append(wp_heading("Research Areas", 2, "research-areas"))
        parts.append(wp_table(table_html))
    elif areas:
        parts.append(wp_heading("Research Areas", 2, "research-areas"))
        for area in areas:
            area_parts = [wp_heading(area["name"], 3, area.get("slug"))]
            items: list[str] = []
            for item in area.get("items", []):
                label = str(item.get("label", ""))
                items.append(external_link(item.get("url"), label, site_path_prefix(config)))
            if items:
                area_parts.append(wp_list(items))
            parts.append(wp_group("\n".join(area_parts), "hcai-research-area"))

    director = home.get("director", {})
    if director:
        parts.append(wp_heading("Director", 2, "director"))
        director_parts: list[str] = []
        profile = media_by_role.get("profile")
        if profile:
            director_parts.append(wp_image(profile["source_url"], profile.get("alt_text", ""), "hcai-director-photo"))
        if director.get("name"):
            director_parts.append(wp_heading(str(director["name"]), 3))
        if director.get("bio_html"):
            director_parts.append(clean_fragment(str(director["bio_html"])))
        link_items = [
            external_link(link.get("url"), link.get("label", ""), site_path_prefix(config))
            for link in director.get("links", [])
        ]
        if link_items:
            director_parts.append(wp_list(link_items))
        parts.append(wp_group("\n".join(director_parts), "hcai-director"))

    return "\n\n".join(parts).strip() + "\n"


def render_people(data: Mapping[str, Any], config: Mapping[str, Any]) -> str:
    groups = data["people"]
    titles = config.get("people_group_titles", {})
    order = config.get("people_group_order", list(groups))
    parts: list[str] = []
    for group in order:
        members = groups.get(group, [])
        if not members:
            continue
        parts.append(wp_heading(str(titles.get(group, group.title())), 2, slugify(str(titles.get(group, group)))))
        items: list[str] = []
        for person in members:
            name_html = external_link(person.get("website"), person.get("name", ""), site_path_prefix(config))
            descriptors = [person.get("rank"), person.get("where")]
            descriptors = [str(value) for value in descriptors if value]
            if descriptors:
                name_html += " — " + html_escape("; ".join(descriptors))
            items.append(name_html)
        parts.append(wp_list(items))
    return "\n\n".join(parts).strip() + "\n"


def render_research(data: Mapping[str, Any], config: Mapping[str, Any]) -> str:
    include_bibtex = bool(config.get("migration", {}).get("include_bibtex_details", True))
    parts: list[str] = []
    toc_items = [
        f'<a href="#{html_escape(str(project["slug"]))}">{html_escape(str(project["name"]))}</a>'
        for project in data["projects"]
        if project.get("slug") and project.get("name")
    ]
    if toc_items:
        parts.append(wp_paragraph(" · ".join(toc_items), "hcai-project-toc"))
    for project in data["projects"]:
        project_parts = [wp_heading(project["name"], 2, project["slug"])]
        if project.get("description_html"):
            project_parts.append(clean_fragment(project["description_html"]))
        reps = project.get("representative_publications", [])
        if reps:
            project_parts.append(wp_heading("Representative Publications", 3))
            items: list[str] = []
            for rep in reps:
                context = text_content(rep.get("context_html"))
                publication = rep.get("publication")
                if publication:
                    entry = publication_html(publication, include_bibtex=include_bibtex)
                    if context:
                        entry = f'<span class="publication-context"><em>{html_escape(context)}</em></span><br>{entry}'
                else:
                    entry = f'<strong>Unresolved publication reference:</strong> {html_escape(rep.get("id", ""))}'
                    if context:
                        entry += f"<br><em>{html_escape(context)}</em>"
                items.append(entry)
            project_parts.append(wp_list(items))
        parts.append(wp_group("\n".join(project_parts), "hcai-project"))
    return "\n\n".join(parts).strip() + "\n"


def render_publications(data: Mapping[str, Any], config: Mapping[str, Any]) -> str:
    include_bibtex = bool(config.get("migration", {}).get("include_bibtex_details", True))
    by_year: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for publication in data["publications"]:
        by_year[str(publication.get("year") or "Undated")].append(publication)

    def year_key(value: str) -> tuple[int, str]:
        match = re.search(r"\d{4}", value)
        return (int(match.group(0)) if match else -1, value)

    years = sorted(by_year, key=year_key, reverse=True)
    parts: list[str] = []
    if years:
        toc = " · ".join(f'<a href="#year-{slugify(year)}">{html_escape(year)}</a>' for year in years)
        parts.append(wp_paragraph(toc, "hcai-year-toc"))
    for year in years:
        parts.append(wp_heading(year, 2, f"year-{slugify(year)}"))
        for pub in by_year[year]:
            parts.append(wp_group(publication_html(pub, include_bibtex=include_bibtex), "hcai-publication"))
    return "\n\n".join(parts).strip() + "\n"


def render_theses(data: Mapping[str, Any], config: Mapping[str, Any]) -> str:
    include_abstracts = bool(config.get("migration", {}).get("include_thesis_abstract_details", True))
    parts: list[str] = []
    for thesis in data["theses"]:
        title = thesis.get("title") or "Untitled thesis"
        title_html = external_link(thesis.get("url"), title, site_path_prefix(config))
        meta = ", ".join(str(item) for item in [thesis.get("institute"), thesis.get("year")] if item)
        entry = f"<strong>{html_escape(thesis.get('name', ''))}. {title_html}.</strong> Ph.D. Dissertation"
        if meta:
            entry += f", {html_escape(meta)}."
        else:
            entry += "."
        if include_abstracts and thesis.get("abstract_html"):
            entry += "\n<details class=\"thesis-abstract\"><summary>Abstract</summary>" + clean_fragment(thesis["abstract_html"]) + "</details>"
        parts.append(wp_group(entry, "hcai-thesis"))
    return "\n\n".join(parts).strip() + "\n"


def render_mark_riedl(data: Mapping[str, Any], config: Mapping[str, Any]) -> str:
    page = data["mark_riedl"]
    parts: list[str] = []
    media_by_role = {item.get("role"): item for item in data.get("media", [])}
    profile = media_by_role.get("profile")
    if profile:
        parts.append(wp_image(profile["source_url"], profile.get("alt_text", ""), "hcai-profile-photo"))
    if page.get("body_html"):
        parts.append(clean_fragment(page["body_html"]))
    sidebar_items = page.get("sidebar", [])
    contact_items: list[str] = []
    for item in sidebar_items:
        if item.get("type") == "text":
            contact_items.append(clean_fragment(item.get("html", "")))
    if contact_items:
        parts.append(wp_heading("Contact and Affiliations", 2, "contact"))
        parts.append(wp_list(contact_items))
    return "\n\n".join(parts).strip() + "\n"


def build_redirect_rows(config: Mapping[str, Any]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for key, page in config["pages"].items():
        slug = page["slug"]
        target = "/" if key == "home" else f"/{slug}/"
        for old_path in page.get("old_paths", []):
            rows.append(
                {
                    "source_path": old_path,
                    "target_path": target,
                    "status_code": "301",
                    "notes": f"Core page: {page['title']}",
                }
            )
    for microsite in config.get("static_microsites", []):
        for alias in microsite.get("aliases", []):
            rows.append(
                {
                    "source_path": alias,
                    "target_path": microsite["public_path"],
                    "status_code": "301",
                    "notes": "Static microsite alias; hosting decision still required",
                }
            )
    # Deduplicate exact source paths while preserving order.
    deduped: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        if row["source_path"] in seen:
            continue
        seen.add(row["source_path"])
        deduped.append(row)
    return deduped


def render_all(data: Mapping[str, Any], config: Mapping[str, Any], build_dir: Path) -> dict[str, Any]:
    pages_dir = build_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)

    renderers = {
        "home": render_home,
        "people": render_people,
        "research": render_research,
        "publications": render_publications,
        "theses": render_theses,
        "mark_riedl": render_mark_riedl,
    }

    manifest_pages: list[dict[str, Any]] = []
    for key, renderer in renderers.items():
        page_config = config["pages"][key]
        content = prefix_internal_urls(renderer(data, config), site_path_prefix(config))
        # Final defense-in-depth sanitization. Gutenberg comments are stripped by bleach,
        # so validate the content separately instead of sanitizing it again here.
        if re.search(r"<(?:script|iframe|object|embed|form|input|button)\b", content, re.I):
            raise ValueError(f"Unsafe tag survived rendering for page {key}")
        if re.search(r"</?(?:user|assistant|system|developer)\b", content, re.I):
            raise ValueError(f"Prompt-role tag survived rendering for page {key}")
        if "ei-logo.gif" in content:
            raise ValueError(f"Excluded custom logo appears in rendered page {key}")

        relative_file = Path("pages") / f"{page_config['slug']}.html"
        (build_dir / relative_file).write_text(content, encoding="utf-8")
        manifest_pages.append(
            {
                "key": key,
                "title": page_config["title"],
                "slug": page_config["slug"],
                "order": page_config.get("order", 0),
                "status": config.get("migration", {}).get("publish_status", config["site"].get("default_status", "draft")),
                "content_file": str(relative_file),
                "old_paths": page_config.get("old_paths", []),
                "content_text_length": len(text_content(content)),
            }
        )

    manifest_pages.sort(key=lambda item: item["order"])
    redirects = build_redirect_rows(config)
    write_csv(build_dir / "redirects.csv", ["source_path", "target_path", "status_code", "notes"], redirects)

    media_rows = [
        {
            "path": item["path"],
            "source_url": item["source_url"],
            "alt_text": item.get("alt_text", ""),
            "role": item.get("role", "content"),
            "exists_locally": item.get("exists", False),
            "include": "yes",
        }
        for item in data.get("media", [])
    ]
    for excluded in config.get("media", {}).get("exclude", []):
        media_rows.append(
            {
                "path": excluded,
                "source_url": "",
                "alt_text": "",
                "role": "excluded-branding",
                "exists_locally": (Path(data["source_root"]) / excluded).exists(),
                "include": "no",
            }
        )
    write_csv(
        build_dir / "media-manifest.csv",
        ["path", "source_url", "alt_text", "role", "exists_locally", "include"],
        media_rows,
    )

    manifest = {
        "schema_version": 1,
        "generated_at": utc_now().isoformat(),
        "site": config["site"],
        "pages": manifest_pages,
        "media": data.get("media", []),
        "redirects_file": "redirects.csv",
        "static_microsites": config.get("static_microsites", []),
        "source_counts": data["counts"],
    }
    write_json(build_dir / "site-manifest.json", manifest)

    unresolved = data.get("unresolved_project_publications", [])
    review_lines = [
        "# Content Review",
        "",
        "## Required review items",
        "",
        "- Review Mark Riedl's title, roles, biography, office, phone, and profile links against current official sources.",
        "- Confirm the final lab mission statement and whether legacy Entertainment Intelligence language should remain anywhere.",
        "- Review the current People roster for departures, additions, and role changes.",
        "- Review old HTTP external links and update when an HTTPS destination exists.",
        "- Decide how the standalone `capabilibara/` microsite will be hosted; it is not in the core WordPress import.",
        "- Confirm whether all historical publications and theses should remain public on the new lab site.",
        "",
        "## Automatically detected unresolved publication references",
        "",
    ]
    if unresolved:
        for item in unresolved:
            review_lines.append(f"- Project `{item['project']}` references missing publication ID `{item['publication_id']}`.")
    else:
        review_lines.append("None.")
    review_lines.extend(
        [
            "",
            "## Security note",
            "",
            "The source audit must detect and the sanitizer must remove the invisible prompt-injection-like content in `mark-riedl.md`.",
            "",
        ]
    )
    (build_dir / "content-review.md").write_text("\n".join(review_lines), encoding="utf-8")

    summary_lines = [
        "# Migration Build Summary",
        "",
        f"Generated: {manifest['generated_at']}",
        "",
        "## Source counts",
        "",
        f"- Projects: {data['counts']['projects']}",
        f"- Publications: {data['counts']['publications']}",
        f"- Theses: {data['counts']['theses']}",
        f"- Unresolved project publication references: {data['counts']['unresolved_project_publications']}",
    ]
    for group, count in data["counts"]["people"].items():
        summary_lines.append(f"- People / {group}: {count}")
    summary_lines.extend(
        [
            "",
            "## Generated pages",
            "",
        ]
    )
    for page in manifest_pages:
        summary_lines.append(f"- `{page['slug']}` — {page['title']} ({page['content_text_length']} text characters)")
    summary_lines.extend(
        [
            "",
            "## Explicit exclusions",
            "",
            "- `assets/images/ei-logo.gif` — custom branding asset, not migrated.",
            "- `capabilibara/` — standalone static microsite, pending a separate hosting decision.",
            "- Live DNS, CNAME, and GitHub Pages settings — untouched.",
            "",
        ]
    )
    (build_dir / "migration-summary.md").write_text("\n".join(summary_lines), encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Render normalized HCAI content into WordPress page HTML.")
    parser.add_argument("--build-dir", type=Path, default=DEFAULT_BUILD_DIR)
    parser.add_argument("--config", type=Path, default=None)
    args = parser.parse_args()

    build_dir = ensure_build_dir(args.build_dir.resolve())
    normalized_path = build_dir / "normalized-site.json"
    if not normalized_path.exists():
        parser.error(f"Missing {normalized_path}; run extract_site.py first")
    data = json.loads(normalized_path.read_text(encoding="utf-8"))
    config = load_config(args.config)
    manifest = render_all(data, config, build_dir)
    print(f"Rendered {len(manifest['pages'])} pages into {build_dir / 'pages'}")
    print(f"Wrote {build_dir / 'site-manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
