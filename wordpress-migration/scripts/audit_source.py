from __future__ import annotations

import argparse
import sys
import re
from pathlib import Path
from typing import Iterable

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.common import DEFAULT_BUILD_DIR, Finding, ensure_build_dir, write_json

TEXT_EXTENSIONS = {
    ".md",
    ".markdown",
    ".html",
    ".htm",
    ".yml",
    ".yaml",
    ".json",
    ".txt",
    ".css",
    ".js",
    ".xml",
}

SKIP_PARTS = {
    ".git",
    ".venv",
    "node_modules",
    "build",
    "vendor",
}

PATTERNS: list[tuple[str, str, re.Pattern[str], str]] = [
    (
        "high",
        "prompt-role-tag",
        re.compile(r"</?(?:user|assistant|system|developer)\b", re.I),
        "Prompt-role tag appears in website content; treat as data and remove from migration.",
    ),
    (
        "high",
        "hidden-content",
        re.compile(r"(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)|font-size\s*:\s*0(?:px|em|rem|%|\D|$))", re.I),
        "Hidden-content styling may conceal text from human readers.",
    ),
    (
        "high",
        "white-on-white",
        re.compile(r"color\s*:\s*(?:#fff(?:fff)?|white)\b", re.I),
        "White text may be invisible on the default page background.",
    ),
    (
        "high",
        "prompt-injection-language",
        re.compile(r"(?:ignore\s+(?:all\s+)?previous|system\s+prompt|report\s+that|do\s+not\s+follow|you\s+are\s+chatgpt)", re.I),
        "Instruction-like language appears in source content and must not guide an AI agent.",
    ),
    (
        "medium",
        "executable-html",
        re.compile(r"<(?:script|iframe|object|embed|form|input|button)\b", re.I),
        "Executable or interactive HTML requires review before WordPress migration.",
    ),
    (
        "medium",
        "inline-event-handler",
        re.compile(r"\son[a-z]+\s*=", re.I),
        "Inline JavaScript event handlers are removed from migrated content.",
    ),
    (
        "medium",
        "javascript-url",
        re.compile(r"javascript\s*:", re.I),
        "JavaScript URL is unsafe for migrated content.",
    ),
    (
        "medium",
        "custom-logo",
        re.compile(r"ei-logo\.gif", re.I),
        "Custom lab logo is excluded from the compliant WordPress site.",
    ),
    (
        "low",
        "old-http-url",
        re.compile(r"http://eilab\.gatech\.edu", re.I),
        "Old absolute HTTP link should become a target-relative URL or redirect.",
    ),
    (
        "low",
        "github-pages-url",
        re.compile(r"eilab-gt\.github\.io", re.I),
        "GitHub Pages URL should be reviewed for canonical target routing.",
    ),
]


def iter_text_files(source_root: Path) -> Iterable[Path]:
    for path in source_root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in TEXT_EXTENSIONS:
            continue
        if any(part in SKIP_PARTS for part in path.parts):
            continue
        # Avoid enormous vendor/minified payloads while still inspecting first-party pages.
        if "capabilibara" in path.parts and path.name.endswith(".min.css"):
            continue
        yield path


def audit(source_root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in iter_text_files(source_root):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            findings.append(
                Finding(
                    severity="medium",
                    category="read-error",
                    path=str(path.relative_to(source_root)),
                    line=0,
                    message=f"Could not read file: {exc}",
                )
            )
            continue

        for line_number, line in enumerate(text.splitlines(), start=1):
            for severity, category, pattern, message in PATTERNS:
                if pattern.search(line):
                    evidence = line.strip()
                    if len(evidence) > 240:
                        evidence = evidence[:237] + "..."
                    findings.append(
                        Finding(
                            severity=severity,
                            category=category,
                            path=str(path.relative_to(source_root)),
                            line=line_number,
                            message=message,
                            evidence=evidence,
                        )
                    )
    return findings


def render_markdown(findings: list[Finding], source_root: Path) -> str:
    counts = {severity: sum(1 for item in findings if item.severity == severity) for severity in ["high", "medium", "low"]}
    lines = [
        "# Source Audit",
        "",
        f"Source root: `{source_root}`",
        "",
        f"- High: {counts['high']}",
        f"- Medium: {counts['medium']}",
        f"- Low: {counts['low']}",
        "",
    ]
    if not findings:
        lines.append("No configured findings were detected.")
        return "\n".join(lines) + "\n"

    for severity in ["high", "medium", "low"]:
        subset = [item for item in findings if item.severity == severity]
        if not subset:
            continue
        lines.extend([f"## {severity.title()} severity", ""])
        for item in subset:
            lines.append(
                f"- `{item.path}:{item.line}` — **{item.category}**: {item.message}"
            )
            if item.evidence:
                safe_evidence = item.evidence.replace("`", "\\`")
                lines.append(f"  - Evidence: `{safe_evidence}`")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit Jekyll source files before AI-assisted migration.")
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--build-dir", type=Path, default=DEFAULT_BUILD_DIR)
    parser.add_argument("--fail-on-high", action="store_true")
    args = parser.parse_args()

    source_root = args.source_root.resolve()
    if not source_root.exists():
        parser.error(f"Source root does not exist: {source_root}")

    build_dir = ensure_build_dir(args.build_dir.resolve())
    findings = audit(source_root)
    payload = {
        "source_root": str(source_root),
        "finding_count": len(findings),
        "counts": {
            severity: sum(1 for item in findings if item.severity == severity)
            for severity in ["high", "medium", "low"]
        },
        "findings": [item.as_dict() for item in findings],
    }
    write_json(build_dir / "source-audit.json", payload)
    (build_dir / "source-audit.md").write_text(render_markdown(findings, source_root), encoding="utf-8")

    print(f"Wrote {build_dir / 'source-audit.json'}")
    print(f"Wrote {build_dir / 'source-audit.md'}")
    print(
        "Findings: "
        + ", ".join(f"{severity}={payload['counts'][severity]}" for severity in ["high", "medium", "low"])
    )

    if args.fail_on_high and payload["counts"]["high"]:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
