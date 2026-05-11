from pathlib import Path

import pytest
from pytest_httpx import HTTPXMock

from notion_extractor.extract.attachments import AttachmentDownloader


@pytest.mark.asyncio
async def test_download_writes_file_with_hashed_name(
    tmp_path: Path, httpx_mock: HTTPXMock
) -> None:
    httpx_mock.add_response(
        url="https://prod-files.s3.amazonaws.com/folder/image.png",
        content=b"PNGDATA",
    )

    downloader = AttachmentDownloader(assets_dir=tmp_path / "assets")
    try:
        local = await downloader.download(
            "https://prod-files.s3.amazonaws.com/folder/image.png"
        )

        assert local.parent == tmp_path / "assets"
        assert local.name.endswith("-image.png")
        assert local.read_bytes() == b"PNGDATA"
    finally:
        await downloader.close()


@pytest.mark.asyncio
async def test_download_deduplicates_same_url(
    tmp_path: Path, httpx_mock: HTTPXMock
) -> None:
    httpx_mock.add_response(
        url="https://prod-files.s3.amazonaws.com/x.png",
        content=b"DATA",
    )
    downloader = AttachmentDownloader(assets_dir=tmp_path / "assets")
    try:
        first = await downloader.download("https://prod-files.s3.amazonaws.com/x.png")
        second = await downloader.download("https://prod-files.s3.amazonaws.com/x.png")
        assert first == second
        assert len(httpx_mock.get_requests()) == 1
    finally:
        await downloader.close()


@pytest.mark.asyncio
async def test_download_strips_query_string_from_basename(
    tmp_path: Path, httpx_mock: HTTPXMock
) -> None:
    httpx_mock.add_response(
        url="https://prod-files.s3.amazonaws.com/x.png?sig=abc",
        content=b"D",
    )
    downloader = AttachmentDownloader(assets_dir=tmp_path / "assets")
    try:
        local = await downloader.download(
            "https://prod-files.s3.amazonaws.com/x.png?sig=abc"
        )
        assert local.name.endswith("-x.png")
    finally:
        await downloader.close()
