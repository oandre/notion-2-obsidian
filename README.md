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

For development on the app, use two terminals:

```bash
cd app
npm run dev:server     # Fastify on :8765
# in another terminal:
npm run dev:web        # Vite on :5173 with /api proxy
```

## Releases

- The app publishes to npm on push of a `v*` tag (e.g. `v0.2.0`). Tag, push the tag, the workflow does the rest.
- The site deploys to Pages on every push to `main` that touches `site/**`.

## License

MIT.
