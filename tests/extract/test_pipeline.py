from pathlib import Path

import pytest
from pytest_httpx import HTTPXMock

from notion_extractor.extract.pipeline import run_extraction
from notion_extractor.notion.client import AsyncNotionClient
from notion_extractor.progress import EventBus


def _rich(text: str) -> list[dict]:
    return [{
        "type": "text",
        "text": {"content": text, "link": None},
        "plain_text": text,
        "href": None,
        "annotations": {
            "bold": False, "italic": False, "strikethrough": False,
            "underline": False, "code": False, "color": "default",
        },
    }]


@pytest.mark.asyncio
async def test_extract_simple_page_writes_md(
    tmp_path: Path, httpx_mock: HTTPXMock
) -> None:
    httpx_mock.add_response(
        url="https://api.notion.com/v1/pages/p1",
        json={
            "id": "p1",
            "properties": {
                "title": {"type": "title", "title": _rich("Hello")},
            },
        },
    )
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/p1/children?page_size=100",
        json={
            "results": [
                {
                    "id": "b1",
                    "type": "paragraph",
                    "has_children": False,
                    "paragraph": {"rich_text": _rich("world")},
                }
            ],
            "next_cursor": None,
            "has_more": False,
        },
    )

    bus = EventBus()
    async with AsyncNotionClient(token="t") as client:
        result = await run_extraction(
            client=client,
            bus=bus,
            output_dir=tmp_path,
            root_selection=[("p1", "page")],
        )

    out_file = tmp_path / "Hello.md"
    assert out_file.exists()
    assert "world" in out_file.read_text()
    assert result.pages_extracted == 1


@pytest.mark.asyncio
async def test_extract_two_pages_with_internal_link_resolves_wikilink(
    tmp_path: Path, httpx_mock: HTTPXMock
) -> None:
    httpx_mock.add_response(
        url="https://api.notion.com/v1/pages/p1",
        json={
            "id": "p1",
            "properties": {
                "title": {"type": "title", "title": _rich("Alpha")},
            },
        },
    )
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/p1/children?page_size=100",
        json={
            "results": [
                {
                    "id": "lb",
                    "type": "link_to_page",
                    "has_children": False,
                    "link_to_page": {"type": "page_id", "page_id": "cp"},
                },
                {
                    "id": "cp",
                    "type": "child_page",
                    "has_children": False,
                    "child_page": {"title": "Beta"},
                },
            ],
            "next_cursor": None,
            "has_more": False,
        },
    )
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/cp/children?page_size=100",
        json={"results": [], "next_cursor": None, "has_more": False},
    )

    bus = EventBus()
    async with AsyncNotionClient(token="t") as client:
        await run_extraction(
            client=client,
            bus=bus,
            output_dir=tmp_path,
            root_selection=[("p1", "page")],
        )

    alpha = (tmp_path / "Alpha.md").read_text()
    assert "[[Beta]]" in alpha
