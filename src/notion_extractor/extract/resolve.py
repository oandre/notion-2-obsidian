import os
import re
from dataclasses import dataclass
from pathlib import Path

_LINK_RE = re.compile(r"\{\{notion-link:([^|}]+)(?:\|([^}]+))?\}\}")
_ASSET_RE = re.compile(r"\{\{notion-asset:([^}]+)\}\}")

BrokenLink = tuple[str, str | None, Path]


@dataclass
class LinkContext:
    from_file: Path
    id_to_path: dict[str, Path]
    url_to_local: dict[str, Path]
    vault_root: Path


def resolve_placeholders(md: str, ctx: LinkContext) -> tuple[str, list[BrokenLink]]:
    broken: list[BrokenLink] = []

    def link_sub(match: re.Match[str]) -> str:
        notion_id = match.group(1)
        label = match.group(2)
        target_path = ctx.id_to_path.get(notion_id)
        if target_path is not None:
            page_name = target_path.stem
            return f"[[{page_name}]]"
        broken.append((notion_id, label, ctx.from_file))
        return label if label else "(link removed)"

    def asset_sub(match: re.Match[str]) -> str:
        url = match.group(1)
        local = ctx.url_to_local.get(url)
        if local is None:
            return url
        rel = os.path.relpath(local, start=ctx.from_file.parent)
        return rel.replace(os.sep, "/")

    md = _LINK_RE.sub(link_sub, md)
    md = _ASSET_RE.sub(asset_sub, md)
    return md, broken


def render_report(
    *,
    vault_root: Path,
    pages_extracted: int,
    items_extracted: int,
    attachments_downloaded: int,
    total_bytes: int,
    duration_s: float,
    broken_links: list[BrokenLink],
    failures: list[tuple[str, str]],
    warnings: list[str],
) -> str:
    mb = total_bytes / (1024 * 1024)
    lines = [
        "# Relatório de extração",
        "",
        f"- Páginas extraídas: {pages_extracted}",
        f"- Itens de database extraídos: {items_extracted}",
        f"- Anexos baixados: {attachments_downloaded} ({mb:.1f} MB)",
        f"- Duração: {duration_s:.1f}s",
        "",
    ]
    if broken_links:
        lines.append(f"## Links para fora da seleção ({len(broken_links)})")
        for notion_id, label, from_file in broken_links:
            rel = from_file.relative_to(vault_root)
            label_part = f" — {label}" if label else ""
            lines.append(f"- `{notion_id}`{label_part} (em [{rel}]({rel}))")
        lines.append("")
    if failures:
        lines.append(f"## Falhas ({len(failures)})")
        for nid, reason in failures:
            lines.append(f"- `{nid}`: {reason}")
        lines.append("")
    if warnings:
        lines.append(f"## Avisos ({len(warnings)})")
        for w in warnings:
            lines.append(f"- {w}")
        lines.append("")
    return "\n".join(lines)
