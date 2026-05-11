# notion-2-obsidian

Migrate a Notion workspace to an Obsidian vault with a local web UI. Pick the pages and databases you want, get a clean vault with wikilinks, frontmatter, and downloaded attachments.

> Each user runs this locally with their own Notion **internal integration**. No cloud account, no OAuth, nothing leaves your machine except the API calls to Notion.

## Setup

1. Create a Notion **internal integration** at https://www.notion.so/profile/integrations:
   - Click *New integration* → give it a name → pick your workspace → Save.
   - This is the *internal* integration form, not the public/OAuth one. It only asks for name + workspace. No Privacy Policy or Redirect URI needed.
   - Copy the **Internal Integration Token** it shows you.
2. **Share** the top-level pages/databases you want to extract with the integration:
   - In Notion, open the page → click `···` (top-right) → `Connections` → pick your integration.
   - Sub-pages and database rows are reachable automatically once the top-level is shared.
3. Clone this repo and install:
   ```bash
   git clone https://github.com/oandre/notion-2-obsidian.git
   cd notion-2-obsidian
   uv sync --extra dev
   ```
   (Install `uv` first if you don't have it: https://docs.astral.sh/uv/)
4. Configure:
   ```bash
   cp .env.example .env
   # edit .env and fill in NOTION_TOKEN and OUTPUT_DIR
   ```
5. Run:
   ```bash
   uv run notion-extractor
   ```
   Open the URL it prints (default `http://127.0.0.1:8765/`). Tick the pages you want and click *Extract*.

## What it produces

```
your-vault/
├── _report.md                       # what got extracted, broken links, failures
├── assets/                          # all downloaded images/PDFs/etc.
├── Notes/
│   ├── Notes.md                     # page content
│   └── Sub-page.md
└── Tasks/
    ├── Tasks.md                     # index with table of items
    ├── Do X.md                      # one .md per database row
    └── Do Y.md
```

- A page **without** sub-pages becomes a `.md` file.
- A page **with** sub-pages becomes a `.md` file *plus* a sibling folder of the same name. Wikilinks resolve unambiguously.
- A database becomes a folder of one `.md` per row, plus an index `.md`. Properties go into YAML frontmatter.
- Internal references (mentions, relations, link_to_page) become `[[Wikilinks]]`. Links pointing to pages you didn't select are listed in `_report.md`.

## Conversion fidelity

Supported with high fidelity: paragraphs, headings, bullet/numbered/todo lists (including nested), quotes, code blocks (language preserved), callouts (with emoji→Obsidian-type mapping), toggles (`<details>`), tables, block + inline equations (`$...$` / `$$...$$`), images, files, PDFs, video, audio, native embeds for YouTube/X/Vimeo/Loom/Figma.

Known limitations: `column_list` loses its layout, `synced_block` is rendered inline (no transclusion), comments and version history are not exported (no API for them), each run overwrites the output directory (no incremental sync).

## Development

- `uv run pytest` — run tests (~100 tests, all mocked HTTP, no network)
- `uv run pytest tests/convert/test_inline.py::test_bold -v` — run a single test
- `uv run ruff check .` / `uv run ruff format .` — lint / format
- `uv run pyright` — type check

See `CLAUDE.md` for the architecture overview and `docs/superpowers/specs/` for the original design doc.

## License

MIT. See [LICENSE](LICENSE).
