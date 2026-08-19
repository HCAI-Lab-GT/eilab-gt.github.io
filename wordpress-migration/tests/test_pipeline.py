from __future__ import annotations

import json
from pathlib import Path

from lxml import etree

from scripts.audit_source import audit
from scripts.build_wxr import build_wxr
from scripts.common import load_config
from scripts.extract_site import extract_site
from scripts.render_site import render_all

FIXTURE = Path(__file__).parent / "fixtures" / "source"


def test_source_audit_finds_hidden_prompt_content() -> None:
    findings = audit(FIXTURE)
    categories = {item.category for item in findings}
    assert "prompt-role-tag" in categories
    assert "white-on-white" in categories
    assert any(item.path == "mark-riedl.md" for item in findings)


def test_extract_render_and_wxr(tmp_path: Path) -> None:
    config = load_config()
    normalized = extract_site(FIXTURE.resolve(), config)
    assert normalized["counts"]["projects"] == 1
    assert normalized["counts"]["publications"] == 2
    assert normalized["counts"]["theses"] == 2
    assert normalized["counts"]["unresolved_project_publications"] == 0
    assert normalized["publications"][0]["title"] in {"A Test Publication", "Uppercase Legacy Keys"}
    titles = {publication["title"] for publication in normalized["publications"]}
    assert "Uppercase Legacy Keys" in titles

    mark_html = normalized["mark_riedl"]["body_html"].lower()
    assert "<user" not in mark_html
    assert "false award" not in mark_html

    (tmp_path / "normalized-site.json").write_text(json.dumps(normalized), encoding="utf-8")
    manifest = render_all(normalized, config, tmp_path)
    assert len(manifest["pages"]) == 6

    for page in manifest["pages"]:
        content = (tmp_path / page["content_file"]).read_text(encoding="utf-8").lower()
        assert "ei-logo.gif" not in content
        assert "<user" not in content
        assert "<script" not in content

    wxr_path = tmp_path / "site.wordpress.xml"
    build_wxr(tmp_path, config, wxr_path, "https://sites.gatech.edu/test-hcai", "draft")
    tree = etree.parse(str(wxr_path))
    namespaces = {
        "wp": "http://wordpress.org/export/1.2/",
    }
    post_types = tree.xpath("//wp:post_type/text()", namespaces=namespaces)
    assert post_types.count("page") == 6
    assert post_types.count("attachment") == 2


def _render_pages(tmp_path: Path) -> dict[str, str]:
    config = load_config()
    normalized = extract_site(FIXTURE.resolve(), config)
    manifest = render_all(normalized, config, tmp_path)
    return {
        page["slug"]: (tmp_path / page["content_file"]).read_text(encoding="utf-8")
        for page in manifest["pages"]
    }


def test_home_renders_original_two_column_table(tmp_path: Path) -> None:
    pages = _render_pages(tmp_path)
    home = pages["home"]
    assert "<table" in home
    assert "<th" in home
    assert "Responsible AI" in home
    assert "Explainable AI" in home
    assert "/hcailab/research/#explainable-ai" in home
    assert home.find("<table") < home.find("Explainable AI")
    assert "<br" in home


def test_people_follow_original_group_order(tmp_path: Path) -> None:
    pages = _render_pages(tmp_path)
    people = pages["people"]
    faculty = people.find("Faculty")
    phd = people.find("PhD Students")
    alumni = people.find("Alumni")
    affiliated = people.find("Affiliated")
    assert faculty != -1 and phd != -1 and alumni != -1 and affiliated != -1
    assert faculty < phd < alumni < affiliated


def test_live_source_stale_project_ids_resolve() -> None:
    config = load_config()
    live_root = Path(__file__).resolve().parents[2]
    normalized = extract_site(live_root, config)
    unresolved = {item["publication_id"] for item in normalized["unresolved_project_publications"]}
    assert "Lin2019GenerationMania" not in unresolved
    assert "harrisonaies2018" not in unresolved
    assert "Balloch2022TheRole" not in unresolved


def test_people_omit_empty_links_and_rewrite_mark_profile(tmp_path: Path) -> None:
    pages = _render_pages(tmp_path)
    people = pages["people"]
    assert "Test Undergrad" in people
    assert 'href="">Test Undergrad' not in people
    assert "<a>Test Undergrad</a>" not in people
    assert "/hcailab/mark-riedl/" in people
    assert "eilab-gt.github.io/riedl.html" not in people


def test_mark_page_renders_sidebar_markdown_and_fixes_typo(tmp_path: Path) -> None:
    pages = _render_pages(tmp_path)
    mark = pages["mark-riedl"]
    assert "**Professor**" not in mark
    assert "<strong>Professor</strong>" in mark
    assert "Technology Tech" not in mark
    assert "Georgia Institute of Technology" in mark


def test_publications_match_original_entry_shape(tmp_path: Path) -> None:
    pages = _render_pages(tmp_path)
    publications = pages["publications"]
    assert "Glenn Matlin and Ada Lovelace" in publications
    assert "<strong" in publications and "A Test Publication" in publications
    assert 'href="https://example.com/paper">A Test Publication' not in publications
    assert ">Link</a>" in publications
    assert "Conference" in publications
    assert "(2026)" in publications
    assert 'href="#year-2026"' in publications
    assert "hcai-publication" in publications


def test_research_includes_project_toc_and_context(tmp_path: Path) -> None:
    pages = _render_pages(tmp_path)
    research = pages["research"]
    assert 'href="#explainable-ai"' in research
    assert "Explainable AI" in research
    assert "Representative work." in research
    assert "Representative Publications" in research


def test_theses_match_original_dissertation_line(tmp_path: Path) -> None:
    pages = _render_pages(tmp_path)
    theses = pages["theses"]
    assert "Ph.D. Dissertation" in theses
    assert "Student Example" in theses
    assert "Student Without Institute" in theses
    assert theses.count("Georgia Institute of Technology") >= 2


def test_redirects_include_old_core_routes(tmp_path: Path) -> None:
    config = load_config()
    normalized = extract_site(FIXTURE.resolve(), config)
    (tmp_path / "normalized-site.json").write_text(json.dumps(normalized), encoding="utf-8")
    render_all(normalized, config, tmp_path)
    redirects = (tmp_path / "redirects.csv").read_text(encoding="utf-8")
    assert "/members.html,/people/" in redirects
    assert "/projects.html,/research/" in redirects
    assert "/publications.html,/publications/" in redirects
