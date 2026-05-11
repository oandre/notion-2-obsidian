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
