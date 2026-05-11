import pytest
from pytest_httpx import HTTPXMock

from notion_extractor.extract.plan import NodeKind
from notion_extractor.notion.client import AsyncNotionClient
from notion_extractor.notion.discovery import discover_subtree, list_shared_roots


def _rich(text: str) -> dict:
    return {
        "plain_text": text,
        "type": "text",
        "text": {"content": text, "link": None},
        "href": None,
        "annotations": {
            "bold": False, "italic": False, "strikethrough": False,
            "underline": False, "code": False, "color": "default",
        },
    }


@pytest.mark.asyncio
async def test_list_shared_roots(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        method="POST",
        url="https://api.notion.com/v1/search",
        json={
            "results": [
                {
                    "object": "page",
                    "id": "p1",
                    "properties": {
                        "title": {
                            "type": "title",
                            "title": [_rich("Notas")],
                        }
                    },
                    "parent": {"type": "workspace"},
                },
                {
                    "object": "database",
                    "id": "d1",
                    "title": [_rich("Tarefas")],
                    "parent": {"type": "workspace"},
                },
            ],
            "next_cursor": None,
            "has_more": False,
        },
    )
    async with AsyncNotionClient(token="t") as client:
        roots = await list_shared_roots(client)

    assert {r.id for r in roots} == {"p1", "d1"}
    assert next(r for r in roots if r.id == "p1").kind == NodeKind.PAGE
    assert next(r for r in roots if r.id == "d1").kind == NodeKind.DATABASE


@pytest.mark.asyncio
async def test_discover_subtree_walks_children(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        url="https://api.notion.com/v1/pages/p1",
        json={
            "id": "p1",
            "properties": {
                "title": {"type": "title", "title": [_rich("Root")]}
            },
        },
    )
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/p1/children?page_size=100",
        json={
            "results": [
                {
                    "id": "sub1",
                    "type": "child_page",
                    "child_page": {"title": "Sub"},
                    "has_children": False,
                },
                {
                    "id": "db1",
                    "type": "child_database",
                    "child_database": {"title": "Items"},
                    "has_children": False,
                },
                {
                    "id": "para",
                    "type": "paragraph",
                    "paragraph": {"rich_text": []},
                    "has_children": False,
                },
            ],
            "next_cursor": None,
            "has_more": False,
        },
    )
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/sub1/children?page_size=100",
        json={"results": [], "next_cursor": None, "has_more": False},
    )
    httpx_mock.add_response(
        method="POST",
        url="https://api.notion.com/v1/databases/db1/query",
        json={
            "results": [
                {
                    "id": "row1",
                    "properties": {
                        "Name": {
                            "type": "title",
                            "title": [_rich("Row 1")],
                        }
                    },
                }
            ],
            "next_cursor": None,
            "has_more": False,
        },
    )
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/row1/children?page_size=100",
        json={"results": [], "next_cursor": None, "has_more": False},
    )

    async with AsyncNotionClient(token="t") as client:
        nodes = await discover_subtree(client, root_id="p1", root_kind=NodeKind.PAGE)

    ids = {n.id for n in nodes}
    assert ids == {"p1", "sub1", "db1", "row1"}
    p1 = next(n for n in nodes if n.id == "p1")
    assert set(p1.children_ids) == {"sub1", "db1"}
    db1 = next(n for n in nodes if n.id == "db1")
    assert db1.children_ids == ["row1"]
