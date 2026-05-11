import enum
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_FORBIDDEN = re.compile(r'[\\/:*?"<>|]')


class NodeKind(enum.StrEnum):
    PAGE = "page"
    DATABASE = "database"
    DB_ITEM = "db_item"


@dataclass
class PlannedNode:
    id: str
    kind: NodeKind
    title: str
    parent_id: str | None
    children_ids: list[str] = field(default_factory=list)
    blocks: list[dict[str, Any]] = field(default_factory=list)
    page_data: dict[str, Any] = field(default_factory=dict)


def slugify(name: str) -> str:
    if not name:
        return "untitled"
    s = _FORBIDDEN.sub("-", name).strip()
    return s or "untitled"


def plan_paths(nodes: list[PlannedNode], root: Path) -> dict[str, Path]:
    by_id = {n.id: n for n in nodes}

    def dir_for(node_id: str) -> Path:
        node = by_id[node_id]
        parent_dir = root if node.parent_id is None else dir_for(node.parent_id)
        if _has_subtree(node):
            return parent_dir / slugify(node.title)
        return parent_dir

    paths: dict[str, Path] = {}
    siblings_by_dir: dict[Path, list[PlannedNode]] = {}
    for node in sorted(nodes, key=lambda n: n.id):
        parent_dir = root if node.parent_id is None else dir_for(node.parent_id)
        siblings_by_dir.setdefault(parent_dir, []).append(node)

    for parent_dir, group in siblings_by_dir.items():
        used: dict[str, int] = {}
        for node in group:
            base = slugify(node.title)
            count = used.get(base, 0) + 1
            used[base] = count
            filename = f"{base}.md" if count == 1 else f"{base} ({count}).md"
            paths[node.id] = parent_dir / filename
    return paths


def _has_subtree(node: PlannedNode) -> bool:
    if node.kind == NodeKind.DATABASE:
        return True
    return bool(node.children_ids)
