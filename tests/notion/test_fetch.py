import pytest
from pytest_httpx import HTTPXMock

from notion_extractor.notion.client import AsyncNotionClient
from notion_extractor.notion.fetch import fetch_block_children, query_database


@pytest.mark.asyncio
async def test_fetch_block_children_handles_pagination(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/parent/children?page_size=100",
        json={
            "results": [
                {
                    "id": "b1",
                    "type": "paragraph",
                    "has_children": False,
                    "paragraph": {"rich_text": []},
                }
            ],
            "next_cursor": "cur1",
            "has_more": True,
        },
    )
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/parent/children?page_size=100&start_cursor=cur1",
        json={
            "results": [
                {
                    "id": "b2",
                    "type": "paragraph",
                    "has_children": False,
                    "paragraph": {"rich_text": []},
                }
            ],
            "next_cursor": None,
            "has_more": False,
        },
    )

    async with AsyncNotionClient(token="t") as client:
        blocks = await fetch_block_children(client, "parent")

    assert [b["id"] for b in blocks] == ["b1", "b2"]


@pytest.mark.asyncio
async def test_fetch_block_children_recurses_for_nested(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/parent/children?page_size=100",
        json={
            "results": [
                {
                    "id": "outer",
                    "type": "toggle",
                    "has_children": True,
                    "toggle": {"rich_text": []},
                }
            ],
            "next_cursor": None,
            "has_more": False,
        },
    )
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/outer/children?page_size=100",
        json={
            "results": [
                {
                    "id": "inner",
                    "type": "paragraph",
                    "has_children": False,
                    "paragraph": {"rich_text": []},
                }
            ],
            "next_cursor": None,
            "has_more": False,
        },
    )

    async with AsyncNotionClient(token="t") as client:
        blocks = await fetch_block_children(client, "parent")

    assert blocks[0]["id"] == "outer"
    assert blocks[0]["children"][0]["id"] == "inner"


@pytest.mark.asyncio
async def test_query_database_paginates(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        method="POST",
        url="https://api.notion.com/v1/databases/db1/query",
        json={
            "results": [{"id": "i1", "properties": {}}],
            "next_cursor": "c",
            "has_more": True,
        },
    )
    httpx_mock.add_response(
        method="POST",
        url="https://api.notion.com/v1/databases/db1/query",
        json={
            "results": [{"id": "i2", "properties": {}}],
            "next_cursor": None,
            "has_more": False,
        },
    )

    async with AsyncNotionClient(token="t") as client:
        items = await query_database(client, "db1")

    assert [i["id"] for i in items] == ["i1", "i2"]
