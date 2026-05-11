# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A local Python web app that migrates a Notion workspace to an Obsidian vault. The user runs it locally, picks pages/databases via a browser UI, and the tool produces Markdown with wikilinks, frontmatter, and downloaded attachments.

Living design docs:
- `docs/superpowers/specs/2026-05-11-notion-extractor-design.md` — architecture and decisions
- `docs/superpowers/plans/2026-05-11-notion-extractor.md` — implementation plan, with the actual code each task expects

When making non-trivial changes, read the spec first; design rationale (e.g. why the three-phase pipeline, why placeholders) is there, not in code comments.

## Commands

- `uv sync --extra dev` — install dependencies (one-time)
- `uv run notion-extractor` — launch the web app on `http://127.0.0.1:8765/`
- `uv run pytest` — full test suite
- `uv run pytest tests/convert/test_inline.py::test_bold -v` — single test
- `uv run ruff check .` / `uv run ruff format .` — lint / format
- `uv run pyright` — type check (strict mode is configured)

## The three-phase pipeline (the load-bearing idea)

`src/notion_extractor/extract/pipeline.py:run_extraction` orchestrates three phases. The split exists because **wikilinks can only be resolved after every output path is known**. Don't merge the phases.

1. **Discovery** (`notion/discovery.py`) — walks every selected root and builds a list of `PlannedNode`. Each node caches its `blocks` and `page_data` so the next phase doesn't refetch.
2. **Render** — turns each node's cached blocks into Markdown with placeholders: `{{notion-link:<id>|<label>}}` and `{{notion-asset:<url>}}`.
3. **Resolve & write** (`extract/resolve.py`) — downloads assets, then a regex pass substitutes placeholders. Wikilinks come from the `id → path` map produced in phase 1; assets become paths relative to each file. Unknown ids go into a broken-link report (`_report.md` at the vault root).

If you need to add a new block type that links to another page or attaches a file, **emit a placeholder** — don't try to resolve at render time.

## Where each kind of work goes

- **New block type**: add a handler in `convert/blocks.py` and register it in `_HANDLERS`. Pure function: `(block, ctx) → str`. Add a test in `tests/convert/`.
- **New property type for database rows**: extend `convert/properties.py:_convert`. Output must be YAML-serializable.
- **Changing output path rules** (file vs folder, slug, collisions): `extract/plan.py:plan_paths`. Rule today: a node becomes a folder iff it has children (databases always have children); leaves are bare `.md` files; folders also get a sibling `<Name>.md`.
- **New Notion API call**: wrap it in `notion/fetch.py` so it inherits paginated handling and the rate-limit semaphore. Don't call `client.get/post` from elsewhere.

## Conventions worth knowing

- The Notion API limit is ~3 req/s; `AsyncNotionClient` enforces this with a `Semaphore(3)`. Attachment downloads use a separate `Semaphore(8)` since they hit S3, not Notion.
- The conversion layer (`convert/`) must stay pure — no I/O. Anything that needs the network goes in `extract/pipeline.py`.
- Tests use `pytest-httpx` to mock the Notion API. There are no real-network tests.
- Per-node failures are isolated: a bad page is logged into `result.failures` and the pipeline continues. Don't add `raise` paths that abort the whole run.
- Each run overwrites the output directory by design — no incremental sync, no merge logic.
