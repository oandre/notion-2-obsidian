from typing import Any

from notion_extractor.convert.inline import rich_text_to_md
from notion_extractor.extract.plan import NodeKind, PlannedNode
from notion_extractor.notion.client import AsyncNotionClient
from notion_extractor.notion.fetch import (
    fetch_block_children,
    get_database,
    get_page,
    query_database,
)


async def list_shared_roots(client: AsyncNotionClient) -> list[PlannedNode]:
    results: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        body: dict[str, Any] = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        page = await client.post("/search", body)
        results.extend(page.get("results", []))
        if not page.get("has_more"):
            break
        cursor = page.get("next_cursor")

    roots: list[PlannedNode] = []
    for r in results:
        obj = r.get("object")
        if obj == "page":
            roots.append(
                PlannedNode(
                    id=r["id"],
                    kind=NodeKind.PAGE,
                    title=_page_title(r),
                    parent_id=None,
                )
            )
        elif obj == "database":
            roots.append(
                PlannedNode(
                    id=r["id"],
                    kind=NodeKind.DATABASE,
                    title=rich_text_to_md(r.get("title", [])) or "Untitled",
                    parent_id=None,
                )
            )
    return roots


async def discover_subtree(
    client: AsyncNotionClient, *, root_id: str, root_kind: NodeKind
) -> list[PlannedNode]:
    collected: list[PlannedNode] = []

    if root_kind == NodeKind.PAGE:
        page = await get_page(client, root_id)
        root = PlannedNode(
            id=root_id,
            kind=NodeKind.PAGE,
            title=_page_title(page),
            parent_id=None,
            page_data=page,
        )
        await _walk_page(client, root, collected)
    else:
        db = await get_database(client, root_id)
        root = PlannedNode(
            id=root_id,
            kind=NodeKind.DATABASE,
            title=rich_text_to_md(db.get("title", [])) or "Untitled",
            parent_id=None,
            page_data=db,
        )
        await _walk_database(client, root, collected)

    return [root, *collected]


async def _walk_page(client: AsyncNotionClient, node: PlannedNode, out: list[PlannedNode]) -> None:
    node.blocks = await fetch_block_children(client, node.id)
    for block in node.blocks:
        btype = block.get("type")
        if btype == "child_page":
            child = PlannedNode(
                id=block["id"],
                kind=NodeKind.PAGE,
                title=block["child_page"].get("title", "Untitled"),
                parent_id=node.id,
            )
            node.children_ids.append(child.id)
            out.append(child)
            await _walk_page(client, child, out)
        elif btype == "child_database":
            child = PlannedNode(
                id=block["id"],
                kind=NodeKind.DATABASE,
                title=block["child_database"].get("title", "Untitled"),
                parent_id=node.id,
            )
            node.children_ids.append(child.id)
            out.append(child)
            await _walk_database(client, child, out)


async def _walk_database(
    client: AsyncNotionClient, node: PlannedNode, out: list[PlannedNode]
) -> None:
    items = await query_database(client, node.id)
    for item in items:
        title = _page_title(item)
        item_node = PlannedNode(
            id=item["id"],
            kind=NodeKind.DB_ITEM,
            title=title,
            parent_id=node.id,
            page_data=item,
        )
        node.children_ids.append(item_node.id)
        out.append(item_node)
        await _walk_page(client, item_node, out)


def _page_title(page: dict[str, Any]) -> str:
    props = page.get("properties", {})
    for prop in props.values():
        if prop.get("type") == "title":
            return rich_text_to_md(prop.get("title", [])) or "Untitled"
    return "Untitled"
