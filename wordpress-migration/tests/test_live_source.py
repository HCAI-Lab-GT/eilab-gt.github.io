from __future__ import annotations

import html
import re
from pathlib import Path
from urllib.parse import urlparse

from lxml import etree

from scripts.build_wxr import build_wxr
from scripts.common import load_config, slugify
from scripts.extract_site import extract_site
from scripts.render_site import render_all

LIVE_ROOT = Path(__file__).resolve().parents[2]
WXR_NS = {"wp": "http://wordpress.org/export/1.2/"}
UNSAFE_MARKERS = ("<script", "<user", "<assistant", "<system", "<developer", "ei-logo.gif")
STALE_PROJECT_IDS = (
    "Lin2019GenerationMania",
    "harrisonaies2018",
    "Balloch2022TheRole",
)


def _wxr_text(tree: etree._ElementTree, post_type: str, field: str) -> list[str]:
    return tree.xpath(
        f"//item[wp:post_type/text()='{post_type}']/wp:{field}/text()",
        namespaces=WXR_NS,
    )


def _parse_wxr(path: Path) -> tuple[etree._ElementTree, list[str]]:
    tree = etree.parse(str(path))
    post_types = tree.xpath("//wp:post_type/text()", namespaces=WXR_NS)
    return tree, post_types


def _needle(haystack: str, text: str) -> str:
    if text in haystack:
        return text
    escaped = html.escape(text, quote=True)
    if escaped in haystack:
        return escaped
    raise AssertionError(f"missing {text!r}")


def _heading_spans(page: str, titles: list[str]) -> dict[str, tuple[int, int]]:
    positions: list[tuple[str, int]] = []
    for title in titles:
        pos = page.find(f">{title}<")
        assert pos != -1, f"missing heading {title!r}"
        positions.append((title, pos))
    spans: dict[str, tuple[int, int]] = {}
    for index, (title, start) in enumerate(positions):
        end = positions[index + 1][1] if index + 1 < len(positions) else len(page)
        spans[title] = (start, end)
    return spans


def test_live_source_stale_project_ids_resolve() -> None:
    config = load_config()
    normalized = extract_site(LIVE_ROOT, config)
    unresolved = {item["publication_id"] for item in normalized["unresolved_project_publications"]}
    assert normalized["counts"]["unresolved_project_publications"] == 0
    assert unresolved == set()
    for publication_id in STALE_PROJECT_IDS:
        assert publication_id not in unresolved


def test_live_source_render_matches_staging_contract(tmp_path: Path) -> None:
    config = load_config()
    normalized = extract_site(LIVE_ROOT, config)
    assert normalized["counts"]["unresolved_project_publications"] == 0
    manifest = render_all(normalized, config, tmp_path)
    expected_slugs = [str(page["slug"]) for page in config["pages"].values()]
    assert [page["slug"] for page in manifest["pages"]] == expected_slugs
    pages = {
        page["slug"]: (tmp_path / page["content_file"]).read_text(encoding="utf-8")
        for page in manifest["pages"]
    }
    combined = "\n".join(pages.values())
    for marker in UNSAFE_MARKERS:
        assert marker not in combined.lower()
    assert "capabilibara" not in combined.lower()

    prefix = urlparse(str(config["site"]["staging_url"])).path.rstrip("/")
    assert f"{prefix}/research/" in pages["home"]
    assert f"{prefix}/mark-riedl/" in pages["people"]
    assert (
        re.search(
            rf'href="(?!{re.escape(prefix)})/(?:research|people|publications|theses|mark-riedl)',
            combined,
        )
        is None
    )

    media_by_role = {item.get("role"): item for item in config.get("media", {}).get("include", [])}
    assert media_by_role["hero"]["wordpress_url"] in pages["home"]
    assert media_by_role["profile"]["wordpress_url"] in pages["home"]
    assert media_by_role["profile"]["wordpress_url"] in pages["mark-riedl"]

    order = list(config["people_group_order"])
    groups = normalized["people"]
    titles = [
        str(config["people_group_titles"][key])
        for key in order
        if groups.get(key)
    ]
    people = pages["people"]
    spans = _heading_spans(people, titles)
    phd_names = {person["name"] for person in groups.get("phds", [])}
    alumni_names = {person["name"] for person in groups.get("alumni", [])}
    assert phd_names.isdisjoint(alumni_names)

    for group_key, members in groups.items():
        title = str(config["people_group_titles"][group_key])
        start, end = spans[title]
        section = people[start:end]
        for person in members:
            name = person["name"]
            needle = _needle(section, name)
            at = section.find(needle)
            assert at != -1, f"{name} missing from {title}"
            where = person.get("where")
            if where:
                window = section[at : at + 500]
                assert _needle(window, where)

    years = {str(item.get("year") or "Undated") for item in normalized["publications"]}
    publications = pages["publications"]
    assert "hcai-year-toc" in publications
    assert "hcai-publication" in publications
    assert "hcai-sr-only" in publications
    assert "Paper on arXiv" in publications or "Open publication" in publications or "Download PDF" in publications
    for year in years:
        year_slug = slugify(year)
        assert f'href="#year-{year_slug}"' in publications
        assert f'id="year-{year_slug}"' in publications
        assert f"Publications from </span>{year}" in publications or f">Publications from {year}<" in publications

    wxr_path = tmp_path / "site.wordpress.xml"
    build_wxr(tmp_path, config, wxr_path, str(config["site"]["staging_url"]))
    tree, post_types = _parse_wxr(wxr_path)
    assert post_types.count("page") == 6
    assert post_types.count("attachment") == 0
    assert set(_wxr_text(tree, "page", "post_name")) == set(expected_slugs)
    assert set(_wxr_text(tree, "page", "status")) == {"draft"}
