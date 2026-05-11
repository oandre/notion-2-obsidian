import asyncio
from typing import Any

from notion_extractor.notion.client import AsyncNotionClient


async def fetch_block_children(
    client: AsyncNotionClient, block_id: str
) -> list[dict[str, Any]]:
    blocks = await _paginate_get(client, f"/blocks/{block_id}/children")

    async def hydrate(block: dict[str, Any]) -> dict[str, Any]:
        block.setdefault("children", [])
        if block.get("has_children") and block.get("type") not in {
            "child_page",
            "child_database",
        }:
            block["children"] = await fetch_block_children(client, block["id"])
        return block

    return list(await asyncio.gather(*(hydrate(b) for b in blocks)))


async def query_database(
    client: AsyncNotionClient, database_id: str
) -> list[dict[str, Any]]:
    return await _paginate_post(client, f"/databases/{database_id}/query", body={})


async def get_page(client: AsyncNotionClient, page_id: str) -> dict[str, Any]:
    return await client.get(f"/pages/{page_id}")


async def get_database(client: AsyncNotionClient, database_id: str) -> dict[str, Any]:
    return await client.get(f"/databases/{database_id}")


async def _paginate_get(
    client: AsyncNotionClient, path: str
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        qs = "?page_size=100" + (f"&start_cursor={cursor}" if cursor else "")
        page = await client.get(path + qs)
        results.extend(page.get("results", []))
        if not page.get("has_more"):
            return results
        cursor = page.get("next_cursor")


async def _paginate_post(
    client: AsyncNotionClient, path: str, *, body: dict[str, Any]
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        page_body: dict[str, Any] = {**body, "page_size": 100}
        if cursor:
            page_body["start_cursor"] = cursor
        page = await client.post(path, page_body)
        results.extend(page.get("results", []))
        if not page.get("has_more"):
            return results
        cursor = page.get("next_cursor")
