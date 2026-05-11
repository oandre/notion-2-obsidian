import asyncio
from collections.abc import Awaitable, Callable
from typing import Any, Self

import httpx

NOTION_API_BASE = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"


class AsyncNotionClient:
    def __init__(
        self,
        token: str,
        *,
        concurrency: int = 3,
        max_retries: int = 5,
        backoff_base: float = 0.5,
        timeout: float = 30.0,
    ) -> None:
        self._token = token
        self._max_retries = max_retries
        self._backoff_base = backoff_base
        self._sem = asyncio.Semaphore(concurrency)
        self._http = httpx.AsyncClient(
            base_url=NOTION_API_BASE,
            timeout=timeout,
            headers={
                "Authorization": f"Bearer {token}",
                "Notion-Version": NOTION_VERSION,
                "Content-Type": "application/json",
            },
        )

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_exc: object) -> None:
        await self._http.aclose()

    async def _with_limit[T](self, call: Callable[[], Awaitable[T]]) -> T:
        async with self._sem:
            return await call()

    async def _request(
        self, method: str, path: str, *, json: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        attempt = 0
        while True:
            response = await self._with_limit(
                lambda: self._http.request(method, path, json=json)
            )
            if response.status_code < 400:
                return response.json()
            if (
                response.status_code in (429, 500, 502, 503, 504)
                and attempt < self._max_retries
            ):
                retry_after = float(response.headers.get("Retry-After", "0") or 0)
                wait = max(retry_after, self._backoff_base * (2**attempt))
                await asyncio.sleep(wait)
                attempt += 1
                continue
            response.raise_for_status()
            raise RuntimeError("unreachable")

    async def get(self, path: str) -> dict[str, Any]:
        return await self._request("GET", path)

    async def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", path, json=body)
