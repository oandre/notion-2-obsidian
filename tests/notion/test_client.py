import asyncio

import httpx
import pytest
from pytest_httpx import HTTPXMock

from notion_extractor.notion.client import AsyncNotionClient


@pytest.mark.asyncio
async def test_get_sets_auth_and_version_headers(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="https://api.notion.com/v1/pages/abc",
        json={"id": "abc"},
    )

    async with AsyncNotionClient(token="secret_xyz") as client:
        result = await client.get("/pages/abc")

    assert result == {"id": "abc"}
    request = httpx_mock.get_requests()[0]
    assert request.headers["Authorization"] == "Bearer secret_xyz"
    assert request.headers["Notion-Version"] == "2022-06-28"


@pytest.mark.asyncio
async def test_retries_on_429(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(status_code=429, headers={"Retry-After": "0"})
    httpx_mock.add_response(json={"ok": True})

    async with AsyncNotionClient(token="t", max_retries=3, backoff_base=0.0) as client:
        result = await client.get("/x")

    assert result == {"ok": True}
    assert len(httpx_mock.get_requests()) == 2


@pytest.mark.asyncio
async def test_rate_limiter_caps_concurrency() -> None:
    semaphore_size = 3
    concurrent = 0
    max_seen = 0

    async def fake_call() -> None:
        nonlocal concurrent, max_seen
        concurrent += 1
        max_seen = max(max_seen, concurrent)
        await asyncio.sleep(0.01)
        concurrent -= 1

    async with AsyncNotionClient(token="t", concurrency=semaphore_size) as client:
        await asyncio.gather(*(client._with_limit(fake_call) for _ in range(20)))

    assert max_seen <= semaphore_size


@pytest.mark.asyncio
async def test_raises_on_persistent_5xx(httpx_mock: HTTPXMock) -> None:
    # max_retries=3 means 1 initial + 3 retries = 4 attempts.
    for _ in range(4):
        httpx_mock.add_response(status_code=503)

    async with AsyncNotionClient(token="t", max_retries=3, backoff_base=0.0) as client:
        with pytest.raises(httpx.HTTPStatusError):
            await client.get("/x")
