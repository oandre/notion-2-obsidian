import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from notion_extractor.convert.blocks import blocks_to_md
from notion_extractor.convert.properties import properties_to_frontmatter
from notion_extractor.extract.attachments import AttachmentDownloader
from notion_extractor.extract.plan import NodeKind, PlannedNode, plan_paths
from notion_extractor.extract.resolve import (
    BrokenLink,
    LinkContext,
    render_report,
    resolve_placeholders,
)
from notion_extractor.notion.client import AsyncNotionClient
from notion_extractor.notion.discovery import discover_subtree
from notion_extractor.progress import Event, EventBus, EventKind

_ASSET_PLACEHOLDER = re.compile(r"\{\{notion-asset:([^}]+)\}\}")


@dataclass
class ExtractionResult:
    pages_extracted: int = 0
    items_extracted: int = 0
    attachments_downloaded: int = 0
    total_bytes: int = 0
    duration_s: float = 0.0
    broken_links: list[BrokenLink] = field(default_factory=list)
    failures: list[tuple[str, str]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


async def run_extraction(
    *,
    client: AsyncNotionClient,
    bus: EventBus,
    output_dir: Path,
    root_selection: list[tuple[str, str]],
) -> ExtractionResult:
    started = time.monotonic()
    output_dir.mkdir(parents=True, exist_ok=True)
    assets_dir = output_dir / "assets"
    downloader = AttachmentDownloader(assets_dir=assets_dir)
    result = ExtractionResult()

    try:
        await bus.publish(Event(EventKind.DISCOVERY_STARTED, {}))
        all_nodes: list[PlannedNode] = []
        for root_id, root_kind_str in root_selection:
            kind = NodeKind(root_kind_str)
            subtree = await discover_subtree(client, root_id=root_id, root_kind=kind)
            all_nodes.extend(subtree)
            await bus.publish(
                Event(
                    EventKind.DISCOVERY_PROGRESS,
                    {"root_id": root_id, "discovered": len(subtree)},
                )
            )
        await bus.publish(Event(EventKind.DISCOVERY_DONE, {"total": len(all_nodes)}))

        paths = plan_paths(all_nodes, output_dir)
        id_to_node = {n.id: n for n in all_nodes}
        rendered: dict[str, str] = {}

        for node in all_nodes:
            await bus.publish(
                Event(
                    EventKind.NODE_STARTED,
                    {"id": node.id, "title": node.title},
                )
            )
            try:
                rendered[node.id] = await _render_node(node, client, id_to_node)
                if node.kind == NodeKind.PAGE:
                    result.pages_extracted += 1
                elif node.kind == NodeKind.DB_ITEM:
                    result.items_extracted += 1
                await bus.publish(Event(EventKind.NODE_DONE, {"id": node.id}))
            except Exception as exc:  # noqa: BLE001
                result.failures.append((node.id, str(exc)))
                await bus.publish(
                    Event(
                        EventKind.NODE_FAILED,
                        {"id": node.id, "reason": str(exc)},
                    )
                )

        for node in all_nodes:
            if node.id not in rendered:
                continue
            md = rendered[node.id]
            url_to_local = await _download_assets_in(md, downloader, bus)
            result.attachments_downloaded += len(url_to_local)
            result.total_bytes += sum(p.stat().st_size for p in url_to_local.values())

            ctx = LinkContext(
                from_file=paths[node.id],
                id_to_path=paths,
                url_to_local=url_to_local,
                vault_root=output_dir,
            )
            resolved, broken = resolve_placeholders(md, ctx)
            result.broken_links.extend(broken)
            paths[node.id].parent.mkdir(parents=True, exist_ok=True)
            paths[node.id].write_text(resolved, encoding="utf-8")

        result.duration_s = time.monotonic() - started
        report = render_report(
            vault_root=output_dir,
            pages_extracted=result.pages_extracted,
            items_extracted=result.items_extracted,
            attachments_downloaded=result.attachments_downloaded,
            total_bytes=result.total_bytes,
            duration_s=result.duration_s,
            broken_links=result.broken_links,
            failures=result.failures,
            warnings=result.warnings,
        )
        (output_dir / "_report.md").write_text(report, encoding="utf-8")
        await bus.publish(
            Event(
                EventKind.EXTRACTION_DONE,
                {
                    "pages": result.pages_extracted,
                    "items": result.items_extracted,
                    "attachments": result.attachments_downloaded,
                },
            )
        )
        return result
    finally:
        await downloader.close()


async def _render_node(
    node: PlannedNode,
    _client: AsyncNotionClient,
    id_to_node: dict[str, PlannedNode],
) -> str:
    if node.kind == NodeKind.PAGE:
        return blocks_to_md(node.blocks)
    if node.kind == NodeKind.DB_ITEM:
        page = node.page_data
        frontmatter = properties_to_frontmatter(page.get("properties", {}))
        frontmatter["notion_id"] = node.id
        frontmatter["notion_url"] = page.get("url", "")
        frontmatter["created_time"] = page.get("created_time", "")
        frontmatter["last_edited_time"] = page.get("last_edited_time", "")
        body = blocks_to_md(node.blocks)
        return _wrap_frontmatter(frontmatter) + body
    if node.kind == NodeKind.DATABASE:
        return _render_database_index(node, id_to_node)
    return ""


def _render_database_index(node: PlannedNode, id_to_node: dict[str, PlannedNode]) -> str:
    rows = [id_to_node[cid] for cid in node.children_ids if cid in id_to_node]
    if not rows:
        return f"# {node.title}\n"
    lines = [f"# {node.title}", "", "| Item |", "| --- |"]
    for row in rows:
        lines.append(f"| {{{{notion-link:{row.id}|{row.title}}}}} |")
    return "\n".join(lines) + "\n"


async def _download_assets_in(
    md: str, downloader: AttachmentDownloader, bus: EventBus
) -> dict[str, Path]:
    urls = {m.group(1) for m in _ASSET_PLACEHOLDER.finditer(md)}
    url_to_local: dict[str, Path] = {}
    for url in urls:
        try:
            local = await downloader.download(url)
            url_to_local[url] = local
            await bus.publish(
                Event(
                    EventKind.ATTACHMENT_DOWNLOADED,
                    {"url": url, "path": str(local)},
                )
            )
        except Exception:  # noqa: BLE001
            continue
    return url_to_local


def _wrap_frontmatter(fm: dict[str, Any]) -> str:
    text = yaml.safe_dump(fm, allow_unicode=True, sort_keys=False).rstrip()
    return f"---\n{text}\n---\n\n"
