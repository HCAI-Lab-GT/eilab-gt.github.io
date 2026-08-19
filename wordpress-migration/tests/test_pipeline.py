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
    assert normalized["counts"]["theses"] == 1
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


def test_redirects_include_old_core_routes(tmp_path: Path) -> None:
    config = load_config()
    normalized = extract_site(FIXTURE.resolve(), config)
    (tmp_path / "normalized-site.json").write_text(json.dumps(normalized), encoding="utf-8")
    render_all(normalized, config, tmp_path)
    redirects = (tmp_path / "redirects.csv").read_text(encoding="utf-8")
    assert "/members.html,/people/" in redirects
    assert "/projects.html,/research/" in redirects
    assert "/publications.html,/publications/" in redirects
