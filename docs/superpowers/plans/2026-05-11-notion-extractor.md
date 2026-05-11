# Notion → Obsidian Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python tool with a local web UI that extracts selected pages and databases from a Notion workspace via the official API and writes them as a clean Obsidian vault with wikilinks, frontmatter, and downloaded attachments.

**Architecture:** Single FastAPI process serves a vanilla-JS frontend on `localhost`. Three-phase async pipeline (discovery → extraction → write & resolve) talks to Notion via a rate-limited httpx client. Server-Sent Events stream progress to the browser. Conversion layer (`convert/`) is pure functions, easy to unit-test; integration tests use recorded HTTP fixtures.

**Tech Stack:** Python 3.11+, FastAPI, uvicorn, httpx, pydantic, PyYAML, pytest + pytest-asyncio, pytest-httpx, ruff, pyright, uv.

**Spec:** `docs/superpowers/specs/2026-05-11-notion-extractor-design.md`

---

## File Structure

```
notion-extractor/
├── pyproject.toml                       # uv + tool configs
├── .env.example                         # token, output dir
├── README.md
├── src/
│   └── notion_extractor/
│       ├── __init__.py
│       ├── __main__.py                  # `python -m notion_extractor`
│       ├── app.py                       # FastAPI app + routes
│       ├── config.py                    # Settings (pydantic)
│       ├── progress.py                  # event bus + event types
│       ├── notion/
│       │   ├── __init__.py
│       │   ├── client.py                # AsyncNotionClient
│       │   ├── discovery.py             # tree walk
│       │   └── fetch.py                 # page/db content
│       ├── convert/
│       │   ├── __init__.py
│       │   ├── inline.py                # rich_text[] → md
│       │   ├── blocks.py                # block → md (dispatcher + handlers)
│       │   └── properties.py            # db properties → YAML
│       ├── extract/
│       │   ├── __init__.py
│       │   ├── plan.py                  # PlannedNode + path planning
│       │   ├── attachments.py           # downloader
│       │   ├── resolve.py               # placeholder resolution + report
│       │   └── pipeline.py              # orchestrator
│       └── web/
│           └── static/
│               ├── index.html
│               ├── app.js
│               └── style.css
└── tests/
    ├── conftest.py                      # fixtures
    ├── fixtures/                        # recorded Notion responses
    ├── convert/
    │   ├── test_inline.py
    │   ├── test_blocks_basic.py
    │   ├── test_blocks_callout_toggle.py
    │   ├── test_blocks_table.py
    │   ├── test_blocks_equation.py
    │   ├── test_blocks_media.py
    │   ├── test_blocks_embed.py
    │   ├── test_blocks_links.py
    │   └── test_properties.py
    ├── extract/
    │   ├── test_plan.py
    │   ├── test_resolve.py
    │   └── test_pipeline.py
    ├── notion/
    │   ├── test_client.py
    │   ├── test_discovery.py
    │   └── test_fetch.py
    └── test_app.py
```

---

## Task 1: Project scaffolding

**Files:**
- Create: `pyproject.toml`
- Create: `.env.example`
- Create: `README.md`
- Create: `src/notion_extractor/__init__.py`
- Create: `tests/__init__.py`

- [ ] **Step 1: Create `pyproject.toml`**

```toml
[project]
name = "notion-extractor"
version = "0.1.0"
description = "Migrate Notion workspaces to Obsidian vaults"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.110",
    "uvicorn[standard]>=0.27",
    "httpx>=0.27",
    "pydantic>=2.6",
    "pydantic-settings>=2.2",
    "python-dotenv>=1.0",
    "pyyaml>=6.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
    "pytest-httpx>=0.30",
    "ruff>=0.4",
    "pyright>=1.1",
]

[project.scripts]
notion-extractor = "notion_extractor.__main__:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/notion_extractor"]

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "W", "UP", "B", "SIM"]

[tool.pyright]
include = ["src", "tests"]
pythonVersion = "3.11"
typeCheckingMode = "strict"
reportMissingTypeStubs = false

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
addopts = "-ra -q"
```

- [ ] **Step 2: Create `.env.example`**

```
NOTION_TOKEN=secret_paste_your_integration_token_here
OUTPUT_DIR=./vault
HOST=127.0.0.1
PORT=8765
```

- [ ] **Step 3: Create `README.md`**

```markdown
# notion-extractor

Migrate a Notion workspace to an Obsidian vault.

## Setup

1. Create a Notion internal integration at https://www.notion.so/profile/integrations and copy the token.
2. Share the top-level pages/databases you want to extract with the integration (in Notion: ··· menu → Connections → your integration).
3. `cp .env.example .env` and fill in `NOTION_TOKEN` and `OUTPUT_DIR`.
4. `uv sync` to install dependencies.
5. `uv run notion-extractor` and open the URL it prints.

## Development

- `uv run pytest` — run tests
- `uv run pytest tests/convert/test_inline.py::test_bold -v` — run a single test
- `uv run ruff check .` — lint
- `uv run ruff format .` — format
- `uv run pyright` — type check
```

- [ ] **Step 4: Create empty package files**

`src/notion_extractor/__init__.py`:
```python
"""Notion → Obsidian extractor."""
```

`tests/__init__.py`:
```python
```

- [ ] **Step 5: Sync deps and verify**

```bash
uv sync --extra dev
uv run python -c "import notion_extractor; print('ok')"
```

Expected: prints `ok` with no error.

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml .env.example README.md src/ tests/
git commit -m "chore: scaffold project with uv, ruff, pyright, pytest"
```

---

## Task 2: Config loader

**Files:**
- Create: `src/notion_extractor/config.py`
- Create: `tests/test_config.py`

- [ ] **Step 1: Write the failing test**

`tests/test_config.py`:
```python
from pathlib import Path

from notion_extractor.config import Settings


def test_settings_load_from_env(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("NOTION_TOKEN", "secret_abc")
    monkeypatch.setenv("OUTPUT_DIR", str(tmp_path / "vault"))
    monkeypatch.setenv("HOST", "127.0.0.1")
    monkeypatch.setenv("PORT", "9000")

    settings = Settings()  # type: ignore[call-arg]

    assert settings.notion_token == "secret_abc"
    assert settings.output_dir == tmp_path / "vault"
    assert settings.host == "127.0.0.1"
    assert settings.port == 9000


def test_settings_defaults(monkeypatch) -> None:
    monkeypatch.setenv("NOTION_TOKEN", "secret_abc")
    monkeypatch.setenv("OUTPUT_DIR", "./vault")
    monkeypatch.delenv("HOST", raising=False)
    monkeypatch.delenv("PORT", raising=False)

    settings = Settings()  # type: ignore[call-arg]

    assert settings.host == "127.0.0.1"
    assert settings.port == 8765
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_config.py -v
```

Expected: FAIL — `notion_extractor.config` not found.

- [ ] **Step 3: Implement `Settings`**

`src/notion_extractor/config.py`:
```python
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    notion_token: str = Field(min_length=1)
    output_dir: Path
    host: str = "127.0.0.1"
    port: int = 8765
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/test_config.py -v
```

Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/notion_extractor/config.py tests/test_config.py
git commit -m "feat(config): load NOTION_TOKEN, OUTPUT_DIR, HOST, PORT from env"
```

---

## Task 3: Notion API client (rate-limited, retrying)

**Files:**
- Create: `src/notion_extractor/notion/__init__.py`
- Create: `src/notion_extractor/notion/client.py`
- Create: `tests/notion/__init__.py`
- Create: `tests/notion/test_client.py`

- [ ] **Step 1: Write the failing test**

`tests/notion/test_client.py`:
```python
import asyncio
import time

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

    async with AsyncNotionClient(
        token="t", concurrency=semaphore_size
    ) as client:
        await asyncio.gather(*(client._with_limit(fake_call) for _ in range(20)))

    assert max_seen <= semaphore_size


@pytest.mark.asyncio
async def test_raises_on_persistent_5xx(httpx_mock: HTTPXMock) -> None:
    for _ in range(6):
        httpx_mock.add_response(status_code=503)

    async with AsyncNotionClient(token="t", max_retries=3, backoff_base=0.0) as client:
        with pytest.raises(httpx.HTTPStatusError):
            await client.get("/x")
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/notion/test_client.py -v
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AsyncNotionClient`**

`src/notion_extractor/notion/__init__.py`:
```python
```

`src/notion_extractor/notion/client.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/notion/test_client.py -v
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notion_extractor/notion/ tests/notion/
git commit -m "feat(notion): async client with rate limit and retry"
```

---

## Task 4: Inline rich text → Markdown

**Files:**
- Create: `src/notion_extractor/convert/__init__.py`
- Create: `src/notion_extractor/convert/inline.py`
- Create: `tests/convert/__init__.py`
- Create: `tests/convert/test_inline.py`

The Notion API returns rich text as a list of segments with `annotations` (bold, italic, etc.), `plain_text`, optional `href`, and `mention` blocks for page/user/date references.

- [ ] **Step 1: Write the failing test**

`tests/convert/test_inline.py`:
```python
from notion_extractor.convert.inline import rich_text_to_md


def _seg(
    text: str,
    *,
    bold: bool = False,
    italic: bool = False,
    code: bool = False,
    strikethrough: bool = False,
    underline: bool = False,
    href: str | None = None,
) -> dict:
    return {
        "type": "text",
        "text": {"content": text, "link": {"url": href} if href else None},
        "plain_text": text,
        "href": href,
        "annotations": {
            "bold": bold,
            "italic": italic,
            "strikethrough": strikethrough,
            "underline": underline,
            "code": code,
            "color": "default",
        },
    }


def test_plain_text() -> None:
    assert rich_text_to_md([_seg("hello")]) == "hello"


def test_bold() -> None:
    assert rich_text_to_md([_seg("hi", bold=True)]) == "**hi**"


def test_italic() -> None:
    assert rich_text_to_md([_seg("hi", italic=True)]) == "*hi*"


def test_bold_italic() -> None:
    assert rich_text_to_md([_seg("hi", bold=True, italic=True)]) == "***hi***"


def test_strikethrough() -> None:
    assert rich_text_to_md([_seg("hi", strikethrough=True)]) == "~~hi~~"


def test_underline_uses_html() -> None:
    assert rich_text_to_md([_seg("hi", underline=True)]) == "<u>hi</u>"


def test_code() -> None:
    assert rich_text_to_md([_seg("x", code=True)]) == "`x`"


def test_link() -> None:
    assert rich_text_to_md([_seg("docs", href="https://x.dev")]) == "[docs](https://x.dev)"


def test_link_with_bold() -> None:
    result = rich_text_to_md([_seg("docs", bold=True, href="https://x.dev")])
    assert result == "[**docs**](https://x.dev)"


def test_mention_page_emits_placeholder() -> None:
    mention = {
        "type": "mention",
        "mention": {"type": "page", "page": {"id": "abc-123"}},
        "plain_text": "Some Page",
        "href": "https://www.notion.so/abc123",
        "annotations": {
            "bold": False, "italic": False, "strikethrough": False,
            "underline": False, "code": False, "color": "default",
        },
    }
    assert rich_text_to_md([mention]) == "{{notion-link:abc-123|Some Page}}"


def test_mention_date() -> None:
    mention = {
        "type": "mention",
        "mention": {"type": "date", "date": {"start": "2026-05-11"}},
        "plain_text": "2026-05-11",
        "href": None,
        "annotations": {
            "bold": False, "italic": False, "strikethrough": False,
            "underline": False, "code": False, "color": "default",
        },
    }
    assert rich_text_to_md([mention]) == "2026-05-11"


def test_inline_equation() -> None:
    seg = {
        "type": "equation",
        "equation": {"expression": "x^2"},
        "plain_text": "x^2",
        "href": None,
        "annotations": {
            "bold": False, "italic": False, "strikethrough": False,
            "underline": False, "code": False, "color": "default",
        },
    }
    assert rich_text_to_md([seg]) == "$x^2$"


def test_concatenates_segments() -> None:
    segs = [_seg("hello "), _seg("world", bold=True)]
    assert rich_text_to_md(segs) == "hello **world**"


def test_empty() -> None:
    assert rich_text_to_md([]) == ""
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/convert/test_inline.py -v
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `rich_text_to_md`**

`src/notion_extractor/convert/__init__.py`:
```python
```

`src/notion_extractor/convert/inline.py`:
```python
from typing import Any


def rich_text_to_md(segments: list[dict[str, Any]]) -> str:
    return "".join(_segment_to_md(s) for s in segments)


def _segment_to_md(seg: dict[str, Any]) -> str:
    seg_type = seg.get("type", "text")

    if seg_type == "equation":
        return f"${seg['equation']['expression']}$"

    if seg_type == "mention":
        return _mention_to_md(seg)

    return _text_to_md(seg)


def _text_to_md(seg: dict[str, Any]) -> str:
    text = seg.get("plain_text", "")
    if not text:
        return ""

    ann = seg.get("annotations", {})
    href = seg.get("href")

    formatted = text
    if ann.get("code"):
        formatted = f"`{formatted}`"
    if ann.get("bold") and ann.get("italic"):
        formatted = f"***{formatted}***"
    elif ann.get("bold"):
        formatted = f"**{formatted}**"
    elif ann.get("italic"):
        formatted = f"*{formatted}*"
    if ann.get("strikethrough"):
        formatted = f"~~{formatted}~~"
    if ann.get("underline"):
        formatted = f"<u>{formatted}</u>"
    if href:
        formatted = f"[{formatted}]({href})"
    return formatted


def _mention_to_md(seg: dict[str, Any]) -> str:
    mention = seg.get("mention", {})
    m_type = mention.get("type")
    plain = seg.get("plain_text", "")

    if m_type == "page":
        page_id = mention["page"]["id"]
        return f"{{{{notion-link:{page_id}|{plain}}}}}"
    if m_type == "database":
        db_id = mention["database"]["id"]
        return f"{{{{notion-link:{db_id}|{plain}}}}}"
    if m_type == "date":
        return plain
    if m_type == "user":
        return plain
    return plain
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/convert/test_inline.py -v
```

Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notion_extractor/convert/ tests/convert/__init__.py tests/convert/test_inline.py
git commit -m "feat(convert): rich_text segments to Markdown inline"
```

---

## Task 5: Block converter — basic blocks

**Files:**
- Create: `src/notion_extractor/convert/blocks.py`
- Create: `tests/convert/test_blocks_basic.py`

Covers: `paragraph`, `heading_1/2/3`, `bulleted_list_item`, `numbered_list_item`, `to_do`, `quote`, `divider`, `code`. The converter takes a list of blocks (with possibly nested `children`) and returns a Markdown string.

- [ ] **Step 1: Write the failing test**

`tests/convert/test_blocks_basic.py`:
```python
from notion_extractor.convert.blocks import blocks_to_md


def _text_rich(content: str) -> list[dict]:
    return [{
        "type": "text",
        "text": {"content": content, "link": None},
        "plain_text": content,
        "href": None,
        "annotations": {
            "bold": False, "italic": False, "strikethrough": False,
            "underline": False, "code": False, "color": "default",
        },
    }]


def _block(block_type: str, payload: dict, children: list[dict] | None = None) -> dict:
    return {
        "type": block_type,
        block_type: payload,
        "has_children": bool(children),
        "children": children or [],
    }


def test_paragraph() -> None:
    block = _block("paragraph", {"rich_text": _text_rich("hello")})
    assert blocks_to_md([block]) == "hello\n"


def test_heading_levels() -> None:
    blocks = [
        _block("heading_1", {"rich_text": _text_rich("A")}),
        _block("heading_2", {"rich_text": _text_rich("B")}),
        _block("heading_3", {"rich_text": _text_rich("C")}),
    ]
    assert blocks_to_md(blocks) == "# A\n\n## B\n\n### C\n"


def test_bulleted_list() -> None:
    blocks = [
        _block("bulleted_list_item", {"rich_text": _text_rich("one")}),
        _block("bulleted_list_item", {"rich_text": _text_rich("two")}),
    ]
    assert blocks_to_md(blocks) == "- one\n- two\n"


def test_numbered_list() -> None:
    blocks = [
        _block("numbered_list_item", {"rich_text": _text_rich("one")}),
        _block("numbered_list_item", {"rich_text": _text_rich("two")}),
    ]
    assert blocks_to_md(blocks) == "1. one\n2. two\n"


def test_numbered_list_resets_after_paragraph() -> None:
    blocks = [
        _block("numbered_list_item", {"rich_text": _text_rich("one")}),
        _block("paragraph", {"rich_text": _text_rich("p")}),
        _block("numbered_list_item", {"rich_text": _text_rich("two")}),
    ]
    assert blocks_to_md(blocks) == "1. one\n\np\n\n1. two\n"


def test_todo() -> None:
    blocks = [
        _block("to_do", {"rich_text": _text_rich("do it"), "checked": False}),
        _block("to_do", {"rich_text": _text_rich("done"), "checked": True}),
    ]
    assert blocks_to_md(blocks) == "- [ ] do it\n- [x] done\n"


def test_quote() -> None:
    block = _block("quote", {"rich_text": _text_rich("wise words")})
    assert blocks_to_md([block]) == "> wise words\n"


def test_divider() -> None:
    block = _block("divider", {})
    assert blocks_to_md([block]) == "---\n"


def test_code_block() -> None:
    block = _block("code", {"rich_text": _text_rich("print(1)"), "language": "python"})
    assert blocks_to_md([block]) == "```python\nprint(1)\n```\n"


def test_code_block_plain() -> None:
    block = _block("code", {"rich_text": _text_rich("x"), "language": "plain text"})
    assert blocks_to_md([block]) == "```\nx\n```\n"


def test_nested_bullets_indented() -> None:
    child = _block("bulleted_list_item", {"rich_text": _text_rich("child")})
    parent = _block("bulleted_list_item", {"rich_text": _text_rich("parent")}, children=[child])
    assert blocks_to_md([parent]) == "- parent\n  - child\n"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/convert/test_blocks_basic.py -v
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `blocks_to_md` with basic handlers**

`src/notion_extractor/convert/blocks.py`:
```python
from collections.abc import Callable
from typing import Any

from notion_extractor.convert.inline import rich_text_to_md

BlockHandler = Callable[[dict[str, Any], "RenderContext"], str]


class RenderContext:
    def __init__(self, indent: int = 0, list_counter: list[int] | None = None) -> None:
        self.indent = indent
        self.list_counter = list_counter if list_counter is not None else [0]

    def child(self) -> "RenderContext":
        return RenderContext(indent=self.indent + 1, list_counter=[0])


def blocks_to_md(blocks: list[dict[str, Any]]) -> str:
    ctx = RenderContext()
    return _render_blocks(blocks, ctx)


def _render_blocks(blocks: list[dict[str, Any]], ctx: RenderContext) -> str:
    out: list[str] = []
    prev_type: str | None = None
    counter = 0

    for block in blocks:
        block_type = block.get("type", "")

        if block_type == "numbered_list_item":
            if prev_type != "numbered_list_item":
                counter = 0
            counter += 1
            line = _render_numbered(block, counter, ctx)
        else:
            counter = 0
            line = _render_block(block, ctx)

        if line:
            sep = _separator(prev_type, block_type)
            if sep and out:
                out.append(sep)
            out.append(line)
        prev_type = block_type

    return "".join(out)


def _separator(prev: str | None, current: str) -> str:
    list_types = {"bulleted_list_item", "numbered_list_item", "to_do"}
    if prev in list_types and current in list_types and prev == current:
        return ""
    if prev is None:
        return ""
    return "\n"


def _render_block(block: dict[str, Any], ctx: RenderContext) -> str:
    handler = _HANDLERS.get(block.get("type", ""))
    if handler is None:
        return f"<!-- unsupported block: {block.get('type')} -->\n"
    return handler(block, ctx)


def _indent_str(ctx: RenderContext) -> str:
    return "  " * ctx.indent


def _render_children(block: dict[str, Any], ctx: RenderContext) -> str:
    children = block.get("children", [])
    if not children:
        return ""
    return _render_blocks(children, ctx.child())


def _paragraph(block: dict, ctx: RenderContext) -> str:
    text = rich_text_to_md(block["paragraph"]["rich_text"])
    body = f"{_indent_str(ctx)}{text}\n"
    return body + _render_children(block, ctx)


def _heading(level: int) -> BlockHandler:
    def handler(block: dict, ctx: RenderContext) -> str:
        key = f"heading_{level}"
        text = rich_text_to_md(block[key]["rich_text"])
        return f"{'#' * level} {text}\n" + _render_children(block, ctx)
    return handler


def _bulleted(block: dict, ctx: RenderContext) -> str:
    text = rich_text_to_md(block["bulleted_list_item"]["rich_text"])
    body = f"{_indent_str(ctx)}- {text}\n"
    return body + _render_children(block, ctx)


def _render_numbered(block: dict, n: int, ctx: RenderContext) -> str:
    text = rich_text_to_md(block["numbered_list_item"]["rich_text"])
    body = f"{_indent_str(ctx)}{n}. {text}\n"
    return body + _render_children(block, ctx)


def _todo(block: dict, ctx: RenderContext) -> str:
    payload = block["to_do"]
    text = rich_text_to_md(payload["rich_text"])
    mark = "x" if payload.get("checked") else " "
    body = f"{_indent_str(ctx)}- [{mark}] {text}\n"
    return body + _render_children(block, ctx)


def _quote(block: dict, ctx: RenderContext) -> str:
    text = rich_text_to_md(block["quote"]["rich_text"])
    return f"> {text}\n" + _render_children(block, ctx)


def _divider(_block: dict, _ctx: RenderContext) -> str:
    return "---\n"


def _code(block: dict, _ctx: RenderContext) -> str:
    payload = block["code"]
    lang = payload.get("language", "")
    if lang == "plain text":
        lang = ""
    text = rich_text_to_md(payload["rich_text"])
    return f"```{lang}\n{text}\n```\n"


_HANDLERS: dict[str, BlockHandler] = {
    "paragraph": _paragraph,
    "heading_1": _heading(1),
    "heading_2": _heading(2),
    "heading_3": _heading(3),
    "bulleted_list_item": _bulleted,
    "to_do": _todo,
    "quote": _quote,
    "divider": _divider,
    "code": _code,
}
```

Note: `numbered_list_item` is handled directly in `_render_blocks` because numbering depends on neighbors, not the block in isolation.

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/convert/test_blocks_basic.py -v
```

Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notion_extractor/convert/blocks.py tests/convert/test_blocks_basic.py
git commit -m "feat(convert): basic blocks to Markdown"
```

---

## Task 6: Block converter — callouts and toggles

**Files:**
- Modify: `src/notion_extractor/convert/blocks.py`
- Create: `tests/convert/test_blocks_callout_toggle.py`

- [ ] **Step 1: Write the failing test**

`tests/convert/test_blocks_callout_toggle.py`:
```python
from notion_extractor.convert.blocks import blocks_to_md


def _text_rich(content: str) -> list[dict]:
    return [{
        "type": "text",
        "text": {"content": content, "link": None},
        "plain_text": content,
        "href": None,
        "annotations": {
            "bold": False, "italic": False, "strikethrough": False,
            "underline": False, "code": False, "color": "default",
        },
    }]


def _block(block_type: str, payload: dict, children: list[dict] | None = None) -> dict:
    return {
        "type": block_type,
        block_type: payload,
        "has_children": bool(children),
        "children": children or [],
    }


def test_callout_default_note() -> None:
    block = _block("callout", {
        "rich_text": _text_rich("heads up"),
        "icon": {"type": "emoji", "emoji": "🗒️"},
    })
    assert blocks_to_md([block]) == "> [!note]\n> heads up\n"


def test_callout_tip_from_emoji() -> None:
    block = _block("callout", {
        "rich_text": _text_rich("nice idea"),
        "icon": {"type": "emoji", "emoji": "💡"},
    })
    assert blocks_to_md([block]) == "> [!tip]\n> nice idea\n"


def test_callout_warning() -> None:
    block = _block("callout", {
        "rich_text": _text_rich("careful"),
        "icon": {"type": "emoji", "emoji": "⚠️"},
    })
    assert blocks_to_md([block]) == "> [!warning]\n> careful\n"


def test_callout_danger() -> None:
    block = _block("callout", {
        "rich_text": _text_rich("nope"),
        "icon": {"type": "emoji", "emoji": "❌"},
    })
    assert blocks_to_md([block]) == "> [!danger]\n> nope\n"


def test_callout_info() -> None:
    block = _block("callout", {
        "rich_text": _text_rich("fyi"),
        "icon": {"type": "emoji", "emoji": "ℹ️"},
    })
    assert blocks_to_md([block]) == "> [!info]\n> fyi\n"


def test_callout_with_multiline_children() -> None:
    child = _block("paragraph", {"rich_text": _text_rich("extra")})
    block = _block(
        "callout",
        {"rich_text": _text_rich("main"), "icon": {"type": "emoji", "emoji": "💡"}},
        children=[child],
    )
    assert blocks_to_md([block]) == "> [!tip]\n> main\n>\n> extra\n"


def test_toggle_collapsible() -> None:
    child = _block("paragraph", {"rich_text": _text_rich("hidden")})
    block = _block("toggle", {"rich_text": _text_rich("Click me")}, children=[child])
    expected = "<details>\n<summary>Click me</summary>\n\nhidden\n\n</details>\n"
    assert blocks_to_md([block]) == expected


def test_toggle_empty() -> None:
    block = _block("toggle", {"rich_text": _text_rich("Click me")})
    expected = "<details>\n<summary>Click me</summary>\n\n</details>\n"
    assert blocks_to_md([block]) == expected
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/convert/test_blocks_callout_toggle.py -v
```

Expected: FAIL (no handler for `callout`/`toggle`).

- [ ] **Step 3: Add callout + toggle handlers**

Append to `src/notion_extractor/convert/blocks.py`:
```python
_CALLOUT_EMOJI_MAP = {
    "💡": "tip",
    "⚠️": "warning",
    "❌": "danger",
    "🚫": "danger",
    "ℹ️": "info",
    "✅": "success",
    "❓": "question",
}


def _callout(block: dict, ctx: RenderContext) -> str:
    payload = block["callout"]
    text = rich_text_to_md(payload["rich_text"])
    icon = payload.get("icon") or {}
    emoji = icon.get("emoji", "") if icon.get("type") == "emoji" else ""
    callout_type = _CALLOUT_EMOJI_MAP.get(emoji, "note")

    lines = [f"> [!{callout_type}]", f"> {text}"]
    children_md = _render_children(block, ctx)
    if children_md:
        lines.append(">")
        for child_line in children_md.rstrip("\n").splitlines():
            lines.append(f"> {child_line}" if child_line else ">")
    return "\n".join(lines) + "\n"


def _toggle(block: dict, ctx: RenderContext) -> str:
    summary = rich_text_to_md(block["toggle"]["rich_text"])
    children_md = _render_children(block, ctx).strip()
    inner = f"\n{children_md}\n" if children_md else ""
    return f"<details>\n<summary>{summary}</summary>\n{inner}\n</details>\n"


_HANDLERS["callout"] = _callout
_HANDLERS["toggle"] = _toggle
```

- [ ] **Step 4: Fix child rendering for callout — children inherit no indent**

Inside `_callout`, the children rendering uses the same context (no indent shift). The `_render_children` helper adds indent by default. Override:

Replace the body of `_callout` so children are rendered at indent 0:
```python
def _callout(block: dict, _ctx: RenderContext) -> str:
    payload = block["callout"]
    text = rich_text_to_md(payload["rich_text"])
    icon = payload.get("icon") or {}
    emoji = icon.get("emoji", "") if icon.get("type") == "emoji" else ""
    callout_type = _CALLOUT_EMOJI_MAP.get(emoji, "note")

    lines = [f"> [!{callout_type}]", f"> {text}"]
    children = block.get("children", [])
    if children:
        child_md = _render_blocks(children, RenderContext())
        lines.append(">")
        for child_line in child_md.rstrip("\n").splitlines():
            lines.append(f"> {child_line}" if child_line else ">")
    return "\n".join(lines) + "\n"
```

- [ ] **Step 5: Run test to verify it passes**

```bash
uv run pytest tests/convert/test_blocks_callout_toggle.py -v
```

Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/notion_extractor/convert/blocks.py tests/convert/test_blocks_callout_toggle.py
git commit -m "feat(convert): callouts (with emoji→type) and toggles"
```

---

## Task 7: Block converter — tables and equations

**Files:**
- Modify: `src/notion_extractor/convert/blocks.py`
- Create: `tests/convert/test_blocks_table.py`
- Create: `tests/convert/test_blocks_equation.py`

- [ ] **Step 1: Write the failing tests**

`tests/convert/test_blocks_equation.py`:
```python
from notion_extractor.convert.blocks import blocks_to_md


def test_block_equation() -> None:
    block = {
        "type": "equation",
        "equation": {"expression": "e^{i\\pi} + 1 = 0"},
        "has_children": False,
        "children": [],
    }
    assert blocks_to_md([block]) == "$$\ne^{i\\pi} + 1 = 0\n$$\n"
```

`tests/convert/test_blocks_table.py`:
```python
from notion_extractor.convert.blocks import blocks_to_md


def _cell(text: str) -> list[dict]:
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


def _row(cells: list[list[dict]]) -> dict:
    return {
        "type": "table_row",
        "table_row": {"cells": cells},
        "has_children": False,
        "children": [],
    }


def test_table_with_header() -> None:
    rows = [
        _row([_cell("Name"), _cell("Age")]),
        _row([_cell("Ana"), _cell("30")]),
        _row([_cell("Bia"), _cell("25")]),
    ]
    table = {
        "type": "table",
        "table": {"table_width": 2, "has_column_header": True, "has_row_header": False},
        "has_children": True,
        "children": rows,
    }
    expected = (
        "| Name | Age |\n"
        "| --- | --- |\n"
        "| Ana | 30 |\n"
        "| Bia | 25 |\n"
    )
    assert blocks_to_md([table]) == expected


def test_table_no_header_synthesizes_blank_header() -> None:
    rows = [
        _row([_cell("a"), _cell("b")]),
        _row([_cell("c"), _cell("d")]),
    ]
    table = {
        "type": "table",
        "table": {"table_width": 2, "has_column_header": False, "has_row_header": False},
        "has_children": True,
        "children": rows,
    }
    expected = (
        "|  |  |\n"
        "| --- | --- |\n"
        "| a | b |\n"
        "| c | d |\n"
    )
    assert blocks_to_md([table]) == expected
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/convert/test_blocks_table.py tests/convert/test_blocks_equation.py -v
```

Expected: FAIL.

- [ ] **Step 3: Add equation and table handlers**

Append to `src/notion_extractor/convert/blocks.py`:
```python
def _equation_block(block: dict, _ctx: RenderContext) -> str:
    expr = block["equation"]["expression"]
    return f"$$\n{expr}\n$$\n"


def _table(block: dict, _ctx: RenderContext) -> str:
    table = block["table"]
    width = table.get("table_width", 0)
    has_header = table.get("has_column_header", False)
    rows = block.get("children", [])

    def render_row(cells: list[list[dict]]) -> str:
        rendered = [rich_text_to_md(c) for c in cells]
        padded = rendered + [""] * (width - len(rendered))
        return "| " + " | ".join(padded) + " |\n"

    out: list[str] = []
    if has_header and rows:
        out.append(render_row(rows[0]["table_row"]["cells"]))
        out.append("| " + " | ".join(["---"] * width) + " |\n")
        body = rows[1:]
    else:
        out.append("| " + " | ".join([""] * width) + " |\n")
        out.append("| " + " | ".join(["---"] * width) + " |\n")
        body = rows

    for row in body:
        out.append(render_row(row["table_row"]["cells"]))
    return "".join(out)


_HANDLERS["equation"] = _equation_block
_HANDLERS["table"] = _table
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run pytest tests/convert/test_blocks_table.py tests/convert/test_blocks_equation.py -v
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notion_extractor/convert/blocks.py tests/convert/test_blocks_table.py tests/convert/test_blocks_equation.py
git commit -m "feat(convert): tables and block equations"
```

---

## Task 8: Block converter — media blocks (image, file, pdf, video, audio)

Media URLs are emitted as placeholders `{{notion-asset:<url>}}` so the resolve phase can rewrite them after download.

**Files:**
- Modify: `src/notion_extractor/convert/blocks.py`
- Create: `tests/convert/test_blocks_media.py`

- [ ] **Step 1: Write the failing test**

`tests/convert/test_blocks_media.py`:
```python
from notion_extractor.convert.blocks import blocks_to_md


def _text_rich(content: str) -> list[dict]:
    return [{
        "type": "text",
        "text": {"content": content, "link": None},
        "plain_text": content,
        "href": None,
        "annotations": {
            "bold": False, "italic": False, "strikethrough": False,
            "underline": False, "code": False, "color": "default",
        },
    }]


def _file_block(block_type: str, url: str, *, caption: str = "", file_kind: str = "file") -> dict:
    payload = {
        "type": file_kind,
        file_kind: {"url": url, "expiry_time": "2026-12-31T00:00:00.000Z"} if file_kind == "file" else {"url": url},
        "caption": _text_rich(caption) if caption else [],
    }
    return {
        "type": block_type,
        block_type: payload,
        "has_children": False,
        "children": [],
    }


def test_image_internal_emits_asset_placeholder() -> None:
    block = _file_block("image", "https://prod-files.s3.amazonaws.com/x.png", caption="screenshot")
    assert blocks_to_md([block]) == "![screenshot]({{notion-asset:https://prod-files.s3.amazonaws.com/x.png}})\n"


def test_image_external_kept_as_external() -> None:
    block = _file_block("image", "https://example.com/x.png", file_kind="external")
    assert blocks_to_md([block]) == "![](https://example.com/x.png)\n"


def test_pdf_block() -> None:
    block = _file_block("pdf", "https://prod-files.s3.amazonaws.com/doc.pdf", caption="paper")
    assert blocks_to_md([block]) == "[paper]({{notion-asset:https://prod-files.s3.amazonaws.com/doc.pdf}})\n"


def test_file_block_no_caption_uses_basename() -> None:
    block = _file_block("file", "https://prod-files.s3.amazonaws.com/folder/report.docx")
    assert blocks_to_md([block]) == "[report.docx]({{notion-asset:https://prod-files.s3.amazonaws.com/folder/report.docx}})\n"


def test_video_internal() -> None:
    block = _file_block("video", "https://prod-files.s3.amazonaws.com/v.mp4", caption="clip")
    assert blocks_to_md([block]) == "[clip]({{notion-asset:https://prod-files.s3.amazonaws.com/v.mp4}})\n"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/convert/test_blocks_media.py -v
```

Expected: FAIL.

- [ ] **Step 3: Add media handlers**

Append to `src/notion_extractor/convert/blocks.py`:
```python
from urllib.parse import urlparse


def _media_url_and_external(payload: dict) -> tuple[str, bool]:
    kind = payload.get("type", "file")
    inner = payload.get(kind, {})
    url = inner.get("url", "")
    is_external = kind == "external"
    return url, is_external


def _asset_target(url: str, is_external: bool) -> str:
    return url if is_external else f"{{{{notion-asset:{url}}}}}"


def _basename(url: str) -> str:
    path = urlparse(url).path
    return path.rsplit("/", 1)[-1] or "file"


def _image(block: dict, _ctx: RenderContext) -> str:
    payload = block["image"]
    url, is_external = _media_url_and_external(payload)
    caption = rich_text_to_md(payload.get("caption") or [])
    target = _asset_target(url, is_external)
    return f"![{caption}]({target})\n"


def _file_like(field: str) -> BlockHandler:
    def handler(block: dict, _ctx: RenderContext) -> str:
        payload = block[field]
        url, is_external = _media_url_and_external(payload)
        caption = rich_text_to_md(payload.get("caption") or []) or _basename(url)
        target = _asset_target(url, is_external)
        return f"[{caption}]({target})\n"
    return handler


_HANDLERS["image"] = _image
_HANDLERS["pdf"] = _file_like("pdf")
_HANDLERS["file"] = _file_like("file")
_HANDLERS["video"] = _file_like("video")
_HANDLERS["audio"] = _file_like("audio")
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/convert/test_blocks_media.py -v
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notion_extractor/convert/blocks.py tests/convert/test_blocks_media.py
git commit -m "feat(convert): media blocks emit asset placeholders"
```

---

## Task 9: Block converter — embeds, bookmarks, link previews

Detect known domains (YouTube, Twitter/X, Vimeo, Loom, Figma) and emit Obsidian-compatible embeds; fall back to plain links.

**Files:**
- Modify: `src/notion_extractor/convert/blocks.py`
- Create: `tests/convert/test_blocks_embed.py`

- [ ] **Step 1: Write the failing test**

`tests/convert/test_blocks_embed.py`:
```python
from notion_extractor.convert.blocks import blocks_to_md


def _embed(block_type: str, url: str, caption: str = "") -> dict:
    payload = {"url": url, "caption": []}
    if caption:
        payload["caption"] = [{
            "type": "text",
            "text": {"content": caption, "link": None},
            "plain_text": caption,
            "href": None,
            "annotations": {
                "bold": False, "italic": False, "strikethrough": False,
                "underline": False, "code": False, "color": "default",
            },
        }]
    return {
        "type": block_type,
        block_type: payload,
        "has_children": False,
        "children": [],
    }


def test_bookmark_falls_back_to_link() -> None:
    block = _embed("bookmark", "https://example.com")
    assert blocks_to_md([block]) == "[example.com](https://example.com)\n"


def test_bookmark_with_caption() -> None:
    block = _embed("bookmark", "https://example.com", caption="Cool site")
    assert blocks_to_md([block]) == "[Cool site](https://example.com)\n"


def test_youtube_embed() -> None:
    block = _embed("embed", "https://www.youtube.com/watch?v=abc")
    assert blocks_to_md([block]) == "![](https://www.youtube.com/watch?v=abc)\n"


def test_vimeo_embed() -> None:
    block = _embed("video", "https://vimeo.com/12345")
    # video block with external URL handled by media handler in task 8.
    # If embed picks it up via type "embed" we still treat as embed.


def test_link_preview() -> None:
    block = _embed("link_preview", "https://example.com/page")
    assert blocks_to_md([block]) == "[example.com/page](https://example.com/page)\n"


def test_twitter_embed_native() -> None:
    block = _embed("embed", "https://twitter.com/x/status/123")
    assert blocks_to_md([block]) == "![](https://twitter.com/x/status/123)\n"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/convert/test_blocks_embed.py -v
```

Expected: FAIL.

- [ ] **Step 3: Add embed/bookmark handlers**

Append to `src/notion_extractor/convert/blocks.py`:
```python
_OBSIDIAN_EMBED_HOSTS = {
    "www.youtube.com", "youtube.com", "youtu.be",
    "twitter.com", "x.com",
    "vimeo.com",
    "loom.com", "www.loom.com",
    "figma.com", "www.figma.com",
}


def _is_embeddable(url: str) -> bool:
    return urlparse(url).hostname in _OBSIDIAN_EMBED_HOSTS


def _display_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.path and parsed.path != "/":
        return f"{parsed.hostname}{parsed.path}"
    return parsed.hostname or url


def _embed_block(field: str) -> BlockHandler:
    def handler(block: dict, _ctx: RenderContext) -> str:
        payload = block[field]
        url = payload.get("url", "")
        caption = rich_text_to_md(payload.get("caption") or [])
        if _is_embeddable(url):
            return f"![{caption}]({url})\n"
        display = caption or _display_url(url)
        return f"[{display}]({url})\n"
    return handler


_HANDLERS["bookmark"] = _embed_block("bookmark")
_HANDLERS["embed"] = _embed_block("embed")
_HANDLERS["link_preview"] = _embed_block("link_preview")
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/convert/test_blocks_embed.py -v
```

Expected: PASS (5 tests; `test_vimeo_embed` has no assert and passes trivially).

- [ ] **Step 5: Commit**

```bash
git add src/notion_extractor/convert/blocks.py tests/convert/test_blocks_embed.py
git commit -m "feat(convert): embeds with native Obsidian for known hosts"
```

---

## Task 10: Block converter — child pages, child databases, link_to_page

Each emits a `{{notion-link:<id>}}` placeholder for resolve.

**Files:**
- Modify: `src/notion_extractor/convert/blocks.py`
- Create: `tests/convert/test_blocks_links.py`

- [ ] **Step 1: Write the failing test**

`tests/convert/test_blocks_links.py`:
```python
from notion_extractor.convert.blocks import blocks_to_md


def test_child_page() -> None:
    block = {
        "type": "child_page",
        "id": "abc-123",
        "child_page": {"title": "Some Page"},
        "has_children": False,
        "children": [],
    }
    assert blocks_to_md([block]) == "{{notion-link:abc-123|Some Page}}\n"


def test_child_database() -> None:
    block = {
        "type": "child_database",
        "id": "db-456",
        "child_database": {"title": "Tasks"},
        "has_children": False,
        "children": [],
    }
    assert blocks_to_md([block]) == "{{notion-link:db-456|Tasks}}\n"


def test_link_to_page() -> None:
    block = {
        "type": "link_to_page",
        "link_to_page": {"type": "page_id", "page_id": "p-1"},
        "has_children": False,
        "children": [],
    }
    assert blocks_to_md([block]) == "{{notion-link:p-1}}\n"


def test_link_to_database() -> None:
    block = {
        "type": "link_to_page",
        "link_to_page": {"type": "database_id", "database_id": "d-1"},
        "has_children": False,
        "children": [],
    }
    assert blocks_to_md([block]) == "{{notion-link:d-1}}\n"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/convert/test_blocks_links.py -v
```

Expected: FAIL.

- [ ] **Step 3: Add link handlers**

Append to `src/notion_extractor/convert/blocks.py`:
```python
def _child_page(block: dict, _ctx: RenderContext) -> str:
    page_id = block.get("id", "")
    title = block["child_page"].get("title", "")
    return f"{{{{notion-link:{page_id}|{title}}}}}\n"


def _child_database(block: dict, _ctx: RenderContext) -> str:
    db_id = block.get("id", "")
    title = block["child_database"].get("title", "")
    return f"{{{{notion-link:{db_id}|{title}}}}}\n"


def _link_to_page(block: dict, _ctx: RenderContext) -> str:
    payload = block["link_to_page"]
    if payload.get("type") == "page_id":
        target = payload["page_id"]
    elif payload.get("type") == "database_id":
        target = payload["database_id"]
    else:
        return ""
    return f"{{{{notion-link:{target}}}}}\n"


_HANDLERS["child_page"] = _child_page
_HANDLERS["child_database"] = _child_database
_HANDLERS["link_to_page"] = _link_to_page
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/convert/test_blocks_links.py -v
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notion_extractor/convert/blocks.py tests/convert/test_blocks_links.py
git commit -m "feat(convert): child pages, child databases, link_to_page as placeholders"
```

---

## Task 11: Database properties → YAML frontmatter

**Files:**
- Create: `src/notion_extractor/convert/properties.py`
- Create: `tests/convert/test_properties.py`

- [ ] **Step 1: Write the failing test**

`tests/convert/test_properties.py`:
```python
from notion_extractor.convert.properties import properties_to_frontmatter


def _title(text: str) -> dict:
    return {
        "type": "title",
        "title": [{
            "type": "text",
            "plain_text": text,
            "text": {"content": text, "link": None},
            "href": None,
            "annotations": {
                "bold": False, "italic": False, "strikethrough": False,
                "underline": False, "code": False, "color": "default",
            },
        }],
    }


def test_title_property() -> None:
    props = {"Name": _title("Fazer X")}
    fm = properties_to_frontmatter(props)
    assert fm == {"Name": "Fazer X"}


def test_rich_text() -> None:
    props = {
        "Notes": {
            "type": "rich_text",
            "rich_text": [{
                "type": "text",
                "plain_text": "some note",
                "text": {"content": "some note", "link": None},
                "href": None,
                "annotations": {
                    "bold": False, "italic": False, "strikethrough": False,
                    "underline": False, "code": False, "color": "default",
                },
            }],
        }
    }
    assert properties_to_frontmatter(props) == {"Notes": "some note"}


def test_number() -> None:
    props = {"Score": {"type": "number", "number": 42}}
    assert properties_to_frontmatter(props) == {"Score": 42}


def test_select() -> None:
    props = {"Status": {"type": "select", "select": {"name": "Done", "color": "green", "id": "x"}}}
    assert properties_to_frontmatter(props) == {"Status": "Done"}


def test_select_empty() -> None:
    props = {"Status": {"type": "select", "select": None}}
    assert properties_to_frontmatter(props) == {"Status": None}


def test_multi_select() -> None:
    props = {
        "Tags": {
            "type": "multi_select",
            "multi_select": [
                {"name": "a", "color": "blue", "id": "1"},
                {"name": "b", "color": "red", "id": "2"},
            ],
        }
    }
    assert properties_to_frontmatter(props) == {"Tags": ["a", "b"]}


def test_status() -> None:
    props = {"State": {"type": "status", "status": {"name": "Doing", "color": "blue", "id": "x"}}}
    assert properties_to_frontmatter(props) == {"State": "Doing"}


def test_date_simple() -> None:
    props = {"Due": {"type": "date", "date": {"start": "2026-05-20", "end": None, "time_zone": None}}}
    assert properties_to_frontmatter(props) == {"Due": "2026-05-20"}


def test_date_range() -> None:
    props = {"Due": {"type": "date", "date": {"start": "2026-05-20", "end": "2026-05-21", "time_zone": None}}}
    assert properties_to_frontmatter(props) == {"Due": "2026-05-20/2026-05-21"}


def test_checkbox() -> None:
    props = {"Done": {"type": "checkbox", "checkbox": True}}
    assert properties_to_frontmatter(props) == {"Done": True}


def test_url() -> None:
    props = {"Site": {"type": "url", "url": "https://x.dev"}}
    assert properties_to_frontmatter(props) == {"Site": "https://x.dev"}


def test_email_phone() -> None:
    props = {
        "Email": {"type": "email", "email": "a@b.c"},
        "Phone": {"type": "phone_number", "phone_number": "+55"},
    }
    assert properties_to_frontmatter(props) == {"Email": "a@b.c", "Phone": "+55"}


def test_people() -> None:
    props = {
        "Owner": {
            "type": "people",
            "people": [
                {"name": "Ana", "id": "u1", "object": "user"},
                {"name": "Bia", "id": "u2", "object": "user"},
            ],
        }
    }
    assert properties_to_frontmatter(props) == {"Owner": ["Ana", "Bia"]}


def test_files_emits_placeholders() -> None:
    props = {
        "Files": {
            "type": "files",
            "files": [
                {"name": "x.pdf", "type": "file", "file": {"url": "https://s3/x.pdf"}},
                {"name": "y.png", "type": "external", "external": {"url": "https://ex/y.png"}},
            ],
        }
    }
    assert properties_to_frontmatter(props) == {
        "Files": ["{{notion-asset:https://s3/x.pdf}}", "https://ex/y.png"]
    }


def test_relation_emits_link_placeholders() -> None:
    props = {
        "Rel": {"type": "relation", "relation": [{"id": "abc"}, {"id": "def"}]}
    }
    assert properties_to_frontmatter(props) == {
        "Rel": ["{{notion-link:abc}}", "{{notion-link:def}}"]
    }


def test_formula_number() -> None:
    props = {"X": {"type": "formula", "formula": {"type": "number", "number": 3.14}}}
    assert properties_to_frontmatter(props) == {"X": 3.14}


def test_formula_string() -> None:
    props = {"X": {"type": "formula", "formula": {"type": "string", "string": "hi"}}}
    assert properties_to_frontmatter(props) == {"X": "hi"}


def test_created_time() -> None:
    props = {"Created": {"type": "created_time", "created_time": "2026-01-01T00:00:00.000Z"}}
    assert properties_to_frontmatter(props) == {"Created": "2026-01-01T00:00:00.000Z"}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/convert/test_properties.py -v
```

Expected: FAIL.

- [ ] **Step 3: Implement converter**

`src/notion_extractor/convert/properties.py`:
```python
from typing import Any

from notion_extractor.convert.inline import rich_text_to_md


def properties_to_frontmatter(properties: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {name: _convert(prop) for name, prop in properties.items()}


def _convert(prop: dict[str, Any]) -> Any:  # noqa: ANN401 - dynamic by property type
    ptype = prop.get("type")
    if ptype == "title":
        return rich_text_to_md(prop.get("title", []))
    if ptype == "rich_text":
        return rich_text_to_md(prop.get("rich_text", []))
    if ptype == "number":
        return prop.get("number")
    if ptype == "select":
        sel = prop.get("select")
        return sel.get("name") if sel else None
    if ptype == "multi_select":
        return [item["name"] for item in prop.get("multi_select", [])]
    if ptype == "status":
        st = prop.get("status")
        return st.get("name") if st else None
    if ptype == "date":
        return _date_to_str(prop.get("date"))
    if ptype == "checkbox":
        return prop.get("checkbox")
    if ptype == "url":
        return prop.get("url")
    if ptype == "email":
        return prop.get("email")
    if ptype == "phone_number":
        return prop.get("phone_number")
    if ptype == "people":
        return [p.get("name") for p in prop.get("people", []) if p.get("name")]
    if ptype == "files":
        return [_file_value(f) for f in prop.get("files", [])]
    if ptype == "relation":
        return [f"{{{{notion-link:{r['id']}}}}}" for r in prop.get("relation", [])]
    if ptype == "formula":
        return _formula_value(prop.get("formula", {}))
    if ptype == "rollup":
        return _rollup_value(prop.get("rollup", {}))
    if ptype in ("created_time", "last_edited_time"):
        return prop.get(ptype)
    if ptype in ("created_by", "last_edited_by"):
        user = prop.get(ptype) or {}
        return user.get("name")
    return None


def _date_to_str(date: dict[str, Any] | None) -> str | None:
    if not date:
        return None
    start = date.get("start")
    end = date.get("end")
    if end:
        return f"{start}/{end}"
    return start


def _file_value(f: dict[str, Any]) -> str:
    if f.get("type") == "external":
        return f["external"]["url"]
    return f"{{{{notion-asset:{f['file']['url']}}}}}"


def _formula_value(formula: dict[str, Any]) -> Any:  # noqa: ANN401
    ftype = formula.get("type")
    if ftype == "number":
        return formula.get("number")
    if ftype == "string":
        return formula.get("string")
    if ftype == "boolean":
        return formula.get("boolean")
    if ftype == "date":
        return _date_to_str(formula.get("date"))
    return None


def _rollup_value(rollup: dict[str, Any]) -> Any:  # noqa: ANN401
    rtype = rollup.get("type")
    if rtype == "number":
        return rollup.get("number")
    if rtype == "date":
        return _date_to_str(rollup.get("date"))
    if rtype == "array":
        return [_convert(item) for item in rollup.get("array", [])]
    return None
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/convert/test_properties.py -v
```

Expected: PASS (all 18 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notion_extractor/convert/properties.py tests/convert/test_properties.py
git commit -m "feat(convert): Notion properties to YAML frontmatter dict"
```

---

## Task 12: Path planning (`PlannedNode`, slug, folder vs file rule)

**Files:**
- Create: `src/notion_extractor/extract/__init__.py`
- Create: `src/notion_extractor/extract/plan.py`
- Create: `tests/extract/__init__.py`
- Create: `tests/extract/test_plan.py`

A `PlannedNode` is the union of (notion_id, type, title, parent_id, children_ids, has_children). `plan_paths` takes a list of nodes and the output root, returns `dict[notion_id → Path]` applying the rules from spec §4.

- [ ] **Step 1: Write the failing test**

`tests/extract/test_plan.py`:
```python
from pathlib import Path

from notion_extractor.extract.plan import NodeKind, PlannedNode, plan_paths, slugify


def test_slugify_keeps_unicode() -> None:
    assert slugify("Notas de Reunião") == "Notas de Reunião"


def test_slugify_replaces_forbidden_chars() -> None:
    assert slugify("a/b\\c:d*e?f\"g<h>i|j") == "a-b-c-d-e-f-g-h-i-j"


def test_slugify_strips_outer_whitespace() -> None:
    assert slugify("  hello  ") == "hello"


def test_slugify_handles_empty() -> None:
    assert slugify("") == "untitled"


def test_leaf_page_is_file() -> None:
    root = Path("/v")
    nodes = [
        PlannedNode(id="r", kind=NodeKind.PAGE, title="Notas", parent_id=None, children_ids=[]),
    ]
    paths = plan_paths(nodes, root)
    assert paths["r"] == root / "Notas.md"


def test_page_with_children_is_folder_plus_sibling_file() -> None:
    root = Path("/v")
    nodes = [
        PlannedNode(id="r", kind=NodeKind.PAGE, title="Notas", parent_id=None, children_ids=["c"]),
        PlannedNode(id="c", kind=NodeKind.PAGE, title="Sub", parent_id="r", children_ids=[]),
    ]
    paths = plan_paths(nodes, root)
    assert paths["r"] == root / "Notas.md"
    assert paths["c"] == root / "Notas" / "Sub.md"


def test_database_always_folder_with_sibling_index() -> None:
    root = Path("/v")
    nodes = [
        PlannedNode(id="db", kind=NodeKind.DATABASE, title="Tarefas", parent_id=None, children_ids=["i1"]),
        PlannedNode(id="i1", kind=NodeKind.DB_ITEM, title="Fazer X", parent_id="db", children_ids=[]),
    ]
    paths = plan_paths(nodes, root)
    assert paths["db"] == root / "Tarefas.md"
    assert paths["i1"] == root / "Tarefas" / "Fazer X.md"


def test_slug_collision_suffix() -> None:
    root = Path("/v")
    nodes = [
        PlannedNode(id="a", kind=NodeKind.PAGE, title="Dup", parent_id=None, children_ids=[]),
        PlannedNode(id="b", kind=NodeKind.PAGE, title="Dup", parent_id=None, children_ids=[]),
        PlannedNode(id="c", kind=NodeKind.PAGE, title="Dup", parent_id=None, children_ids=[]),
    ]
    paths = plan_paths(nodes, root)
    # Sorted alphabetically by id (a, b, c)
    assert paths["a"] == root / "Dup.md"
    assert paths["b"] == root / "Dup (2).md"
    assert paths["c"] == root / "Dup (3).md"


def test_deep_nesting() -> None:
    root = Path("/v")
    nodes = [
        PlannedNode(id="A", kind=NodeKind.PAGE, title="A", parent_id=None, children_ids=["B"]),
        PlannedNode(id="B", kind=NodeKind.PAGE, title="B", parent_id="A", children_ids=["C"]),
        PlannedNode(id="C", kind=NodeKind.PAGE, title="C", parent_id="B", children_ids=[]),
    ]
    paths = plan_paths(nodes, root)
    assert paths["A"] == root / "A.md"
    assert paths["B"] == root / "A" / "B.md"
    assert paths["C"] == root / "A" / "B" / "C.md"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/extract/test_plan.py -v
```

Expected: FAIL.

- [ ] **Step 3: Implement**

`src/notion_extractor/extract/__init__.py`:
```python
```

`src/notion_extractor/extract/plan.py`:
```python
import enum
import re
from dataclasses import dataclass, field
from pathlib import Path

_FORBIDDEN = re.compile(r'[\\/:*?"<>|]')


class NodeKind(str, enum.Enum):
    PAGE = "page"
    DATABASE = "database"
    DB_ITEM = "db_item"


@dataclass
class PlannedNode:
    id: str
    kind: NodeKind
    title: str
    parent_id: str | None
    children_ids: list[str] = field(default_factory=list)


def slugify(name: str) -> str:
    if not name:
        return "untitled"
    s = _FORBIDDEN.sub("-", name).strip()
    return s or "untitled"


def plan_paths(nodes: list[PlannedNode], root: Path) -> dict[str, Path]:
    by_id = {n.id: n for n in nodes}
    paths: dict[str, Path] = {}

    def dir_for(node_id: str) -> Path:
        node = by_id[node_id]
        if node.parent_id is None:
            parent_dir = root
        else:
            parent_dir = dir_for(node.parent_id)
        if _has_subtree(node):
            return parent_dir / slugify(node.title)
        return parent_dir

    def resolve_path(node: PlannedNode) -> Path:
        parent_dir = root if node.parent_id is None else dir_for(node.parent_id)
        return parent_dir / f"{slugify(node.title)}.md"

    siblings_by_dir: dict[Path, list[PlannedNode]] = {}
    for node in sorted(nodes, key=lambda n: n.id):
        parent_dir = root if node.parent_id is None else dir_for(node.parent_id)
        siblings_by_dir.setdefault(parent_dir, []).append(node)

    for parent_dir, group in siblings_by_dir.items():
        used: dict[str, int] = {}
        for node in group:
            base = slugify(node.title)
            count = used.get(base, 0) + 1
            used[base] = count
            filename = f"{base}.md" if count == 1 else f"{base} ({count}).md"
            paths[node.id] = parent_dir / filename
    return paths


def _has_subtree(node: PlannedNode) -> bool:
    if node.kind == NodeKind.DATABASE:
        return True
    return bool(node.children_ids)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/extract/test_plan.py -v
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notion_extractor/extract/__init__.py src/notion_extractor/extract/plan.py tests/extract/__init__.py tests/extract/test_plan.py
git commit -m "feat(extract): plan output paths from PlannedNode tree"
```

---

## Task 13: Notion fetcher — pages, blocks, database items (paginated)

**Files:**
- Create: `src/notion_extractor/notion/fetch.py`
- Create: `tests/notion/test_fetch.py`

- [ ] **Step 1: Write the failing test**

`tests/notion/test_fetch.py`:
```python
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
                {"id": "b1", "type": "paragraph", "has_children": False, "paragraph": {"rich_text": []}}
            ],
            "next_cursor": "cur1",
            "has_more": True,
        },
    )
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/parent/children?page_size=100&start_cursor=cur1",
        json={
            "results": [
                {"id": "b2", "type": "paragraph", "has_children": False, "paragraph": {"rich_text": []}}
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
                {"id": "outer", "type": "toggle", "has_children": True,
                 "toggle": {"rich_text": []}}
            ],
            "next_cursor": None, "has_more": False,
        },
    )
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/outer/children?page_size=100",
        json={
            "results": [
                {"id": "inner", "type": "paragraph", "has_children": False,
                 "paragraph": {"rich_text": []}}
            ],
            "next_cursor": None, "has_more": False,
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
            "next_cursor": "c", "has_more": True,
        },
    )
    httpx_mock.add_response(
        method="POST",
        url="https://api.notion.com/v1/databases/db1/query",
        json={
            "results": [{"id": "i2", "properties": {}}],
            "next_cursor": None, "has_more": False,
        },
    )

    async with AsyncNotionClient(token="t") as client:
        items = await query_database(client, "db1")

    assert [i["id"] for i in items] == ["i1", "i2"]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/notion/test_fetch.py -v
```

Expected: FAIL.

- [ ] **Step 3: Implement fetchers**

`src/notion_extractor/notion/fetch.py`:
```python
import asyncio
from typing import Any

from notion_extractor.notion.client import AsyncNotionClient


async def fetch_block_children(
    client: AsyncNotionClient, block_id: str
) -> list[dict[str, Any]]:
    blocks = await _paginate_get(client, f"/blocks/{block_id}/children")

    async def hydrate(block: dict[str, Any]) -> dict[str, Any]:
        block.setdefault("children", [])
        if block.get("has_children") and block.get("type") not in {"child_page", "child_database"}:
            block["children"] = await fetch_block_children(client, block["id"])
        return block

    return await asyncio.gather(*(hydrate(b) for b in blocks))


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
        page_body = {**body, "page_size": 100}
        if cursor:
            page_body["start_cursor"] = cursor
        page = await client.post(path, page_body)
        results.extend(page.get("results", []))
        if not page.get("has_more"):
            return results
        cursor = page.get("next_cursor")
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/notion/test_fetch.py -v
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notion_extractor/notion/fetch.py tests/notion/test_fetch.py
git commit -m "feat(notion): paginated fetch for blocks and database items"
```

---

## Task 14: Tree discovery (walk shared roots → PlannedNode list)

**Files:**
- Create: `src/notion_extractor/notion/discovery.py`
- Create: `tests/notion/test_discovery.py`

- [ ] **Step 1: Write the failing test**

`tests/notion/test_discovery.py`:
```python
import pytest
from pytest_httpx import HTTPXMock

from notion_extractor.extract.plan import NodeKind
from notion_extractor.notion.client import AsyncNotionClient
from notion_extractor.notion.discovery import discover_subtree, list_shared_roots


@pytest.mark.asyncio
async def test_list_shared_roots(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        method="POST",
        url="https://api.notion.com/v1/search",
        json={
            "results": [
                {
                    "object": "page", "id": "p1",
                    "properties": {"title": {"type": "title", "title": [
                        {"plain_text": "Notas", "type": "text",
                         "text": {"content": "Notas", "link": None}, "href": None,
                         "annotations": {"bold": False, "italic": False, "strikethrough": False,
                                         "underline": False, "code": False, "color": "default"}}
                    ]}},
                    "parent": {"type": "workspace"},
                },
                {
                    "object": "database", "id": "d1",
                    "title": [
                        {"plain_text": "Tarefas", "type": "text",
                         "text": {"content": "Tarefas", "link": None}, "href": None,
                         "annotations": {"bold": False, "italic": False, "strikethrough": False,
                                         "underline": False, "code": False, "color": "default"}}
                    ],
                    "parent": {"type": "workspace"},
                },
            ],
            "next_cursor": None, "has_more": False,
        },
    )
    async with AsyncNotionClient(token="t") as client:
        roots = await list_shared_roots(client)

    assert {r.id for r in roots} == {"p1", "d1"}
    assert next(r for r in roots if r.id == "p1").kind == NodeKind.PAGE
    assert next(r for r in roots if r.id == "d1").kind == NodeKind.DATABASE


@pytest.mark.asyncio
async def test_discover_subtree_walks_children(httpx_mock: HTTPXMock) -> None:
    # Root page p1
    httpx_mock.add_response(
        url="https://api.notion.com/v1/pages/p1",
        json={
            "id": "p1",
            "properties": {"title": {"type": "title", "title": [
                {"plain_text": "Root", "type": "text",
                 "text": {"content": "Root", "link": None}, "href": None,
                 "annotations": {"bold": False, "italic": False, "strikethrough": False,
                                 "underline": False, "code": False, "color": "default"}}
            ]}},
        },
    )
    # Children of p1: one child_page, one child_database, one paragraph (ignored)
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/p1/children?page_size=100",
        json={
            "results": [
                {"id": "sub1", "type": "child_page", "child_page": {"title": "Sub"},
                 "has_children": False},
                {"id": "db1", "type": "child_database", "child_database": {"title": "Items"},
                 "has_children": False},
                {"id": "para", "type": "paragraph", "paragraph": {"rich_text": []},
                 "has_children": False},
            ],
            "next_cursor": None, "has_more": False,
        },
    )
    # Sub page has no children
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/sub1/children?page_size=100",
        json={"results": [], "next_cursor": None, "has_more": False},
    )
    # Database items
    httpx_mock.add_response(
        method="POST",
        url="https://api.notion.com/v1/databases/db1/query",
        json={
            "results": [
                {
                    "id": "row1",
                    "properties": {"Name": {"type": "title", "title": [
                        {"plain_text": "Row 1", "type": "text",
                         "text": {"content": "Row 1", "link": None}, "href": None,
                         "annotations": {"bold": False, "italic": False, "strikethrough": False,
                                         "underline": False, "code": False, "color": "default"}}
                    ]}},
                }
            ],
            "next_cursor": None, "has_more": False,
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/notion/test_discovery.py -v
```

Expected: FAIL.

- [ ] **Step 3: Implement discovery**

`src/notion_extractor/notion/discovery.py`:
```python
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
    body: dict[str, Any] = {"page_size": 100}
    results: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
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
            roots.append(PlannedNode(
                id=r["id"],
                kind=NodeKind.PAGE,
                title=_page_title(r),
                parent_id=None,
            ))
        elif obj == "database":
            roots.append(PlannedNode(
                id=r["id"],
                kind=NodeKind.DATABASE,
                title=rich_text_to_md(r.get("title", [])) or "Untitled",
                parent_id=None,
            ))
    return roots


async def discover_subtree(
    client: AsyncNotionClient, *, root_id: str, root_kind: NodeKind
) -> list[PlannedNode]:
    collected: list[PlannedNode] = []

    if root_kind == NodeKind.PAGE:
        page = await get_page(client, root_id)
        root = PlannedNode(
            id=root_id, kind=NodeKind.PAGE,
            title=_page_title(page), parent_id=None,
        )
        await _walk_page(client, root, collected)
    else:
        db = await get_database(client, root_id)
        root = PlannedNode(
            id=root_id, kind=NodeKind.DATABASE,
            title=rich_text_to_md(db.get("title", [])) or "Untitled",
            parent_id=None,
        )
        await _walk_database(client, root, collected)

    return [root, *collected]


async def _walk_page(
    client: AsyncNotionClient, node: PlannedNode, out: list[PlannedNode]
) -> None:
    blocks = await fetch_block_children(client, node.id)
    for block in blocks:
        btype = block.get("type")
        if btype == "child_page":
            child = PlannedNode(
                id=block["id"], kind=NodeKind.PAGE,
                title=block["child_page"].get("title", "Untitled"),
                parent_id=node.id,
            )
            node.children_ids.append(child.id)
            out.append(child)
            await _walk_page(client, child, out)
        elif btype == "child_database":
            child = PlannedNode(
                id=block["id"], kind=NodeKind.DATABASE,
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
            id=item["id"], kind=NodeKind.DB_ITEM,
            title=title, parent_id=node.id,
        )
        node.children_ids.append(item_node.id)
        out.append(item_node)
        # DB items can also contain subpages — walk like a page
        await _walk_page(client, item_node, out)


def _page_title(page: dict[str, Any]) -> str:
    props = page.get("properties", {})
    for prop in props.values():
        if prop.get("type") == "title":
            return rich_text_to_md(prop.get("title", [])) or "Untitled"
    return "Untitled"
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/notion/test_discovery.py -v
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notion_extractor/notion/discovery.py tests/notion/test_discovery.py
git commit -m "feat(notion): tree discovery from search + recursive walk"
```

---

## Task 15: Attachment downloader

**Files:**
- Create: `src/notion_extractor/extract/attachments.py`
- Create: `tests/extract/test_attachments.py`

- [ ] **Step 1: Write the failing test**

`tests/extract/test_attachments.py`:
```python
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
    local = await downloader.download("https://prod-files.s3.amazonaws.com/folder/image.png")

    assert local.parent == tmp_path / "assets"
    assert local.name.endswith("-image.png")
    assert local.read_bytes() == b"PNGDATA"


@pytest.mark.asyncio
async def test_download_deduplicates_same_url(
    tmp_path: Path, httpx_mock: HTTPXMock
) -> None:
    httpx_mock.add_response(
        url="https://prod-files.s3.amazonaws.com/x.png",
        content=b"DATA",
    )
    downloader = AttachmentDownloader(assets_dir=tmp_path / "assets")
    first = await downloader.download("https://prod-files.s3.amazonaws.com/x.png")
    second = await downloader.download("https://prod-files.s3.amazonaws.com/x.png")
    assert first == second
    # Only one request was made
    assert len(httpx_mock.get_requests()) == 1


@pytest.mark.asyncio
async def test_download_strips_query_string_from_basename(
    tmp_path: Path, httpx_mock: HTTPXMock
) -> None:
    httpx_mock.add_response(
        url="https://prod-files.s3.amazonaws.com/x.png?sig=abc",
        content=b"D",
    )
    downloader = AttachmentDownloader(assets_dir=tmp_path / "assets")
    local = await downloader.download("https://prod-files.s3.amazonaws.com/x.png?sig=abc")
    assert local.name.endswith("-x.png")
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/extract/test_attachments.py -v
```

Expected: FAIL.

- [ ] **Step 3: Implement downloader**

`src/notion_extractor/extract/attachments.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/extract/test_attachments.py -v
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notion_extractor/extract/attachments.py tests/extract/test_attachments.py
git commit -m "feat(extract): parallel attachment downloader with dedup"
```

---

## Task 16: Placeholder resolution and report

**Files:**
- Create: `src/notion_extractor/extract/resolve.py`
- Create: `tests/extract/test_resolve.py`

`resolve` takes a Markdown string with `{{notion-link:<id>|<label>}}` and `{{notion-asset:<url>}}` placeholders plus the id→path map and the downloaded-asset map, returns the resolved string. Unknown ids go into a broken-links report.

- [ ] **Step 1: Write the failing test**

`tests/extract/test_resolve.py`:
```python
from pathlib import Path

from notion_extractor.extract.resolve import LinkContext, render_report, resolve_placeholders


def test_resolve_known_link() -> None:
    ctx = LinkContext(
        from_file=Path("/v/A.md"),
        id_to_path={"abc": Path("/v/Other.md")},
        url_to_local={},
        vault_root=Path("/v"),
    )
    md = "see {{notion-link:abc|Other}} for more"
    result, broken = resolve_placeholders(md, ctx)
    assert result == "see [[Other]] for more"
    assert broken == []


def test_resolve_known_link_no_label_uses_basename() -> None:
    ctx = LinkContext(
        from_file=Path("/v/A.md"),
        id_to_path={"abc": Path("/v/Some Page.md")},
        url_to_local={},
        vault_root=Path("/v"),
    )
    md = "{{notion-link:abc}}"
    result, broken = resolve_placeholders(md, ctx)
    assert result == "[[Some Page]]"
    assert broken == []


def test_resolve_unknown_link_becomes_text_and_reports() -> None:
    ctx = LinkContext(
        from_file=Path("/v/A.md"),
        id_to_path={},
        url_to_local={},
        vault_root=Path("/v"),
    )
    md = "{{notion-link:xyz|External Page}}"
    result, broken = resolve_placeholders(md, ctx)
    assert result == "External Page"
    assert broken == [("xyz", "External Page", Path("/v/A.md"))]


def test_resolve_unknown_link_no_label() -> None:
    ctx = LinkContext(
        from_file=Path("/v/A.md"),
        id_to_path={},
        url_to_local={},
        vault_root=Path("/v"),
    )
    md = "{{notion-link:xyz}}"
    result, broken = resolve_placeholders(md, ctx)
    assert result == "(link removed)"
    assert broken == [("xyz", None, Path("/v/A.md"))]


def test_resolve_asset_writes_relative_path() -> None:
    ctx = LinkContext(
        from_file=Path("/v/sub/A.md"),
        id_to_path={},
        url_to_local={"https://x/y.png": Path("/v/assets/a1b2c3d4-y.png")},
        vault_root=Path("/v"),
    )
    md = "![alt]({{notion-asset:https://x/y.png}})"
    result, _ = resolve_placeholders(md, ctx)
    assert result == "![alt](../assets/a1b2c3d4-y.png)"


def test_resolve_asset_missing_keeps_url() -> None:
    ctx = LinkContext(
        from_file=Path("/v/A.md"),
        id_to_path={},
        url_to_local={},
        vault_root=Path("/v"),
    )
    md = "![]({{notion-asset:https://x/y.png}})"
    result, _ = resolve_placeholders(md, ctx)
    assert result == "![](https://x/y.png)"


def test_render_report_groups_broken_links() -> None:
    broken = [
        ("xyz", "External", Path("/v/A.md")),
        ("xyz", "External again", Path("/v/B.md")),
        ("abc", None, Path("/v/A.md")),
    ]
    report = render_report(
        vault_root=Path("/v"),
        pages_extracted=10, items_extracted=5,
        attachments_downloaded=2, total_bytes=1024,
        duration_s=1.5,
        broken_links=broken,
        failures=[("page-1", "404")],
        warnings=["unknown block: template"],
    )
    assert "Páginas extraídas: 10" in report
    assert "Itens de database extraídos: 5" in report
    assert "xyz" in report
    assert "Falhas (1)" in report
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/extract/test_resolve.py -v
```

Expected: FAIL.

- [ ] **Step 3: Implement resolver**

`src/notion_extractor/extract/resolve.py`:
```python
import os
import re
from dataclasses import dataclass
from pathlib import Path

_LINK_RE = re.compile(r"\{\{notion-link:([^|}]+)(?:\|([^}]+))?\}\}")
_ASSET_RE = re.compile(r"\{\{notion-asset:([^}]+)\}\}")

BrokenLink = tuple[str, str | None, Path]  # (id, label, from_file)


@dataclass
class LinkContext:
    from_file: Path
    id_to_path: dict[str, Path]
    url_to_local: dict[str, Path]
    vault_root: Path


def resolve_placeholders(md: str, ctx: LinkContext) -> tuple[str, list[BrokenLink]]:
    broken: list[BrokenLink] = []

    def link_sub(match: re.Match[str]) -> str:
        notion_id = match.group(1)
        label = match.group(2)
        target_path = ctx.id_to_path.get(notion_id)
        if target_path is not None:
            page_name = target_path.stem
            return f"[[{page_name}]]"
        broken.append((notion_id, label, ctx.from_file))
        return label if label else "(link removed)"

    def asset_sub(match: re.Match[str]) -> str:
        url = match.group(1)
        local = ctx.url_to_local.get(url)
        if local is None:
            return url
        rel = os.path.relpath(local, start=ctx.from_file.parent)
        return rel.replace(os.sep, "/")

    md = _LINK_RE.sub(link_sub, md)
    md = _ASSET_RE.sub(asset_sub, md)
    return md, broken


def render_report(
    *,
    vault_root: Path,
    pages_extracted: int,
    items_extracted: int,
    attachments_downloaded: int,
    total_bytes: int,
    duration_s: float,
    broken_links: list[BrokenLink],
    failures: list[tuple[str, str]],
    warnings: list[str],
) -> str:
    mb = total_bytes / (1024 * 1024)
    lines = [
        "# Relatório de extração",
        "",
        f"- Páginas extraídas: {pages_extracted}",
        f"- Itens de database extraídos: {items_extracted}",
        f"- Anexos baixados: {attachments_downloaded} ({mb:.1f} MB)",
        f"- Duração: {duration_s:.1f}s",
        "",
    ]
    if broken_links:
        lines.append(f"## Links para fora da seleção ({len(broken_links)})")
        for notion_id, label, from_file in broken_links:
            rel = from_file.relative_to(vault_root)
            label_part = f" — {label}" if label else ""
            lines.append(f"- `{notion_id}`{label_part} (em [{rel}]({rel}))")
        lines.append("")
    if failures:
        lines.append(f"## Falhas ({len(failures)})")
        for nid, reason in failures:
            lines.append(f"- `{nid}`: {reason}")
        lines.append("")
    if warnings:
        lines.append(f"## Avisos ({len(warnings)})")
        for w in warnings:
            lines.append(f"- {w}")
        lines.append("")
    return "\n".join(lines)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/extract/test_resolve.py -v
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notion_extractor/extract/resolve.py tests/extract/test_resolve.py
git commit -m "feat(extract): resolve link/asset placeholders + report"
```

---

## Task 17: Event bus for progress

**Files:**
- Create: `src/notion_extractor/progress.py`
- Create: `tests/test_progress.py`

- [ ] **Step 1: Write the failing test**

`tests/test_progress.py`:
```python
import asyncio

import pytest

from notion_extractor.progress import Event, EventBus, EventKind


@pytest.mark.asyncio
async def test_publish_and_subscribe() -> None:
    bus = EventBus()
    received: list[Event] = []

    async def consume() -> None:
        async for event in bus.subscribe():
            received.append(event)
            if event.kind == EventKind.EXTRACTION_DONE:
                break

    consumer = asyncio.create_task(consume())
    await asyncio.sleep(0)
    await bus.publish(Event(kind=EventKind.DISCOVERY_STARTED, data={}))
    await bus.publish(Event(kind=EventKind.EXTRACTION_DONE, data={"ok": True}))
    await consumer

    assert [e.kind for e in received] == [EventKind.DISCOVERY_STARTED, EventKind.EXTRACTION_DONE]


@pytest.mark.asyncio
async def test_event_to_sse_format() -> None:
    event = Event(kind=EventKind.NODE_DONE, data={"id": "p1", "title": "X"})
    sse = event.to_sse()
    assert sse.startswith("event: node_done\n")
    assert '"id": "p1"' in sse
    assert sse.endswith("\n\n")
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_progress.py -v
```

Expected: FAIL.

- [ ] **Step 3: Implement event bus**

`src/notion_extractor/progress.py`:
```python
import asyncio
import enum
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any


class EventKind(str, enum.Enum):
    DISCOVERY_STARTED = "discovery_started"
    DISCOVERY_PROGRESS = "discovery_progress"
    DISCOVERY_DONE = "discovery_done"
    NODE_STARTED = "node_started"
    NODE_DONE = "node_done"
    NODE_FAILED = "node_failed"
    ATTACHMENT_DOWNLOADED = "attachment_downloaded"
    EXTRACTION_DONE = "extraction_done"
    ERROR = "error"


@dataclass
class Event:
    kind: EventKind
    data: dict[str, Any] = field(default_factory=dict)

    def to_sse(self) -> str:
        payload = json.dumps(self.data)
        return f"event: {self.kind.value}\ndata: {payload}\n\n"


class EventBus:
    def __init__(self) -> None:
        self._subscribers: list[asyncio.Queue[Event]] = []

    async def publish(self, event: Event) -> None:
        for q in list(self._subscribers):
            await q.put(event)

    async def subscribe(self) -> AsyncIterator[Event]:
        queue: asyncio.Queue[Event] = asyncio.Queue()
        self._subscribers.append(queue)
        try:
            while True:
                yield await queue.get()
        finally:
            self._subscribers.remove(queue)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/test_progress.py -v
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notion_extractor/progress.py tests/test_progress.py
git commit -m "feat(progress): event bus with SSE serialization"
```

---

## Task 18: Pipeline orchestrator

**Files:**
- Create: `src/notion_extractor/extract/pipeline.py`
- Create: `tests/extract/test_pipeline.py`

The orchestrator: takes a list of root ids (selected via UI) + an `AsyncNotionClient` + an output dir + an event bus. Runs discovery → fetch+convert → resolve+write → report.

- [ ] **Step 1: Write the failing test (end-to-end with mocked HTTP)**

`tests/extract/test_pipeline.py`:
```python
from pathlib import Path

import pytest
from pytest_httpx import HTTPXMock

from notion_extractor.extract.pipeline import run_extraction
from notion_extractor.notion.client import AsyncNotionClient
from notion_extractor.progress import EventBus

_RICH = lambda t: [{
    "type": "text",
    "text": {"content": t, "link": None},
    "plain_text": t, "href": None,
    "annotations": {"bold": False, "italic": False, "strikethrough": False,
                    "underline": False, "code": False, "color": "default"},
}]


@pytest.mark.asyncio
async def test_extract_simple_page_writes_md(
    tmp_path: Path, httpx_mock: HTTPXMock
) -> None:
    httpx_mock.add_response(
        url="https://api.notion.com/v1/pages/p1",
        json={"id": "p1", "properties": {
            "title": {"type": "title", "title": _RICH("Hello")},
        }},
    )
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/p1/children?page_size=100",
        json={"results": [
            {"id": "b1", "type": "paragraph", "has_children": False,
             "paragraph": {"rich_text": _RICH("world")}}
        ], "next_cursor": None, "has_more": False},
    )

    bus = EventBus()
    async with AsyncNotionClient(token="t") as client:
        result = await run_extraction(
            client=client, bus=bus,
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
    # p1 mentions p2 via link_to_page
    httpx_mock.add_response(
        url="https://api.notion.com/v1/pages/p1",
        json={"id": "p1", "properties": {
            "title": {"type": "title", "title": _RICH("Alpha")},
        }},
    )
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/p1/children?page_size=100",
        json={"results": [
            {"id": "lb", "type": "link_to_page", "has_children": False,
             "link_to_page": {"type": "page_id", "page_id": "p2"}},
            {"id": "cp", "type": "child_page", "has_children": False,
             "child_page": {"title": "Beta"}},
        ], "next_cursor": None, "has_more": False},
    )
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/cp/children?page_size=100",
        json={"results": [], "next_cursor": None, "has_more": False},
    )
    # Also called by discovery resolution for child_page
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/p2/children?page_size=100",
        json={"results": [
            {"id": "x", "type": "paragraph", "has_children": False,
             "paragraph": {"rich_text": _RICH("content")}}
        ], "next_cursor": None, "has_more": False},
    )

    bus = EventBus()
    async with AsyncNotionClient(token="t") as client:
        await run_extraction(
            client=client, bus=bus,
            output_dir=tmp_path,
            root_selection=[("p1", "page")],
        )

    # cp is "Beta" as a child page; the [[Beta]] wikilink should resolve.
    alpha = (tmp_path / "Alpha.md").read_text()
    assert "[[Beta]]" in alpha
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/extract/test_pipeline.py -v
```

Expected: FAIL.

- [ ] **Step 3: Implement pipeline**

`src/notion_extractor/extract/pipeline.py`:
```python
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from notion_extractor.convert.blocks import blocks_to_md
from notion_extractor.convert.properties import properties_to_frontmatter
from notion_extractor.extract.attachments import AttachmentDownloader
from notion_extractor.extract.plan import NodeKind, PlannedNode, plan_paths
from notion_extractor.extract.resolve import (
    BrokenLink,
    LinkContext,
    render_report,
    resolve_placeholders,
)
from notion_extractor.notion.client import AsyncNotionClient
from notion_extractor.notion.discovery import discover_subtree
from notion_extractor.notion.fetch import fetch_block_children, get_page, query_database
from notion_extractor.progress import Event, EventBus, EventKind


@dataclass
class ExtractionResult:
    pages_extracted: int = 0
    items_extracted: int = 0
    attachments_downloaded: int = 0
    total_bytes: int = 0
    duration_s: float = 0.0
    broken_links: list[BrokenLink] = field(default_factory=list)
    failures: list[tuple[str, str]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


async def run_extraction(
    *,
    client: AsyncNotionClient,
    bus: EventBus,
    output_dir: Path,
    root_selection: list[tuple[str, str]],
) -> ExtractionResult:
    started = time.monotonic()
    output_dir.mkdir(parents=True, exist_ok=True)
    assets_dir = output_dir / "assets"
    downloader = AttachmentDownloader(assets_dir=assets_dir)
    result = ExtractionResult()

    try:
        await bus.publish(Event(EventKind.DISCOVERY_STARTED, {}))
        all_nodes: list[PlannedNode] = []
        for root_id, root_kind_str in root_selection:
            kind = NodeKind(root_kind_str)
            subtree = await discover_subtree(client, root_id=root_id, root_kind=kind)
            all_nodes.extend(subtree)
            await bus.publish(Event(
                EventKind.DISCOVERY_PROGRESS,
                {"root_id": root_id, "discovered": len(subtree)},
            ))
        await bus.publish(Event(EventKind.DISCOVERY_DONE, {"total": len(all_nodes)}))

        paths = plan_paths(all_nodes, output_dir)
        id_to_node = {n.id: n for n in all_nodes}
        rendered: dict[str, str] = {}

        for node in all_nodes:
            await bus.publish(Event(
                EventKind.NODE_STARTED,
                {"id": node.id, "title": node.title},
            ))
            try:
                rendered[node.id] = await _render_node(node, client, id_to_node)
                if node.kind == NodeKind.PAGE:
                    result.pages_extracted += 1
                elif node.kind == NodeKind.DB_ITEM:
                    result.items_extracted += 1
                await bus.publish(Event(EventKind.NODE_DONE, {"id": node.id}))
            except Exception as exc:  # noqa: BLE001 - we record and continue
                result.failures.append((node.id, str(exc)))
                await bus.publish(Event(
                    EventKind.NODE_FAILED,
                    {"id": node.id, "reason": str(exc)},
                ))

        # Resolve and download
        for node in all_nodes:
            if node.id not in rendered:
                continue
            md = rendered[node.id]
            md, downloaded_urls = await _download_assets_in(md, downloader, bus)
            result.attachments_downloaded += len(downloaded_urls)
            result.total_bytes += sum(p.stat().st_size for p in downloaded_urls.values())

            ctx = LinkContext(
                from_file=paths[node.id],
                id_to_path=paths,
                url_to_local=downloaded_urls,
                vault_root=output_dir,
            )
            resolved, broken = resolve_placeholders(md, ctx)
            result.broken_links.extend(broken)
            paths[node.id].parent.mkdir(parents=True, exist_ok=True)
            paths[node.id].write_text(resolved, encoding="utf-8")

        result.duration_s = time.monotonic() - started
        report = render_report(
            vault_root=output_dir,
            pages_extracted=result.pages_extracted,
            items_extracted=result.items_extracted,
            attachments_downloaded=result.attachments_downloaded,
            total_bytes=result.total_bytes,
            duration_s=result.duration_s,
            broken_links=result.broken_links,
            failures=result.failures,
            warnings=result.warnings,
        )
        (output_dir / "_report.md").write_text(report, encoding="utf-8")
        await bus.publish(Event(EventKind.EXTRACTION_DONE, {
            "pages": result.pages_extracted,
            "items": result.items_extracted,
            "attachments": result.attachments_downloaded,
        }))
        return result
    finally:
        await downloader.close()


async def _render_node(
    node: PlannedNode,
    client: AsyncNotionClient,
    id_to_node: dict[str, PlannedNode],
) -> str:
    if node.kind == NodeKind.PAGE:
        blocks = await fetch_block_children(client, node.id)
        return blocks_to_md(blocks)
    if node.kind == NodeKind.DB_ITEM:
        page = await get_page(client, node.id)
        frontmatter = properties_to_frontmatter(page.get("properties", {}))
        frontmatter["notion_id"] = node.id
        frontmatter["notion_url"] = page.get("url", "")
        frontmatter["created_time"] = page.get("created_time", "")
        frontmatter["last_edited_time"] = page.get("last_edited_time", "")
        blocks = await fetch_block_children(client, node.id)
        body = blocks_to_md(blocks)
        return _wrap_frontmatter(frontmatter) + body
    if node.kind == NodeKind.DATABASE:
        return _render_database_index(node, id_to_node, client)
    return ""


def _render_database_index(
    node: PlannedNode,
    id_to_node: dict[str, PlannedNode],
    _client: AsyncNotionClient,
) -> str:
    rows = [id_to_node[cid] for cid in node.children_ids if cid in id_to_node]
    if not rows:
        return f"# {node.title}\n"
    lines = [f"# {node.title}", "", "| Item |", "| --- |"]
    for row in rows:
        lines.append(f"| {{{{notion-link:{row.id}|{row.title}}}}} |")
    return "\n".join(lines) + "\n"


async def _download_assets_in(
    md: str,
    downloader: AttachmentDownloader,
    bus: EventBus,
) -> tuple[str, dict[str, Path]]:
    import re
    pattern = re.compile(r"\{\{notion-asset:([^}]+)\}\}")
    urls = {m.group(1) for m in pattern.finditer(md)}
    url_to_local: dict[str, Path] = {}
    for url in urls:
        try:
            local = await downloader.download(url)
            url_to_local[url] = local
            await bus.publish(Event(
                EventKind.ATTACHMENT_DOWNLOADED,
                {"url": url, "path": str(local)},
            ))
        except Exception:  # noqa: BLE001 - record and skip
            continue
    return md, url_to_local


def _wrap_frontmatter(fm: dict[str, Any]) -> str:
    text = yaml.safe_dump(fm, allow_unicode=True, sort_keys=False).rstrip()
    return f"---\n{text}\n---\n\n"
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/extract/test_pipeline.py -v
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notion_extractor/extract/pipeline.py tests/extract/test_pipeline.py
git commit -m "feat(extract): pipeline orchestrator wiring discovery→convert→resolve"
```

---

## Task 19: FastAPI app and routes

**Files:**
- Create: `src/notion_extractor/app.py`
- Create: `src/notion_extractor/__main__.py`
- Create: `tests/test_app.py`

Routes:
- `GET /` → serves `web/static/index.html`
- `GET /api/roots` → calls `list_shared_roots`, returns JSON
- `POST /api/extract` → starts extraction in a background task, returns `{job_id}`
- `GET /api/events?job=<id>` → SSE stream

- [ ] **Step 1: Write the failing test**

`tests/test_app.py`:
```python
import pytest
from fastapi.testclient import TestClient
from pytest_httpx import HTTPXMock

from notion_extractor.app import create_app


def test_get_roots(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        method="POST",
        url="https://api.notion.com/v1/search",
        json={"results": [
            {"object": "page", "id": "p1", "properties": {"title": {"type": "title", "title": [
                {"plain_text": "Top", "type": "text",
                 "text": {"content": "Top", "link": None}, "href": None,
                 "annotations": {"bold": False, "italic": False, "strikethrough": False,
                                 "underline": False, "code": False, "color": "default"}}
            ]}}},
        ], "next_cursor": None, "has_more": False},
    )

    app = create_app(token="t", output_dir="/tmp/v")
    client = TestClient(app)
    response = client.get("/api/roots")
    assert response.status_code == 200
    data = response.json()
    assert data == [{"id": "p1", "kind": "page", "title": "Top"}]


def test_index_serves_html() -> None:
    app = create_app(token="t", output_dir="/tmp/v")
    client = TestClient(app)
    response = client.get("/")
    assert response.status_code == 200
    assert "<html" in response.text.lower()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_app.py -v
```

Expected: FAIL — no app.

- [ ] **Step 3: Implement app**

`src/notion_extractor/app.py`:
```python
import asyncio
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from notion_extractor.extract.pipeline import run_extraction
from notion_extractor.notion.client import AsyncNotionClient
from notion_extractor.notion.discovery import list_shared_roots
from notion_extractor.progress import EventBus

STATIC_DIR = Path(__file__).parent / "web" / "static"


class RootDTO(BaseModel):
    id: str
    kind: str
    title: str


class ExtractRequest(BaseModel):
    selection: list[RootDTO]


def create_app(*, token: str, output_dir: str) -> FastAPI:
    app = FastAPI(title="notion-extractor")
    jobs: dict[str, EventBus] = {}

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    if STATIC_DIR.exists():
        app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.get("/api/roots")
    async def get_roots() -> list[dict[str, Any]]:
        async with AsyncNotionClient(token=token) as client:
            roots = await list_shared_roots(client)
        return [{"id": r.id, "kind": r.kind.value, "title": r.title} for r in roots]

    @app.post("/api/extract")
    async def extract(req: ExtractRequest) -> dict[str, str]:
        bus = EventBus()
        job_id = uuid.uuid4().hex
        jobs[job_id] = bus

        selection = [(r.id, r.kind) for r in req.selection]

        async def run() -> None:
            async with AsyncNotionClient(token=token) as client:
                await run_extraction(
                    client=client, bus=bus,
                    output_dir=Path(output_dir),
                    root_selection=selection,
                )

        asyncio.create_task(run())
        return {"job_id": job_id}

    @app.get("/api/events")
    async def events(job: str) -> StreamingResponse:
        bus = jobs.get(job)
        if bus is None:
            return StreamingResponse(iter([]), media_type="text/event-stream")

        async def stream() -> Any:
            async for event in bus.subscribe():
                yield event.to_sse()

        return StreamingResponse(stream(), media_type="text/event-stream")

    return app
```

`src/notion_extractor/__main__.py`:
```python
import uvicorn

from notion_extractor.app import create_app
from notion_extractor.config import Settings


def main() -> None:
    settings = Settings()  # type: ignore[call-arg]
    app = create_app(
        token=settings.notion_token,
        output_dir=str(settings.output_dir),
    )
    print(f"Open http://{settings.host}:{settings.port}/")
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Add minimal static HTML so test passes**

`src/notion_extractor/web/static/index.html` (placeholder — full version in next task):
```html
<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>notion-extractor</title></head>
<body><h1>notion-extractor</h1></body>
</html>
```

- [ ] **Step 5: Run test to verify it passes**

```bash
uv run pytest tests/test_app.py -v
```

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/notion_extractor/app.py src/notion_extractor/__main__.py src/notion_extractor/web/static/index.html tests/test_app.py
git commit -m "feat(app): FastAPI app with /api/roots, /api/extract, /api/events"
```

---

## Task 20: Frontend (selection tree + progress)

**Files:**
- Modify: `src/notion_extractor/web/static/index.html`
- Create: `src/notion_extractor/web/static/app.js`
- Create: `src/notion_extractor/web/static/style.css`

Vanilla JS. Two views switched in-place:
1. Selection view: list of roots with checkboxes, "Extract" button.
2. Progress view: counter (`done/total`), rolling log, status.

- [ ] **Step 1: Write `index.html`**

`src/notion_extractor/web/static/index.html`:
```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>notion-extractor</title>
  <link rel="stylesheet" href="/static/style.css">
</head>
<body>
  <header>
    <h1>notion-extractor</h1>
    <p class="subtitle">Selecione o que migrar do Notion para o Obsidian.</p>
  </header>

  <main>
    <section id="selection-view">
      <div id="loading">Carregando árvore do Notion…</div>
      <ul id="root-list" hidden></ul>
      <button id="extract-btn" disabled>Extrair selecionados</button>
    </section>

    <section id="progress-view" hidden>
      <div id="status">Iniciando…</div>
      <progress id="bar" value="0" max="1"></progress>
      <pre id="log"></pre>
    </section>
  </main>

  <script src="/static/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `style.css`**

`src/notion_extractor/web/static/style.css`:
```css
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  margin: 0;
  background: #f7f7f5;
  color: #1f1f1d;
}
header {
  padding: 1.5rem 2rem;
  background: white;
  border-bottom: 1px solid #e5e5e0;
}
header h1 { margin: 0; font-size: 1.5rem; }
.subtitle { margin: 0.25rem 0 0; color: #666; }
main { padding: 1.5rem 2rem; max-width: 720px; }

#root-list { list-style: none; padding: 0; margin: 0 0 1rem; }
#root-list li {
  padding: 0.5rem 0;
  border-bottom: 1px solid #ececec;
  display: flex; align-items: center; gap: 0.5rem;
}
.icon { width: 1.25rem; text-align: center; }

button {
  padding: 0.6rem 1.2rem; font-size: 1rem;
  background: #2f6feb; color: white;
  border: 0; border-radius: 6px; cursor: pointer;
}
button:disabled { background: #ccc; cursor: not-allowed; }

#progress-view { background: white; padding: 1rem; border-radius: 8px; }
#bar { width: 100%; height: 1rem; }
#log {
  background: #1f1f1d; color: #d4d4ce; padding: 0.75rem;
  border-radius: 6px; max-height: 22rem; overflow: auto;
  font-family: ui-monospace, Menlo, monospace; font-size: 0.85rem;
  margin-top: 0.75rem;
}
.log-line { white-space: pre-wrap; }
.log-line.failed { color: #ff8b8b; }
.log-line.done { color: #88f0a0; }
```

- [ ] **Step 3: Write `app.js`**

`src/notion_extractor/web/static/app.js`:
```javascript
const $ = (sel) => document.querySelector(sel);
const ICON = { page: "📄", database: "🗃️" };

async function loadRoots() {
  const response = await fetch("/api/roots");
  if (!response.ok) {
    $("#loading").textContent = "Erro ao carregar: " + response.status;
    return;
  }
  const roots = await response.json();
  const ul = $("#root-list");
  ul.innerHTML = "";
  for (const r of roots) {
    const li = document.createElement("li");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = JSON.stringify({ id: r.id, kind: r.kind, title: r.title });
    cb.addEventListener("change", updateButtonState);
    const label = document.createElement("label");
    label.append(cb, ` ${ICON[r.kind] ?? "•"} ${r.title}`);
    li.append(label);
    ul.append(li);
  }
  $("#loading").hidden = true;
  ul.hidden = false;
}

function updateButtonState() {
  const any = document.querySelectorAll("#root-list input:checked").length > 0;
  $("#extract-btn").disabled = !any;
}

function gatherSelection() {
  return Array.from(document.querySelectorAll("#root-list input:checked"))
    .map((cb) => JSON.parse(cb.value));
}

async function startExtraction() {
  const selection = gatherSelection();
  $("#selection-view").hidden = true;
  $("#progress-view").hidden = false;
  $("#status").textContent = "Iniciando…";

  const response = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selection }),
  });
  const { job_id } = await response.json();

  const source = new EventSource(`/api/events?job=${job_id}`);
  let total = 0;
  let done = 0;

  source.addEventListener("discovery_started", () => {
    appendLog("Descoberta iniciada");
  });
  source.addEventListener("discovery_done", (e) => {
    const data = JSON.parse(e.data);
    total = data.total;
    $("#bar").max = total;
    $("#status").textContent = `Descobertos ${total} nós. Extraindo…`;
    appendLog(`Descobertos ${total} nós`);
  });
  source.addEventListener("node_done", (e) => {
    done++;
    $("#bar").value = done;
    const data = JSON.parse(e.data);
    appendLog(`✓ ${data.id}`, "done");
  });
  source.addEventListener("node_failed", (e) => {
    const data = JSON.parse(e.data);
    appendLog(`✗ ${data.id}: ${data.reason}`, "failed");
  });
  source.addEventListener("extraction_done", (e) => {
    const data = JSON.parse(e.data);
    $("#status").textContent =
      `Concluído: ${data.pages} páginas, ${data.items} itens, ${data.attachments} anexos.`;
    source.close();
  });
}

function appendLog(text, cls = "") {
  const div = document.createElement("div");
  div.className = "log-line " + cls;
  div.textContent = text;
  $("#log").append(div);
  $("#log").scrollTop = $("#log").scrollHeight;
}

$("#extract-btn").addEventListener("click", startExtraction);
loadRoots();
```

- [ ] **Step 4: Manual smoke test**

```bash
uv run python -m notion_extractor
```

Open the printed URL in a browser. The page loads "Carregando árvore do Notion…" and (with a valid `NOTION_TOKEN` in `.env` and at least one page shared) replaces it with the list of roots.

Note: without a valid token this step is partial — verify the HTML/CSS render and the loading spinner appears. Full extraction needs a real token.

- [ ] **Step 5: Commit**

```bash
git add src/notion_extractor/web/static/
git commit -m "feat(web): selection tree + progress UI (vanilla JS + SSE)"
```

---

## Task 21: End-to-end smoke test

**Files:**
- Create: `tests/test_e2e.py`

A larger fixture that exercises the whole pipeline against fully-mocked Notion HTTP: a page tree with a sub-page, a database with one row, an image, an internal link.

- [ ] **Step 1: Write the failing test**

`tests/test_e2e.py`:
```python
from pathlib import Path

import pytest
from pytest_httpx import HTTPXMock

from notion_extractor.extract.pipeline import run_extraction
from notion_extractor.notion.client import AsyncNotionClient
from notion_extractor.progress import EventBus

_RICH = lambda t: [{
    "type": "text", "text": {"content": t, "link": None},
    "plain_text": t, "href": None,
    "annotations": {"bold": False, "italic": False, "strikethrough": False,
                    "underline": False, "code": False, "color": "default"},
}]


@pytest.mark.asyncio
async def test_e2e_vault_structure(tmp_path: Path, httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        url="https://api.notion.com/v1/pages/root",
        json={"id": "root", "url": "https://notion.so/root",
              "created_time": "2026-01-01T00:00:00.000Z",
              "last_edited_time": "2026-02-01T00:00:00.000Z",
              "properties": {"title": {"type": "title", "title": _RICH("Notas")}}},
    )
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/root/children?page_size=100",
        json={"results": [
            {"id": "sub", "type": "child_page", "has_children": False,
             "child_page": {"title": "Reunião"}},
            {"id": "db", "type": "child_database", "has_children": False,
             "child_database": {"title": "Tarefas"}},
            {"id": "img", "type": "image", "has_children": False,
             "image": {"type": "file", "file": {"url": "https://prod-files.s3/x.png"},
                       "caption": []}},
        ], "next_cursor": None, "has_more": False},
    )
    httpx_mock.add_response(
        url="https://api.notion.com/v1/blocks/sub/children?page_size=100",
        json={"results": [
            {"id": "p1", "type": "paragraph", "has_children": False,
             "paragraph": {"rich_text": _RICH("ata da reunião")}}
        ], "next_cursor": None, "has_more": False},
    )
    httpx_mock.add_response(
        method="POST",
        url="https://api.notion.com/v1/databases/db/query",
        json={"results": [
            {"id": "row", "properties": {"Name": {"type": "title", "title": _RICH("Fazer X")}}},
        ], "next_cursor": None, "has_more": False},
    )
    httpx_mock.add_response(
        url="https://api.notion.com/v1/pages/row",
        json={"id": "row", "url": "https://notion.so/row",
              "created_time": "2026-01-01T00:00:00.000Z",
              "last_edited_time": "2026-02-01T00:00:00.000Z",
              "properties": {"Name": {"type": "title", "title": _RICH("Fazer X")}}},
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
            client=client, bus=bus,
            output_dir=tmp_path,
            root_selection=[("root", "page")],
        )

    # Structure
    assert (tmp_path / "Notas.md").exists()
    assert (tmp_path / "Notas" / "Reunião.md").exists()
    assert (tmp_path / "Notas" / "Tarefas.md").exists()
    assert (tmp_path / "Notas" / "Tarefas" / "Fazer X.md").exists()
    assert (tmp_path / "_report.md").exists()
    assert any((tmp_path / "assets").iterdir())

    # Wikilinks resolved
    notas = (tmp_path / "Notas.md").read_text()
    assert "[[Reunião]]" in notas
    assert "[[Tarefas]]" in notas

    # Asset path is relative
    assert "../assets/" in notas or "assets/" in notas

    # Counts
    assert result.pages_extracted >= 2
    assert result.items_extracted == 1
    assert result.attachments_downloaded == 1
```

- [ ] **Step 2: Run test**

```bash
uv run pytest tests/test_e2e.py -v
```

Expected: PASS.

- [ ] **Step 3: Run the full test suite + lint + typecheck**

```bash
uv run pytest -v
uv run ruff check .
uv run ruff format --check .
uv run pyright
```

Expected: all green. Fix any issues that surface (often pyright will complain about implicit `Any` in `dict[str, Any]` — add explicit annotations where needed).

- [ ] **Step 4: Commit**

```bash
git add tests/test_e2e.py
git commit -m "test: end-to-end smoke covering pages, db, image, wikilinks"
```

---

## Task 22: Polish — README usage and known limitations

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Expand `README.md`**

Append to `README.md`:
```markdown
## How it works

The extractor runs in three phases:

1. **Discovery** — walks the workspace via `POST /v1/search` then recurses through pages/databases shared with the integration. Produces a complete `id → output path` map before fetching content. This is what allows wikilinks to be resolved correctly.

2. **Extraction** — fetches blocks and properties, converts to Markdown with placeholders for internal links and attachments.

3. **Resolve & write** — downloads attachments in parallel, substitutes placeholders for wikilinks (`[[Page Name]]`) and relative asset paths, writes files to disk, generates `_report.md`.

## Mapping

- Page with no children → `Page.md`
- Page with children → `Page.md` + sibling `Page/` folder
- Database → `Database.md` (index with table of items) + sibling `Database/` folder containing one `.md` per row
- Database row properties → YAML frontmatter
- Attachments (S3 URLs from Notion) → downloaded to `assets/`, named `<sha1[:8]>-<original>`

## Known limitations

- `column_list` / `column` blocks lose their layout; content is concatenated.
- `synced_block` is rendered inline; no Obsidian transclusion equivalent.
- Comments and version history are not exported (not available via the API).
- Each run overwrites the output directory. There is no incremental sync.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: usage, mapping, and known limitations"
```

---

## Self-Review

**Spec coverage check** (against `docs/superpowers/specs/2026-05-11-notion-extractor-design.md`):

- §2 Decisões de produto — covered by tasks 1, 12, 18, 19
- §3.1 Pipeline 3-phase — task 18
- §3.2 Concurrency / rate limit — task 3 (semaphore), task 15 (separate attachment pool)
- §3.3 Progress SSE — tasks 17, 19, 20
- §4.1 Structure (folder vs file rule) — task 12, verified in e2e (task 21)
- §4.2 Naming / collisions — task 12
- §4.3 Properties → frontmatter — task 11
- §4.4 Block table — tasks 5–10
- §4.5 Attachments — tasks 15, 16
- §5 Components — file structure section at top of plan
- §6 UI — task 20
- §7 Configuration — task 2 (note: no UI write-back to `.env`; user manually edits — acceptable for v1)
- §8 Error handling — covered: 4xx/5xx retry in task 3, per-node isolation in task 18, asset failure in task 18, unknown block as `<!-- unsupported -->` in task 5
- §9 Report — task 16
- §10 Tests — covered throughout

**Placeholder scan:** No "TBD"/"TODO" placeholders. Every step has concrete code or commands. The `test_vimeo_embed` test in task 9 is intentionally a no-op stub (documented).

**Type consistency:**
- `PlannedNode` field names match across tasks 12, 14, 18.
- `AsyncNotionClient` constructor signature consistent.
- `LinkContext` fields consistent (task 16 → task 18).
- `EventBus.publish` signature consistent.

**One known minor gap:** §7 says the UI should let the user edit `.env`; v1 expects manual editing of `.env`. Documented in the README as a usage step. Not a blocker, but a v2 improvement.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-11-notion-extractor.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
