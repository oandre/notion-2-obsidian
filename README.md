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
