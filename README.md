# notion-2-obsidian

Migrate a Notion workspace to an Obsidian vault. Runs locally on your machine. No cloud, no OAuth, no telemetry.

```
npx notion-2-obsidian@latest
```

That's it. Open the URL it prints, paste your Notion integration token, pick a folder, select what to migrate.

## What you need

- **Node 20+** on your machine.
- **A Notion internal integration** — create one at https://www.notion.so/profile/integrations. Copy the token.
- **Share pages with the integration** inside Notion (`···` menu → Connections → your integration). Sub-pages and database rows come along automatically.

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

- Pages with sub-pages become a `.md` file plus a sibling folder of the same name. Wikilinks resolve unambiguously.
- Databases become folders of one `.md` per row, plus an index `.md`. Properties go into YAML frontmatter.
- Mentions, relations, and `link_to_page` become `[[Wikilinks]]`. Links pointing to pages you didn't select are listed in `_report.md`.

See https://oandre.github.io/notion-2-obsidian/docs for details.

## Development

This is a monorepo with two independent npm projects:

- `app/` — the published npm package (Fastify backend + React frontend, TypeScript)
- `site/` — the Astro static site that's published to GitHub Pages

Both use `npm`. In each directory:

```bash
npm install
npm test           # app only
npm run lint
npm run build
```

### Running locally (your own migration)

If you cloned the repo and want to run the tool against your own Notion workspace without publishing to npm:

```bash
cd app
npm install
npm run build
npm start
```

The browser opens at `http://127.0.0.1:8765/`. The `.env` is read/written in the directory you ran `npm start` from, so run it from wherever you want the config and output files to live.

### Working on the app (back + front with hot reload)

A single command starts both processes in parallel:

```bash
cd app
npm install
npm run dev
```

This runs the Fastify backend (`tsx watch` on `:8765`) and the Vite dev server (`:5173` with `/api` proxy) side by side. Open **http://localhost:5173/** for HMR on the React side — API requests are proxied to Fastify automatically. Edit any `.ts` under `src/server/` and `tsx watch` restarts; edit any `.tsx` under `src/web/` and Vite hot-reloads.

## Releases

- The app publishes to npm on push of a `v*` tag (e.g. `v0.2.0`). Tag, push the tag, the workflow does the rest.
- The site deploys to Pages on every push to `main` that touches `site/**`.

## License

MIT.
