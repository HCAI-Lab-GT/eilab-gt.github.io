from __future__ import annotations

import csv
import hashlib
import html
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping
from urllib.parse import urljoin, urlparse

import bleach
import mistune
import yaml
from bs4 import BeautifulSoup, Comment

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BUILD_DIR = ROOT / "build"

ALLOWED_TAGS = [
    "a",
    "abbr",
    "blockquote",
    "br",
    "code",
    "dd",
    "details",
    "div",
    "dl",
    "dt",
    "em",
    "figcaption",
    "figure",
    "h2",
    "h3",
    "h4",
    "h5",
    "hr",
    "img",
    "li",
    "ol",
    "p",
    "pre",
    "span",
    "strong",
    "summary",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
]

ALLOWED_ATTRIBUTES: dict[str, list[str]] = {
    "a": ["href", "title", "rel", "target", "id"],
    "abbr": ["title"],
    "div": ["id", "class"],
    "details": ["open"],
    "figure": ["class"],
    "figcaption": ["class"],
    "h2": ["id", "class"],
    "h3": ["id", "class"],
    "h4": ["id", "class"],
    "h5": ["id", "class"],
    "img": ["src", "alt", "title", "width", "height", "loading", "class"],
    "ol": ["start", "class"],
    "p": ["class"],
    "span": ["class"],
    "table": ["class"],
    "td": ["colspan", "rowspan", "class"],
    "th": ["scope", "colspan", "rowspan", "class"],
    "tr": ["class"],
    "ul": ["class"],
}

BANNED_TAGS = {
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "form",
    "input",
    "button",
    "meta",
    "link",
    "user",
    "assistant",
    "system",
    "developer",
}

HIDDEN_STYLE_PATTERNS = [
    re.compile(r"display\s*:\s*none", re.I),
    re.compile(r"visibility\s*:\s*hidden", re.I),
    re.compile(r"opacity\s*:\s*0(?:\D|$)", re.I),
    re.compile(r"font-size\s*:\s*0(?:px|em|rem|%|\D|$)", re.I),
    re.compile(r"color\s*:\s*(?:#fff(?:fff)?|white)\b", re.I),
]

PROMPT_TAG_PATTERN = re.compile(r"</?(?:user|assistant|system|developer)\b", re.I)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def load_dotenv(path: Path | None = None) -> None:
    """Load a simple .env file without overriding existing environment variables."""
    env_path = path or (ROOT / ".env")
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def load_yaml(path: Path) -> Any:
    if not path.exists():
        raise FileNotFoundError(f"Required YAML file not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def load_config(path: Path | None = None) -> dict[str, Any]:
    config_path = path or (ROOT / "site-config.yaml")
    config = load_yaml(config_path)
    if not isinstance(config, dict):
        raise ValueError(f"Expected mapping in {config_path}")
    return config


def find_first(source_root: Path, candidates: Iterable[str]) -> Path:
    checked: list[Path] = []
    for candidate in candidates:
        path = source_root / candidate
        checked.append(path)
        if path.exists():
            return path
    joined = "\n  - ".join(str(path) for path in checked)
    raise FileNotFoundError(f"None of the expected files exist:\n  - {joined}")


def split_front_matter(text: str) -> tuple[dict[str, Any], str]:
    if not text.startswith("---"):
        return {}, text
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text
    try:
        end = next(index for index, line in enumerate(lines[1:], start=1) if line.strip() == "---")
    except StopIteration:
        return {}, text
    raw_front_matter = "\n".join(lines[1:end])
    body = "\n".join(lines[end + 1 :])
    parsed = yaml.safe_load(raw_front_matter) or {}
    if not isinstance(parsed, dict):
        parsed = {}
    return parsed, body


def slugify(value: str) -> str:
    normalized = value.strip().lower()
    normalized = re.sub(r"[’']", "", normalized)
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    return normalized.strip("-")


def ci_get(mapping: Mapping[str, Any], *names: str, default: Any = None) -> Any:
    lowered = {str(key).lower(): value for key, value in mapping.items()}
    for name in names:
        if name.lower() in lowered:
            return lowered[name.lower()]
    return default


def markdown_to_html(value: str | None) -> str:
    if not value:
        return ""
    renderer = mistune.create_markdown(escape=False, plugins=["table", "strikethrough", "task_lists"])
    return renderer(value)


def _looks_hidden(style: str) -> bool:
    return any(pattern.search(style) for pattern in HIDDEN_STYLE_PATTERNS)


def sanitize_html(value: str | None) -> str:
    if not value:
        return ""
    soup = BeautifulSoup(value, "html.parser")

    for comment in soup.find_all(string=lambda node: isinstance(node, Comment)):
        comment.extract()

    for tag in list(soup.find_all(True)):
        if tag.name and tag.name.lower() in BANNED_TAGS:
            tag.decompose()

    for tag in list(soup.find_all(True)):
        if tag.attrs is None:
            continue
        style = str(tag.attrs.get("style", ""))
        if style and _looks_hidden(style):
            tag.decompose()
            continue

        for attribute in list(tag.attrs):
            attr_lower = attribute.lower()
            if attr_lower == "style" or attr_lower.startswith("on"):
                del tag.attrs[attribute]
                continue
            if attr_lower in {"href", "src"}:
                raw_url = str(tag.attrs.get(attribute, "")).strip()
                if raw_url.lower().startswith("javascript:"):
                    del tag.attrs[attribute]

    cleaned = bleach.clean(
        str(soup),
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols=["http", "https", "mailto"],
        strip=True,
        strip_comments=True,
    )
    return cleaned.strip()


def sanitize_markdown(value: str | None) -> str:
    return sanitize_html(markdown_to_html(value))


def text_content(value: str | None) -> str:
    if not value:
        return ""
    return BeautifulSoup(value, "html.parser").get_text(" ", strip=True)


LEGACY_PATHS = {
    "/projects.html": "/research/",
    "/projects": "/research/",
    "/projects/": "/research/",
    "/members.html": "/people/",
    "/members": "/people/",
    "/members/": "/people/",
    "/publications.html": "/publications/",
    "/theses.html": "/theses/",
    "/mark-riedl.html": "/mark-riedl/",
    "/index.html": "/",
}

MARK_PROFILE_URL = re.compile(r"eilab-gt\.github\.io/riedl\.html/?$", re.I)
TECH_TYPO = re.compile(r"Georgia Institute of Technology Tech\b", re.I)


def rewrite_legacy_site_url(url: str | None) -> str | None:
    """Map old Jekyll routes and the stale GitHub Pages profile to WordPress slugs."""
    if not url:
        return url
    raw = str(url).strip()
    if not raw or raw.lower() in {"none", "null"}:
        return None
    if MARK_PROFILE_URL.search(urlparse(raw).netloc + urlparse(raw).path):
        return "/mark-riedl/"
    parsed = urlparse(raw)
    path = parsed.path or "/"
    new_path = LEGACY_PATHS.get(path)
    if new_path is None:
        return raw
    fragment = f"#{parsed.fragment}" if parsed.fragment else ""
    return new_path + fragment


def rewrite_legacy_hrefs_in_html(content: str) -> str:
    if not content:
        return content
    soup = BeautifulSoup(content, "html.parser")
    for tag in soup.find_all("a"):
        href = tag.get("href")
        rewritten = rewrite_legacy_site_url(href)
        if rewritten:
            tag["href"] = rewritten
        elif href is not None and not rewritten:
            del tag.attrs["href"]
    return str(soup)


def fix_known_source_typos(value: str) -> str:
    return TECH_TYPO.sub("Georgia Institute of Technology", value or "")


def rewrite_internal_urls(content: str, source_url: str, target_base: str = "") -> str:
    if not content:
        return content
    parsed = urlparse(source_url)
    source_hosts = {parsed.netloc.lower(), "www." + parsed.netloc.lower()}
    soup = BeautifulSoup(content, "html.parser")
    for tag in soup.find_all(["a", "img"]):
        attribute = "href" if tag.name == "a" else "src"
        raw = tag.get(attribute)
        if not raw:
            continue
        parsed_raw = urlparse(raw)
        if parsed_raw.netloc.lower() in source_hosts:
            relative = parsed_raw.path or "/"
            if parsed_raw.query:
                relative += "?" + parsed_raw.query
            if parsed_raw.fragment:
                relative += "#" + parsed_raw.fragment
            if target_base:
                tag[attribute] = urljoin(target_base.rstrip("/") + "/", relative.lstrip("/"))
            else:
                tag[attribute] = relative
    return str(soup)


def ensure_build_dir(path: Path | None = None) -> Path:
    build_dir = path or DEFAULT_BUILD_DIR
    build_dir.mkdir(parents=True, exist_ok=True)
    return build_dir


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_csv(path: Path, fieldnames: list[str], rows: Iterable[Mapping[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fieldnames})


def stable_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def html_escape(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def cdata(value: str) -> str:
    return "<![CDATA[" + value.replace("]]>", "]]]]><![CDATA[>") + "]] >".replace(" ", "")


def normalize_url(url: str) -> str:
    return url.rstrip("/")


def load_manifest(build_dir: Path | None = None) -> dict[str, Any]:
    path = (build_dir or DEFAULT_BUILD_DIR) / "site-manifest.json"
    if not path.exists():
        raise FileNotFoundError(f"Build manifest not found: {path}. Run scripts/run_pipeline.py first.")
    return json.loads(path.read_text(encoding="utf-8"))


def read_page_content(build_dir: Path, page: Mapping[str, Any]) -> str:
    path = build_dir / str(page["content_file"])
    if not path.exists():
        raise FileNotFoundError(f"Rendered page file missing: {path}")
    return path.read_text(encoding="utf-8")


def getenv_required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Required environment variable {name} is not set")
    return value


@dataclass(frozen=True)
class Finding:
    severity: str
    category: str
    path: str
    line: int
    message: str
    evidence: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "severity": self.severity,
            "category": self.category,
            "path": self.path,
            "line": self.line,
            "message": self.message,
            "evidence": self.evidence,
        }
