# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## What this project is

A local Node CLI that migrates a Notion workspace to an Obsidian vault. Distributed as `npx notion-2-obsidian`. There is also a marketing/legal/docs site in `site/` deployed to GitHub Pages.

## Repo layout

- `app/` — the published npm package. TypeScript, Fastify backend, React + Vite frontend. The frontend is built and embedded inside `dist/` so a single `node dist/bin/cli.js` boots the local server with static files baked in.
- `site/` — Astro static site (landing, privacy, terms, docs). Deploys to GitHub Pages.
- `docs/superpowers/specs/` — design docs. Read these before making non-trivial changes.

`app/` and `site/` are independent npm projects (no workspaces). Each has its own `package.json`, lockfile, and CI step.

## The three-phase pipeline (the load-bearing idea)

`app/src/server/extract/pipeline.ts:runExtraction` orchestrates three phases. The split exists because **wikilinks can only be resolved after every output path is known**. Don't merge the phases.

1. **Discovery** (`server/notion/discovery.ts`) — walks every selected root and builds a `PlannedNode[]`. Each node caches its `blocks` and `pageData` so the next phase doesn't refetch.
2. **Render** — turns each node's cached blocks into Markdown with placeholders: `{{notion-link:<id>|<label>}}` and `{{notion-asset:<url>}}`.
3. **Resolve & write** (`server/extract/resolve.ts`) — downloads assets, regex-substitutes placeholders, writes `.md` files and `_report.md`.

If you add a new block type that links to another page or attaches a file, **emit a placeholder** — don't try to resolve at render time.

## Where each kind of work goes

- **New block type:** add a handler in `app/src/server/convert/blocks.ts` and register it in `HANDLERS`. Pure function `(block, ctx) => string`. Add a test in `blocks.<topic>.test.ts`.
- **New property type:** extend `app/src/server/convert/properties.ts:convertProp`. Output must be YAML-serializable.
- **Changing path rules** (file vs folder, slug, collisions): `app/src/server/extract/plan.ts:planPaths`.
- **New Notion API call:** wrap it in `app/src/server/notion/fetch.ts` so it inherits paginated handling. Don't call `client.get/post` from elsewhere — go through `NotionClient`, which centralizes the rate-limit semaphore and retries.

## Conventions

- Notion API rate limit is ~3 req/s. `NotionClient` enforces it with `p-limit(3)`. Attachment downloads use a separate `p-limit(8)` (S3, not Notion).
- The conversion layer (`server/convert/`) must stay pure — no I/O. Anything that needs the network goes in `server/extract/pipeline.ts`.
- Tests use undici's `MockAgent` for HTTP and `happy-dom` for React components. There are no real-network tests.
- Per-node failures are isolated: a bad page logs into `result.failures` and the pipeline continues. Don't add `throw` paths that abort the whole run.
- Each run overwrites the output directory by design — no incremental sync, no merge logic.

## v0.1 history

The v0.1 Python implementation is preserved at the `v0.1-python` git tag. Its specs are in `docs/superpowers/specs/2026-05-11-notion-extractor-design.md` and its test suite was the executable spec used to port the conversion layer.
