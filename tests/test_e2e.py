from pathlib import Path

import pytest
from pytest_httpx import HTTPXMock

from notion_extractor.extract.pipeline import run_extraction
from notion_extractor.notion.client import AsyncNotionClient
from notion_extractor.progress import EventBus


def _rich(text: str) -> list[dict]:
    return [
        {
            "type": "text",
            "text": {"content": text, "link": None},
            "plain_text": text,
            "href": None,
            "annotations": {
                "bold": False,
                "italic": False,
                "strikethrough": False,
                "underline": False,
                "code": False,
                "color": "default",
            },
        }
    ]


@pytest.mark.asyncio
async def test_e2e_vault_structure(tmp_path: Path, httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        url="https://api.notion.com/v1/pages/root",
        json={
            "id": "root",
            "url": "https://notion.so/root",
            "created_time": "2026-01-01T00:00:00.000Z",
            "last_edited_time": "2026-02-01T00:00:00.000Z",
            "properties": {"title": {"type": "title", "title": _rich("Notas")}},
        },
    )
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/root/children?page_size=100",
        json={
            "results": [
                {
                    "id": "sub",
                    "type": "child_page",
                    "has_children": False,
                    "child_page": {"title": "Reunião"},
                },
                {
                    "id": "db",
                    "type": "child_database",
                    "has_children": False,
                    "child_database": {"title": "Tarefas"},
                },
                {
                    "id": "img",
                    "type": "image",
                    "has_children": False,
                    "image": {
                        "type": "file",
                        "file": {"url": "https://prod-files.s3/x.png"},
                        "caption": [],
                    },
                },
            ],
            "next_cursor": None,
            "has_more": False,
        },
    )
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/sub/children?page_size=100",
        json={
            "results": [
                {
                    "id": "p1",
                    "type": "paragraph",
                    "has_children": False,
                    "paragraph": {"rich_text": _rich("ata da reunião")},
                }
            ],
            "next_cursor": None,
            "has_more": False,
        },
    )
    httpx_mock.add_response(
        method="POST",
        url="https://api.notion.com/v1/databases/db/query",
        json={
            "results": [
                {
                    "id": "row",
                    "url": "https://notion.so/row",
                    "created_time": "2026-01-01T00:00:00.000Z",
                    "last_edited_time": "2026-02-01T00:00:00.000Z",
                    "properties": {"Name": {"type": "title", "title": _rich("Fazer X")}},
                }
            ],
            "next_cursor": None,
            "has_more": False,
        },
    )
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/row/children?page_size=100",
        json={"results": [], "next_cursor": None, "has_more": False},
    )
    httpx_mock.add_response(
        url="https://prod-files.s3/x.png",
        content=b"PNGBYTES",
    )

    bus = EventBus()
    async with AsyncNotionClient(token="t") as client:
        result = await run_extraction(
            client=client,
            bus=bus,
            output_dir=tmp_path,
            root_selection=[("root", "page")],
        )

    assert (tmp_path / "Notas.md").exists()
    assert (tmp_path / "Notas" / "Reunião.md").exists()
    assert (tmp_path / "Notas" / "Tarefas.md").exists()
    assert (tmp_path / "Notas" / "Tarefas" / "Fazer X.md").exists()
    assert (tmp_path / "_report.md").exists()
    assert any((tmp_path / "assets").iterdir())

    notas = (tmp_path / "Notas.md").read_text()
    assert "[[Reunião]]" in notas
    assert "[[Tarefas]]" in notas
    assert "assets/" in notas

    assert result.pages_extracted >= 2
    assert result.items_extracted == 1
    assert result.attachments_downloaded == 1
