# notion-2-obsidian

Migrate a Notion workspace to an Obsidian vault. Runs locally on your machine. No cloud, no OAuth, no telemetry.

The tool spins up a small web UI on `localhost`, you pick which Notion pages/databases to extract, and it writes a clean Obsidian vault with wikilinks, frontmatter and downloaded attachments.

> Site: https://oandre.github.io/notion-2-obsidian/ · Docs: https://oandre.github.io/notion-2-obsidian/docs/

## 1. Create a Notion integration

1. Go to https://www.notion.so/profile/integrations and click **+ New integration**.
2. Pick **Internal** (not Public). Name it whatever you want (e.g. "Migrate to Obsidian"), associate it with your workspace, **Save**.
3. On the integration's **Configuration** page, set the capabilities to the minimum the tool actually needs:

   | Capability | Setting |
   |---|---|
   | Read content | ✅ |
   | Update content | ❌ |
   | Insert content | ❌ |
   | Read comments | ❌ |
   | Insert comments | ❌ |
   | User capabilities | **Read user information without email addresses** |

   The tool only reads pages and blocks. It never writes back to Notion. User names are only used to populate `people` properties in YAML frontmatter; email addresses aren't read.

4. Copy the **Internal Integration Token** (`ntn_...` or `secret_...`) — you'll paste it into the app shortly.

## 2. Share pages with the integration

Inside Notion, open the top-level page or database you want to migrate. Click the `···` menu (top-right) → **Connections** → pick your integration. Repeat for each top-level you want to extract. Sub-pages and database rows are reachable automatically once their root is shared.

## 3. Run the tool

You'll need **Node 20+** installed.

```bash
git clone https://github.com/oandre/notion-2-obsidian.git
cd notion-2-obsidian/app
npm install
npm run build
npm start
```

Your browser opens at `http://127.0.0.1:8765/`. The first screen asks for the token + an output directory (absolute path, e.g. `/Users/you/Obsidian/MyVault`). Save → you'll see the tree of pages and databases shared with the integration → tick what you want → **Extract**. Progress streams in real time. When it's done, open the output directory in Obsidian as a vault.

> **Note about `npx`:** once the package lands on npm, you'll be able to skip the clone with `npx notion-2-obsidian@latest`. Until then, the clone-and-build flow above is the way.

## What you get

```
your-vault/
├── _report.md                # what got extracted, broken links, failures
├── assets/                   # all downloaded images/PDFs/etc.
├── Notes/
│   ├── Notes.md              # page content
│   └── Sub-page.md
└── Tasks/
    ├── Tasks.md              # index with table of items
    ├── Do X.md               # one .md per database row
    └── Do Y.md
```

- Pages **without** sub-pages → a single `.md` file.
- Pages **with** sub-pages → a `.md` file *plus* a sibling folder of the same name. Wikilinks resolve unambiguously.
- Databases → a folder of one `.md` per row, plus an index `.md` with a Markdown table. Properties go into YAML frontmatter.
- Mentions, relations and `link_to_page` become `[[Wikilinks]]`. Links pointing to pages you didn't select are listed in `_report.md` so you can decide whether to come back and extract them too.
- Attachments (S3 URLs from Notion) are downloaded to `assets/` and links rewritten to relative paths.

Full conversion details: https://oandre.github.io/notion-2-obsidian/docs/

## Troubleshooting

- **The UI shows "Nenhuma página/database compartilhada"** — you forgot step 2. Share at least one top-level page with the integration inside Notion.
- **401/403 in the log** — token is invalid or expired. Generate a new one from the integration's page and start fresh (delete `.env` and re-configure in the UI).
- **A link in the vault is "(link removed)" or plain text** — the linked page wasn't part of your selection. Check `_report.md` for the list and re-run with the missing pages selected.
- **Want to start over** — delete the output directory and re-run. Each run overwrites everything (except the `.notion-2-obsidian-cache.json` cache file at the root — see below).
- **Workspace tree feels out of date** — the picker caches the workspace structure in `<output>/.notion-2-obsidian-cache.json` so reopens are instant. Click the **↻ Refresh** button in the picker header to re-walk the workspace. The cache also invalidates automatically if the token suddenly points to a different workspace.

## Development

Two independent npm projects: `app/` (the CLI) and `site/` (the Astro landing/docs at GitHub Pages).

```bash
cd app
npm install
npm test          # 110 tests, no network
npm run lint
npm run typecheck
```

### Hot-reload dev mode

```bash
cd app && npm run dev
```

Starts Fastify (`tsx watch` on `:8765`) and Vite (`:5173` with `/api` proxy) in parallel. Open **http://localhost:5173/** — Vite gives you HMR on the React side and proxies API calls to Fastify. Edits to `src/server/**.ts` restart Fastify; edits to `src/web/**.tsx` hot-reload in the browser.

### Project layout

- `app/src/server/notion/` — undici-based Notion API client (rate-limited via `p-limit(3)`, retries 429/5xx)
- `app/src/server/convert/` — pure block- and property-to-Markdown converters
- `app/src/server/extract/` — path planning, attachment downloader, placeholder resolution, the three-phase pipeline
- `app/src/web/` — React frontend (SetupView, TreeView, ProgressView)
- `app/src/server/app.ts` — Fastify wiring
- `app/bin/cli.ts` — `npx` entrypoint
- `site/` — Astro static site for GitHub Pages
- `docs/superpowers/specs/` — design docs for v0.1 (Python) and v0.2 (current)

See `CLAUDE.md` for an orientation aimed at coding agents.

## Releases

- The CLI publishes to npm when a `v*` git tag is pushed (e.g. `v0.2.0`). Workflow: `.github/workflows/publish-npm.yml`.
- The site auto-deploys to GitHub Pages on every push to `main` that touches `site/**`.

## License

MIT.
