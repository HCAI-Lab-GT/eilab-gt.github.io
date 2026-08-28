from __future__ import annotations

import argparse
import sys
import json
import os
from pathlib import Path
from typing import Any

from lxml import etree

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.audit_source import audit, render_markdown as render_audit_markdown
from scripts.build_wxr import build_wxr
from scripts.common import DEFAULT_BUILD_DIR, ensure_build_dir, load_config, load_dotenv, utc_now, write_json
from scripts.extract_site import extract_site
from scripts.render_site import render_all


def validate_outputs(build_dir: Path, normalized: dict[str, Any], manifest: dict[str, Any], wxr_path: Path) -> list[str]:
    errors: list[str] = []
    if len(manifest.get("pages", [])) != 6:
        errors.append(f"Expected 6 core pages, found {len(manifest.get('pages', []))}")
    if normalized["counts"]["unresolved_project_publications"]:
        errors.append(
            f"Found {normalized['counts']['unresolved_project_publications']} unresolved project publication references"
        )
    for page in manifest.get("pages", []):
        path = build_dir / page["content_file"]
        if not path.exists() or not path.read_text(encoding="utf-8").strip():
            errors.append(f"Missing or empty rendered page: {path}")
        else:
            content = path.read_text(encoding="utf-8")
            if "ei-logo.gif" in content:
                errors.append(f"Excluded custom logo appears in {path}")
            for tag in ["<user", "<assistant", "<system", "<developer", "<script", "<iframe"]:
                if tag.lower() in content.lower():
                    errors.append(f"Unsafe tag {tag} appears in {path}")
    try:
        etree.parse(str(wxr_path))
    except (OSError, etree.XMLSyntaxError) as exc:
        errors.append(f"Generated WXR is not valid XML: {exc}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the complete local HCAI WordPress migration build.")
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--build-dir", type=Path, default=DEFAULT_BUILD_DIR)
    parser.add_argument("--config", type=Path, default=None)
    parser.add_argument("--target-url", default=None)
    parser.add_argument("--status", choices=["draft", "publish", "private", "pending"], default=None)
    parser.add_argument("--fail-on-unresolved", action="store_true")
    args = parser.parse_args()

    load_dotenv()
    source_root = args.source_root.resolve()
    if not source_root.exists():
        parser.error(f"Source root does not exist: {source_root}")
    build_dir = ensure_build_dir(args.build_dir.resolve())
    config = load_config(args.config)

    findings = audit(source_root)
    audit_payload = {
        "source_root": str(source_root),
        "finding_count": len(findings),
        "counts": {
            severity: sum(1 for item in findings if item.severity == severity)
            for severity in ["high", "medium", "low"]
        },
        "findings": [item.as_dict() for item in findings],
    }
    write_json(build_dir / "source-audit.json", audit_payload)
    (build_dir / "source-audit.md").write_text(render_audit_markdown(findings, source_root), encoding="utf-8")

    normalized = extract_site(source_root, config)
    write_json(build_dir / "normalized-site.json", normalized)
    manifest = render_all(normalized, config, build_dir)

    target_url = (
        args.target_url
        or os.getenv("WP_URL")
        or config["site"].get("staging_url")
        or "https://sites.gatech.edu/hcailab"
    )
    wxr_path = build_dir / "hcai-lab.wordpress.xml"
    build_wxr(build_dir, config, wxr_path, str(target_url), args.status)

    validation_errors = validate_outputs(build_dir, normalized, manifest, wxr_path)
    unresolved_count = normalized["counts"]["unresolved_project_publications"]
    if unresolved_count and not args.fail_on_unresolved:
        validation_errors = [
            error for error in validation_errors if not error.startswith("Found ") or "unresolved project publication" not in error
        ]

    report = {
        "generated_at": utc_now().isoformat(),
        "source_root": str(source_root),
        "build_dir": str(build_dir),
        "target_url": str(target_url),
        "source_audit_counts": audit_payload["counts"],
        "source_counts": normalized["counts"],
        "generated_pages": [page["slug"] for page in manifest["pages"]],
        "wxr_path": str(wxr_path),
        "validation_errors": validation_errors,
        "ok": not validation_errors,
    }
    write_json(build_dir / "pipeline-report.json", report)

    print(json.dumps(report, indent=2))
    if validation_errors:
        print("Pipeline completed with validation errors:")
        for error in validation_errors:
            print(f"- {error}")
        return 2
    print("Pipeline completed successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
