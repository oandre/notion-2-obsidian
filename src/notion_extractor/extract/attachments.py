import asyncio
import hashlib
from pathlib import Path
from urllib.parse import urlparse

import httpx


class AttachmentDownloader:
    def __init__(
        self,
        assets_dir: Path,
        *,
        concurrency: int = 8,
        timeout: float = 60.0,
    ) -> None:
        self._assets_dir = assets_dir
        self._sem = asyncio.Semaphore(concurrency)
        self._cache: dict[str, Path] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._http = httpx.AsyncClient(timeout=timeout)

    async def close(self) -> None:
        await self._http.aclose()

    async def download(self, url: str) -> Path:
        if url in self._cache:
            return self._cache[url]
        lock = self._locks.setdefault(url, asyncio.Lock())
        async with lock:
            if url in self._cache:
                return self._cache[url]
            local = self._target_path(url)
            self._assets_dir.mkdir(parents=True, exist_ok=True)
            async with self._sem:
                response = await self._http.get(url)
                response.raise_for_status()
                local.write_bytes(response.content)
            self._cache[url] = local
            return local

    def _target_path(self, url: str) -> Path:
        h = hashlib.sha1(url.encode("utf-8")).hexdigest()[:8]
        parsed = urlparse(url)
        basename = parsed.path.rsplit("/", 1)[-1] or "file"
        return self._assets_dir / f"{h}-{basename}"
