# Node Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `notion-2-obsidian` from Python to TypeScript on Node 20+, distributed as `npx notion-2-obsidian`, with a React+Vite frontend embedded in the npm package and an Astro static site for landing/privacy/terms deployed to GitHub Pages.

**Architecture:** Fastify backend serves a React SPA at `localhost`. Three-phase async pipeline (discovery → render with placeholders → resolve + write). Conversion layer is pure functions. The Astro site is independent, deployed by a GitHub Action.

**Tech Stack:** TypeScript (strict), Node 20+, Fastify, undici, p-limit, React 18, Vite, Vitest, Biome, Astro, Tailwind, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-05-11-node-rewrite-design.md`

**Reference (executable spec for conversion):** `git show v0.1-python:tests/convert/*.py`. The conversion behavior is identical; port test cases verbatim, adapting only the syntax (Vitest `expect` instead of `assert`).

---

## File Structure (final)

```
notion-2-obsidian/
├── README.md
├── LICENSE
├── CLAUDE.md
├── .gitignore
├── .github/workflows/
│   ├── ci.yml
│   ├── publish-npm.yml
│   └── publish-pages.yml
├── docs/superpowers/specs/   # kept from v0.1
├── app/
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.server.json
│   ├── biome.json
│   ├── vite.config.ts
│   ├── vitest.config.ts
│   ├── index.html               # Vite entry (web)
│   ├── bin/cli.ts
│   └── src/
│       ├── server/
│       │   ├── app.ts
│       │   ├── config.ts
│       │   ├── progress.ts
│       │   ├── routes/
│       │   │   ├── status.ts
│       │   │   ├── setup.ts
│       │   │   ├── roots.ts
│       │   │   ├── extract.ts
│       │   │   └── events.ts
│       │   ├── notion/
│       │   │   ├── client.ts
│       │   │   ├── fetch.ts
│       │   │   └── discovery.ts
│       │   ├── convert/
│       │   │   ├── inline.ts
│       │   │   ├── blocks.ts
│       │   │   └── properties.ts
│       │   └── extract/
│       │       ├── plan.ts
│       │       ├── attachments.ts
│       │       ├── resolve.ts
│       │       └── pipeline.ts
│       ├── shared/types.ts
│       └── web/
│           ├── main.tsx
│           ├── App.tsx
│           ├── api.ts
│           ├── components/
│           │   ├── SetupView.tsx
│           │   ├── TreeView.tsx
│           │   └── ProgressView.tsx
│           └── styles.css
└── site/
    ├── package.json
    ├── astro.config.mjs
    ├── tailwind.config.mjs
    └── src/
        ├── layouts/Default.astro
        ├── pages/index.astro
        ├── pages/privacy.astro
        ├── pages/terms.astro
        └── pages/docs/index.astro
```

---

## Phase 1 — Repo prep

## Task 1: Preserve Python v0.1 in a git tag, then remove it

**Files:**
- Delete: `src/notion_extractor/`, `tests/`, `pyproject.toml`, `uv.lock`, `.python-version` (if present), `.pytest_cache/`, `.ruff_cache/`, `.venv/`
- Modify: `.gitignore` (drop Python-specific entries, keep generic OS/editor ones)
- Modify: `README.md` (placeholder pointing to in-progress rewrite)
- Modify: `CLAUDE.md` (placeholder)

- [ ] **Step 1: Tag the current Python v0.1 commit and push the tag**

```bash
git tag -a v0.1-python -m "v0.1: Python implementation (preserved for history)"
git push origin v0.1-python
```

- [ ] **Step 2: Remove Python source and tooling**

```bash
git rm -r src/notion_extractor tests
git rm pyproject.toml uv.lock
rm -rf .venv .pytest_cache .ruff_cache
```

- [ ] **Step 3: Rewrite `.gitignore` for Node**

Replace `.gitignore` contents with:

```
# Node
node_modules/
dist/
*.log
.npm/
.eslintcache

# Env / secrets
.env
.env.local

# IDE
.vscode/
.idea/
*.swp

# OS
.DS_Store
Thumbs.db

# Coverage
coverage/
.nyc_output/

# Astro
.astro/

# Vite
.vite/
```

- [ ] **Step 4: Drop placeholder README and CLAUDE.md**

Replace `README.md`:

```markdown
# notion-2-obsidian (v0.2 — rewrite in progress)

Migrate a Notion workspace to an Obsidian vault.

> **v0.2 is being rewritten in TypeScript.** For the working v0.1 Python implementation, check out the [`v0.1-python`](https://github.com/oandre/notion-2-obsidian/tree/v0.1-python) tag.

Setup, usage, and docs will return when v0.2 lands.
```

Replace `CLAUDE.md`:

```markdown
# CLAUDE.md

## Current state: v0.2 rewrite in progress

The repo is being rewritten from Python (v0.1) to TypeScript (v0.2) per:
- Spec: `docs/superpowers/specs/2026-05-11-node-rewrite-design.md`
- Plan: `docs/superpowers/plans/2026-05-11-node-rewrite.md`

The Python implementation is preserved at git tag `v0.1-python` (and `legacy/python` branch if present). Do not edit those — they are archived.

This CLAUDE.md will be rewritten with v0.2 architecture notes once the rewrite lands. Until then, follow the plan task-by-task.
```

- [ ] **Step 5: Commit the cleanup**

```bash
git add -A
git commit -m "chore: remove Python v0.1 (preserved in tag v0.1-python)"
```

---

## Task 2: Scaffold `app/` package

**Files:**
- Create: `app/package.json`, `app/tsconfig.json`, `app/tsconfig.server.json`, `app/biome.json`, `app/vite.config.ts`, `app/vitest.config.ts`, `app/index.html`
- Create: `app/src/server/.gitkeep`, `app/src/web/.gitkeep`, `app/src/shared/.gitkeep`, `app/bin/.gitkeep`

- [ ] **Step 1: Write `app/package.json`**

```json
{
  "name": "notion-2-obsidian",
  "version": "0.2.0-alpha.0",
  "description": "Migrate a Notion workspace to an Obsidian vault. Runs locally.",
  "type": "module",
  "license": "MIT",
  "author": "André Simões",
  "homepage": "https://github.com/oandre/notion-2-obsidian",
  "repository": { "type": "git", "url": "git+https://github.com/oandre/notion-2-obsidian.git" },
  "bin": { "notion-2-obsidian": "dist/cli.js" },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "node": ">=20" },
  "scripts": {
    "dev:server": "tsx watch bin/cli.ts",
    "dev:web": "vite",
    "build:web": "vite build",
    "build:server": "tsc -p tsconfig.server.json",
    "build": "npm run build:web && npm run build:server",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check src bin",
    "format": "biome format --write src bin",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@fastify/static": "^7.0.4",
    "dotenv": "^16.4.5",
    "fastify": "^4.28.1",
    "open": "^10.1.0",
    "p-limit": "^5.0.0",
    "undici": "^6.19.8",
    "yaml": "^2.5.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.8.3",
    "@testing-library/react": "^16.0.1",
    "@types/node": "^20.16.5",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "happy-dom": "^15.7.4",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tsx": "^4.19.0",
    "typescript": "^5.6.2",
    "vite": "^5.4.6",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: Write `app/tsconfig.json`** (shared base, includes both server and web for `tsc --noEmit`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src", "bin"]
}
```

- [ ] **Step 3: Write `app/tsconfig.server.json`** (emits CommonJS-friendly ESM for the server)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Node",
    "outDir": "dist",
    "rootDir": ".",
    "declaration": false,
    "noEmit": false,
    "jsx": "react-jsx"
  },
  "include": ["src/server", "src/shared", "bin"]
}
```

- [ ] **Step 4: Write `app/biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.8.3/schema.json",
  "files": { "ignore": ["dist", "node_modules", "src/web/dist"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true, "style": { "noNonNullAssertion": "off" } }
  },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "always" } }
}
```

- [ ] **Step 5: Write `app/vite.config.ts`** (frontend build only)

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: '.',
  plugins: [react()],
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
  },
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:8765' },
  },
});
```

- [ ] **Step 6: Write `app/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environmentMatchGlobs: [['src/web/**', 'happy-dom']],
  },
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') },
  },
});
```

- [ ] **Step 7: Write `app/index.html`** (Vite entry; the built file is served by Fastify)

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>notion-2-obsidian</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/web/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Create empty source directories with `.gitkeep`**

```bash
mkdir -p app/src/server app/src/web app/src/shared app/bin
touch app/src/server/.gitkeep app/src/web/.gitkeep app/src/shared/.gitkeep app/bin/.gitkeep
```

- [ ] **Step 9: Install dependencies and verify the toolchain**

```bash
cd app && npm install && npm run typecheck && npm run lint
```

Expected: install completes, typecheck has nothing to check (no .ts files yet — should still exit 0), `biome check` passes on empty dirs.

- [ ] **Step 10: Commit**

```bash
cd ..
git add app/
git commit -m "chore(app): scaffold TS + Fastify + React + Vite + Vitest + Biome"
```

---

## Phase 2 — Server-side ports from v0.1

For tasks 3–11, the conversion rules are identical to v0.1. Each task lists the source-of-truth Python test file at the `v0.1-python` tag; port those test cases to Vitest. Sample cases are inline as templates.

## Task 3: Notion API client (`AsyncNotionClient` equivalent)

**Files:**
- Create: `app/src/server/notion/client.ts`
- Test: `app/src/server/notion/client.test.ts`

Reference: `git show v0.1-python:tests/notion/test_client.py`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/server/notion/client.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { NotionClient } from './client.js';

let mock: MockAgent;
let previous: Dispatcher;

beforeEach(() => {
  previous = getGlobalDispatcher();
  mock = new MockAgent();
  mock.disableNetConnect();
  setGlobalDispatcher(mock);
});

afterEach(async () => {
  await mock.close();
  setGlobalDispatcher(previous);
});

describe('NotionClient', () => {
  it('sets Authorization and Notion-Version on GET', async () => {
    const pool = mock.get('https://api.notion.com');
    pool.intercept({ path: '/v1/pages/abc', method: 'GET' }).reply(200, { id: 'abc' });

    const client = new NotionClient({ token: 'secret_xyz' });
    const result = await client.get('/pages/abc');
    expect(result).toEqual({ id: 'abc' });
  });

  it('retries on 429', async () => {
    const pool = mock.get('https://api.notion.com');
    pool.intercept({ path: '/x', method: 'GET' }).reply(429, '', { headers: { 'retry-after': '0' } });
    pool.intercept({ path: '/x', method: 'GET' }).reply(200, { ok: true });

    const client = new NotionClient({ token: 't', maxRetries: 3, backoffBaseMs: 0 });
    const result = await client.get('/x');
    expect(result).toEqual({ ok: true });
  });

  it('throws on persistent 5xx after maxRetries', async () => {
    const pool = mock.get('https://api.notion.com');
    for (let i = 0; i < 4; i++) pool.intercept({ path: '/x', method: 'GET' }).reply(503, '');

    const client = new NotionClient({ token: 't', maxRetries: 3, backoffBaseMs: 0 });
    await expect(client.get('/x')).rejects.toThrow(/503/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npm test -- src/server/notion/client.test.ts
```

Expected: FAIL — `Cannot find module './client.js'`.

- [ ] **Step 3: Implement `NotionClient`**

```ts
// app/src/server/notion/client.ts
import { request, type Dispatcher } from 'undici';
import pLimit from 'p-limit';

const BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export interface NotionClientOptions {
  token: string;
  concurrency?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  timeoutMs?: number;
}

export class NotionClient {
  private readonly token: string;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly timeoutMs: number;
  private readonly limit: ReturnType<typeof pLimit>;

  constructor(opts: NotionClientOptions) {
    this.token = opts.token;
    this.maxRetries = opts.maxRetries ?? 5;
    this.backoffBaseMs = opts.backoffBaseMs ?? 500;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.limit = pLimit(opts.concurrency ?? 3);
  }

  get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: Dispatcher.HttpMethod, path: string, body?: unknown): Promise<T> {
    return this.limit(async () => {
      let attempt = 0;
      while (true) {
        const res = await request(`${BASE}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${this.token}`,
            'notion-version': NOTION_VERSION,
            'content-type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          headersTimeout: this.timeoutMs,
          bodyTimeout: this.timeoutMs,
        });

        if (res.statusCode < 400) {
          return (await res.body.json()) as T;
        }

        const retryable = res.statusCode === 429 || (res.statusCode >= 500 && res.statusCode <= 599);
        if (retryable && attempt < this.maxRetries) {
          const retryAfter = Number(res.headers['retry-after'] ?? 0);
          const waitMs = Math.max(retryAfter * 1000, this.backoffBaseMs * 2 ** attempt);
          await res.body.dump();
          await new Promise((r) => setTimeout(r, waitMs));
          attempt++;
          continue;
        }

        const text = await res.body.text();
        throw new Error(`Notion API ${method} ${path} → ${res.statusCode}: ${text}`);
      }
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd app && npm test -- src/server/notion/client.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd .. && git add app/src/server/notion/ && git commit -m "feat(notion): undici-based rate-limited client with retry"
```

---

## Task 4: Shared types

**Files:**
- Create: `app/src/shared/types.ts`

These types are used by both server and (some of them) frontend.

- [ ] **Step 1: Write types**

```ts
// app/src/shared/types.ts
export type NodeKind = 'page' | 'database' | 'db_item';

export interface PlannedNode {
  id: string;
  kind: NodeKind;
  title: string;
  parentId: string | null;
  childrenIds: string[];
  blocks: NotionBlock[];
  pageData: Record<string, unknown>;
}

export interface NotionBlock {
  id?: string;
  type: string;
  has_children?: boolean;
  children?: NotionBlock[];
  [key: string]: unknown;
}

export interface RootDTO {
  id: string;
  kind: NodeKind;
  title: string;
}

export interface ExtractRequest {
  selection: Array<{ id: string; kind: NodeKind }>;
}

export type ProgressEventKind =
  | 'discovery_started'
  | 'discovery_progress'
  | 'discovery_done'
  | 'node_started'
  | 'node_done'
  | 'node_failed'
  | 'attachment_downloaded'
  | 'extraction_done'
  | 'error';

export interface ProgressEvent {
  kind: ProgressEventKind;
  data: Record<string, unknown>;
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
cd app && npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd .. && git add app/src/shared/ && git commit -m "feat(shared): types for nodes, blocks, DTOs, progress events"
```

---

## Task 5: Inline rich text → Markdown

**Files:**
- Create: `app/src/server/convert/inline.ts`
- Test: `app/src/server/convert/inline.test.ts`

Reference (full test suite to port): `git show v0.1-python:tests/convert/test_inline.py`. The behavior is identical; just adapt `assert ... == ...` → `expect(...).toBe(...)`.

- [ ] **Step 1: Write the test file (port from v0.1 + template cases below)**

```ts
// app/src/server/convert/inline.test.ts
import { describe, it, expect } from 'vitest';
import { richTextToMd } from './inline.js';

function seg(text: string, opts: Partial<{
  bold: boolean; italic: boolean; code: boolean;
  strikethrough: boolean; underline: boolean; href: string | null;
}> = {}) {
  return {
    type: 'text',
    text: { content: text, link: opts.href ? { url: opts.href } : null },
    plain_text: text,
    href: opts.href ?? null,
    annotations: {
      bold: !!opts.bold,
      italic: !!opts.italic,
      strikethrough: !!opts.strikethrough,
      underline: !!opts.underline,
      code: !!opts.code,
      color: 'default',
    },
  };
}

describe('richTextToMd', () => {
  it('plain text', () => expect(richTextToMd([seg('hello')])).toBe('hello'));
  it('bold', () => expect(richTextToMd([seg('hi', { bold: true })])).toBe('**hi**'));
  it('italic', () => expect(richTextToMd([seg('hi', { italic: true })])).toBe('*hi*'));
  it('bold+italic', () => expect(richTextToMd([seg('hi', { bold: true, italic: true })])).toBe('***hi***'));
  it('strikethrough', () => expect(richTextToMd([seg('hi', { strikethrough: true })])).toBe('~~hi~~'));
  it('underline as <u>', () => expect(richTextToMd([seg('hi', { underline: true })])).toBe('<u>hi</u>'));
  it('inline code', () => expect(richTextToMd([seg('x', { code: true })])).toBe('`x`'));
  it('link', () => expect(richTextToMd([seg('docs', { href: 'https://x.dev' })])).toBe('[docs](https://x.dev)'));
  it('link with bold', () =>
    expect(richTextToMd([seg('docs', { bold: true, href: 'https://x.dev' })])).toBe('[**docs**](https://x.dev)'));
  it('concatenates segments', () =>
    expect(richTextToMd([seg('hello '), seg('world', { bold: true })])).toBe('hello **world**'));
  it('empty', () => expect(richTextToMd([])).toBe(''));

  it('mention page emits placeholder', () => {
    const mention = {
      type: 'mention',
      mention: { type: 'page', page: { id: 'abc-123' } },
      plain_text: 'Some Page',
      href: 'https://www.notion.so/abc123',
      annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
    };
    expect(richTextToMd([mention])).toBe('{{notion-link:abc-123|Some Page}}');
  });

  it('mention date prints plain text', () => {
    const mention = {
      type: 'mention',
      mention: { type: 'date', date: { start: '2026-05-11' } },
      plain_text: '2026-05-11',
      href: null,
      annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
    };
    expect(richTextToMd([mention])).toBe('2026-05-11');
  });

  it('inline equation', () => {
    const eq = {
      type: 'equation',
      equation: { expression: 'x^2' },
      plain_text: 'x^2',
      href: null,
      annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
    };
    expect(richTextToMd([eq])).toBe('$x^2$');
  });
});
```

- [ ] **Step 2: Run test, see it fail**

```bash
cd app && npm test -- src/server/convert/inline.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// app/src/server/convert/inline.ts
type Annotations = { bold?: boolean; italic?: boolean; strikethrough?: boolean; underline?: boolean; code?: boolean };

interface Segment {
  type?: string;
  plain_text?: string;
  href?: string | null;
  annotations?: Annotations;
  equation?: { expression: string };
  mention?: { type: string; page?: { id: string }; database?: { id: string } };
}

export function richTextToMd(segments: Segment[]): string {
  return segments.map(segmentToMd).join('');
}

function segmentToMd(seg: Segment): string {
  if (seg.type === 'equation' && seg.equation) return `$${seg.equation.expression}$`;
  if (seg.type === 'mention') return mentionToMd(seg);
  return textToMd(seg);
}

function textToMd(seg: Segment): string {
  const text = seg.plain_text ?? '';
  if (!text) return '';
  const a = seg.annotations ?? {};
  let out = text;
  if (a.code) out = `\`${out}\``;
  if (a.bold && a.italic) out = `***${out}***`;
  else if (a.bold) out = `**${out}**`;
  else if (a.italic) out = `*${out}*`;
  if (a.strikethrough) out = `~~${out}~~`;
  if (a.underline) out = `<u>${out}</u>`;
  if (seg.href) out = `[${out}](${seg.href})`;
  return out;
}

function mentionToMd(seg: Segment): string {
  const m = seg.mention;
  const plain = seg.plain_text ?? '';
  if (!m) return plain;
  if (m.type === 'page' && m.page) return `{{notion-link:${m.page.id}|${plain}}}`;
  if (m.type === 'database' && m.database) return `{{notion-link:${m.database.id}|${plain}}}`;
  return plain; // user, date, etc.
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd app && npm test -- src/server/convert/inline.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd .. && git add app/src/server/convert/inline.ts app/src/server/convert/inline.test.ts
git commit -m "feat(convert): rich_text segments to Markdown inline"
```

---

## Task 6: Block converter — basic blocks

**Files:**
- Create: `app/src/server/convert/blocks.ts`
- Test: `app/src/server/convert/blocks.basic.test.ts`

Reference: `git show v0.1-python:tests/convert/test_blocks_basic.py` (11 tests).

- [ ] **Step 1: Write the basic-block test file**

Port all 11 cases from the reference. Template (one full case + signatures, port the rest):

```ts
// app/src/server/convert/blocks.basic.test.ts
import { describe, it, expect } from 'vitest';
import { blocksToMd } from './blocks.js';

function rich(content: string) {
  return [{
    type: 'text',
    text: { content, link: null },
    plain_text: content,
    href: null,
    annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
  }];
}

function block(type: string, payload: Record<string, unknown>, children: any[] = []) {
  return { type, [type]: payload, has_children: children.length > 0, children };
}

describe('blocks_to_md — basic', () => {
  it('paragraph', () => {
    expect(blocksToMd([block('paragraph', { rich_text: rich('hello') })])).toBe('hello\n');
  });

  it('headings 1/2/3', () => {
    const blocks = [
      block('heading_1', { rich_text: rich('A') }),
      block('heading_2', { rich_text: rich('B') }),
      block('heading_3', { rich_text: rich('C') }),
    ];
    expect(blocksToMd(blocks)).toBe('# A\n\n## B\n\n### C\n');
  });

  it('bulleted list', () => {
    const blocks = [
      block('bulleted_list_item', { rich_text: rich('one') }),
      block('bulleted_list_item', { rich_text: rich('two') }),
    ];
    expect(blocksToMd(blocks)).toBe('- one\n- two\n');
  });

  it('numbered list', () => {
    const blocks = [
      block('numbered_list_item', { rich_text: rich('one') }),
      block('numbered_list_item', { rich_text: rich('two') }),
    ];
    expect(blocksToMd(blocks)).toBe('1. one\n2. two\n');
  });

  it('numbered list resets after paragraph', () => {
    const blocks = [
      block('numbered_list_item', { rich_text: rich('one') }),
      block('paragraph', { rich_text: rich('p') }),
      block('numbered_list_item', { rich_text: rich('two') }),
    ];
    expect(blocksToMd(blocks)).toBe('1. one\n\np\n\n1. two\n');
  });

  it('to_do checked and unchecked', () => {
    const blocks = [
      block('to_do', { rich_text: rich('do it'), checked: false }),
      block('to_do', { rich_text: rich('done'), checked: true }),
    ];
    expect(blocksToMd(blocks)).toBe('- [ ] do it\n- [x] done\n');
  });

  it('quote', () => {
    expect(blocksToMd([block('quote', { rich_text: rich('wise words') })])).toBe('> wise words\n');
  });

  it('divider', () => {
    expect(blocksToMd([block('divider', {})])).toBe('---\n');
  });

  it('code block with language', () => {
    expect(blocksToMd([block('code', { rich_text: rich('print(1)'), language: 'python' })])).toBe(
      '```python\nprint(1)\n```\n'
    );
  });

  it('code block plain text strips language fence', () => {
    expect(blocksToMd([block('code', { rich_text: rich('x'), language: 'plain text' })])).toBe('```\nx\n```\n');
  });

  it('nested bulleted children are indented two spaces', () => {
    const child = block('bulleted_list_item', { rich_text: rich('child') });
    const parent = block('bulleted_list_item', { rich_text: rich('parent') }, [child]);
    expect(blocksToMd([parent])).toBe('- parent\n  - child\n');
  });
});
```

- [ ] **Step 2: Run, see failures**

```bash
cd app && npm test -- src/server/convert/blocks.basic.test.ts
```

- [ ] **Step 3: Implement basic handlers**

```ts
// app/src/server/convert/blocks.ts
import { richTextToMd } from './inline.js';

type Block = Record<string, any>;
type Ctx = { indent: number };
type Handler = (block: Block, ctx: Ctx) => string;

export function blocksToMd(blocks: Block[]): string {
  return renderBlocks(blocks, { indent: 0 });
}

function renderBlocks(blocks: Block[], ctx: Ctx): string {
  const out: string[] = [];
  let prevType: string | null = null;
  let counter = 0;

  for (const block of blocks) {
    const t: string = block.type ?? '';
    let line: string;

    if (t === 'numbered_list_item') {
      if (prevType !== 'numbered_list_item') counter = 0;
      counter++;
      line = renderNumbered(block, counter, ctx);
    } else {
      counter = 0;
      line = renderBlock(block, ctx);
    }

    if (line) {
      const sep = separator(prevType, t);
      if (sep && out.length) out.push(sep);
      out.push(line);
    }
    prevType = t;
  }
  return out.join('');
}

function separator(prev: string | null, current: string): string {
  const listTypes = new Set(['bulleted_list_item', 'numbered_list_item', 'to_do']);
  if (prev && listTypes.has(prev) && listTypes.has(current) && prev === current) return '';
  if (prev === null) return '';
  return '\n';
}

function renderBlock(block: Block, ctx: Ctx): string {
  const handler = HANDLERS[block.type];
  if (!handler) return `<!-- unsupported block: ${block.type} -->\n`;
  return handler(block, ctx);
}

function indentStr(ctx: Ctx) {
  return '  '.repeat(ctx.indent);
}

function renderChildren(block: Block, ctx: Ctx): string {
  const children = block.children ?? [];
  if (!children.length) return '';
  return renderBlocks(children, { indent: ctx.indent + 1 });
}

const paragraph: Handler = (block, ctx) => {
  const text = richTextToMd(block.paragraph.rich_text);
  return `${indentStr(ctx)}${text}\n${renderChildren(block, ctx)}`;
};

const heading = (level: 1 | 2 | 3): Handler => (block, ctx) => {
  const key = `heading_${level}` as const;
  const text = richTextToMd(block[key].rich_text);
  return `${'#'.repeat(level)} ${text}\n${renderChildren(block, ctx)}`;
};

const bulleted: Handler = (block, ctx) => {
  const text = richTextToMd(block.bulleted_list_item.rich_text);
  return `${indentStr(ctx)}- ${text}\n${renderChildren(block, ctx)}`;
};

function renderNumbered(block: Block, n: number, ctx: Ctx): string {
  const text = richTextToMd(block.numbered_list_item.rich_text);
  return `${indentStr(ctx)}${n}. ${text}\n${renderChildren(block, ctx)}`;
}

const todo: Handler = (block, ctx) => {
  const p = block.to_do;
  const text = richTextToMd(p.rich_text);
  const mark = p.checked ? 'x' : ' ';
  return `${indentStr(ctx)}- [${mark}] ${text}\n${renderChildren(block, ctx)}`;
};

const quote: Handler = (block, ctx) => {
  const text = richTextToMd(block.quote.rich_text);
  return `> ${text}\n${renderChildren(block, ctx)}`;
};

const divider: Handler = () => '---\n';

const code: Handler = (block) => {
  const p = block.code;
  const lang = p.language === 'plain text' ? '' : (p.language ?? '');
  const text = richTextToMd(p.rich_text);
  return `\`\`\`${lang}\n${text}\n\`\`\`\n`;
};

const HANDLERS: Record<string, Handler> = {
  paragraph,
  heading_1: heading(1),
  heading_2: heading(2),
  heading_3: heading(3),
  bulleted_list_item: bulleted,
  to_do: todo,
  quote,
  divider,
  code,
};

export const __INTERNAL__ = { HANDLERS };
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd app && npm test -- src/server/convert/blocks.basic.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd .. && git add app/src/server/convert/blocks.ts app/src/server/convert/blocks.basic.test.ts
git commit -m "feat(convert): basic blocks to Markdown"
```

---

## Task 7: Block converter — callouts and toggles

**Files:**
- Modify: `app/src/server/convert/blocks.ts`
- Create: `app/src/server/convert/blocks.callout-toggle.test.ts`

Reference: `git show v0.1-python:tests/convert/test_blocks_callout_toggle.py` (8 tests).

- [ ] **Step 1: Port the 8 test cases**

```ts
// app/src/server/convert/blocks.callout-toggle.test.ts
import { describe, it, expect } from 'vitest';
import { blocksToMd } from './blocks.js';

function rich(content: string) {
  return [{
    type: 'text', text: { content, link: null }, plain_text: content, href: null,
    annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
  }];
}

function block(type: string, payload: Record<string, unknown>, children: any[] = []) {
  return { type, [type]: payload, has_children: children.length > 0, children };
}

describe('callouts and toggles', () => {
  it('callout default note (unknown emoji)', () => {
    expect(blocksToMd([block('callout', { rich_text: rich('heads up'), icon: { type: 'emoji', emoji: '🗒️' } })])).toBe(
      '> [!note]\n> heads up\n'
    );
  });
  it('callout tip from 💡', () => {
    expect(blocksToMd([block('callout', { rich_text: rich('nice'), icon: { type: 'emoji', emoji: '💡' } })])).toBe(
      '> [!tip]\n> nice\n'
    );
  });
  it('callout warning from ⚠️', () => {
    expect(blocksToMd([block('callout', { rich_text: rich('careful'), icon: { type: 'emoji', emoji: '⚠️' } })])).toBe(
      '> [!warning]\n> careful\n'
    );
  });
  it('callout danger from ❌', () => {
    expect(blocksToMd([block('callout', { rich_text: rich('nope'), icon: { type: 'emoji', emoji: '❌' } })])).toBe(
      '> [!danger]\n> nope\n'
    );
  });
  it('callout info from ℹ️', () => {
    expect(blocksToMd([block('callout', { rich_text: rich('fyi'), icon: { type: 'emoji', emoji: 'ℹ️' } })])).toBe(
      '> [!info]\n> fyi\n'
    );
  });
  it('callout with multi-line children', () => {
    const child = block('paragraph', { rich_text: rich('extra') });
    const b = block('callout', { rich_text: rich('main'), icon: { type: 'emoji', emoji: '💡' } }, [child]);
    expect(blocksToMd([b])).toBe('> [!tip]\n> main\n>\n> extra\n');
  });
  it('toggle collapsible with content', () => {
    const child = block('paragraph', { rich_text: rich('hidden') });
    const b = block('toggle', { rich_text: rich('Click me') }, [child]);
    expect(blocksToMd([b])).toBe('<details>\n<summary>Click me</summary>\n\nhidden\n\n</details>\n');
  });
  it('toggle empty', () => {
    const b = block('toggle', { rich_text: rich('Click me') });
    expect(blocksToMd([b])).toBe('<details>\n<summary>Click me</summary>\n\n</details>\n');
  });
});
```

- [ ] **Step 2: Run, see failures**

```bash
cd app && npm test -- src/server/convert/blocks.callout-toggle.test.ts
```

- [ ] **Step 3: Add callout + toggle handlers to `blocks.ts`**

Append to `app/src/server/convert/blocks.ts` (above the final `__INTERNAL__` export):

```ts
const CALLOUT_EMOJI_MAP: Record<string, string> = {
  '💡': 'tip',
  '⚠️': 'warning',
  '❌': 'danger',
  '🚫': 'danger',
  'ℹ️': 'info',
  '✅': 'success',
  '❓': 'question',
};

const callout: Handler = (block) => {
  const p = block.callout;
  const text = richTextToMd(p.rich_text);
  const icon = p.icon ?? {};
  const emoji = icon.type === 'emoji' ? icon.emoji : '';
  const type = CALLOUT_EMOJI_MAP[emoji] ?? 'note';
  const lines = [`> [!${type}]`, `> ${text}`];
  const children = block.children ?? [];
  if (children.length) {
    const childMd = renderBlocks(children, { indent: 0 }).replace(/\n+$/, '');
    lines.push('>');
    for (const line of childMd.split('\n')) {
      lines.push(line ? `> ${line}` : '>');
    }
  }
  return `${lines.join('\n')}\n`;
};

const toggle: Handler = (block, ctx) => {
  const summary = richTextToMd(block.toggle.rich_text);
  const childMd = renderChildren(block, ctx).replace(/^\s+|\s+$/g, '');
  const inner = childMd ? `\n${childMd}\n` : '';
  return `<details>\n<summary>${summary}</summary>\n${inner}\n</details>\n`;
};

HANDLERS.callout = callout;
HANDLERS.toggle = toggle;
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd app && npm test -- src/server/convert/blocks.callout-toggle.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd .. && git add app/src/server/convert/blocks.ts app/src/server/convert/blocks.callout-toggle.test.ts
git commit -m "feat(convert): callouts and toggles"
```

---

## Task 8: Block converter — tables, equations, media, embeds, links

A single task that ports the remaining block types in one batch — they're all small additions to `HANDLERS`. Each subsection lists the v0.1 reference for porting test cases.

**Files:**
- Modify: `app/src/server/convert/blocks.ts`
- Create: `app/src/server/convert/blocks.tables.test.ts`, `blocks.equation.test.ts`, `blocks.media.test.ts`, `blocks.embed.test.ts`, `blocks.links.test.ts`

Port test cases from these v0.1 files:
- `git show v0.1-python:tests/convert/test_blocks_table.py` (2 tests)
- `git show v0.1-python:tests/convert/test_blocks_equation.py` (1 test)
- `git show v0.1-python:tests/convert/test_blocks_media.py` (5 tests)
- `git show v0.1-python:tests/convert/test_blocks_embed.py` (5 tests)
- `git show v0.1-python:tests/convert/test_blocks_links.py` (4 tests)

- [ ] **Step 1: Write all five test files** (port from references; use template at top of each file matching Task 7's helpers).

- [ ] **Step 2: Run, see failures**

```bash
cd app && npm test -- src/server/convert/blocks.tables.test.ts src/server/convert/blocks.equation.test.ts src/server/convert/blocks.media.test.ts src/server/convert/blocks.embed.test.ts src/server/convert/blocks.links.test.ts
```

- [ ] **Step 3: Append the handlers to `app/src/server/convert/blocks.ts`**

```ts
// Tables
const tableBlock: Handler = (block) => {
  const table = block.table;
  const width: number = table.table_width ?? 0;
  const hasHeader: boolean = !!table.has_column_header;
  const rows: Block[] = block.children ?? [];
  const renderRow = (cells: any[]): string => {
    const rendered = cells.map((c) => richTextToMd(c));
    const padded = [...rendered, ...Array(Math.max(0, width - rendered.length)).fill('')];
    return `| ${padded.join(' | ')} |\n`;
  };
  const out: string[] = [];
  let body: Block[] = rows;
  if (hasHeader && rows.length) {
    out.push(renderRow(rows[0].table_row.cells));
    out.push(`| ${Array(width).fill('---').join(' | ')} |\n`);
    body = rows.slice(1);
  } else {
    out.push(`| ${Array(width).fill('').join(' | ')} |\n`);
    out.push(`| ${Array(width).fill('---').join(' | ')} |\n`);
  }
  for (const row of body) out.push(renderRow(row.table_row.cells));
  return out.join('');
};

// Equation (block)
const equationBlock: Handler = (block) => `$$\n${block.equation.expression}\n$$\n`;

// Media
import { URL as NodeURL } from 'node:url';
function mediaUrlAndExternal(payload: any): { url: string; external: boolean } {
  const kind = payload.type ?? 'file';
  const inner = payload[kind] ?? {};
  return { url: inner.url ?? '', external: kind === 'external' };
}
function assetTarget(url: string, external: boolean) {
  return external ? url : `{{notion-asset:${url}}}`;
}
function basename(url: string): string {
  try {
    const u = new NodeURL(url);
    const last = u.pathname.split('/').pop();
    return last || 'file';
  } catch {
    return url.split('/').pop() || 'file';
  }
}

const image: Handler = (block) => {
  const p = block.image;
  const { url, external } = mediaUrlAndExternal(p);
  const caption = richTextToMd(p.caption ?? []);
  return `![${caption}](${assetTarget(url, external)})\n`;
};
const fileLike = (field: string): Handler => (block) => {
  const p = block[field];
  const { url, external } = mediaUrlAndExternal(p);
  const caption = richTextToMd(p.caption ?? []) || basename(url);
  return `[${caption}](${assetTarget(url, external)})\n`;
};

// Embeds
const OBSIDIAN_EMBED_HOSTS = new Set([
  'www.youtube.com','youtube.com','youtu.be',
  'twitter.com','x.com','vimeo.com',
  'loom.com','www.loom.com','figma.com','www.figma.com',
]);
function isEmbeddable(url: string): boolean {
  try { return OBSIDIAN_EMBED_HOSTS.has(new NodeURL(url).hostname); } catch { return false; }
}
function displayUrl(url: string): string {
  try {
    const u = new NodeURL(url);
    if (u.pathname && u.pathname !== '/') return `${u.hostname}${u.pathname}`;
    return u.hostname || url;
  } catch { return url; }
}
const embedBlock = (field: string): Handler => (block) => {
  const p = block[field];
  const url: string = p.url ?? '';
  const caption = richTextToMd(p.caption ?? []);
  if (isEmbeddable(url)) return `![${caption}](${url})\n`;
  const display = caption || displayUrl(url);
  return `[${display}](${url})\n`;
};

// Links
const childPage: Handler = (block) => {
  const id = block.id ?? '';
  const title = block.child_page?.title ?? '';
  return `{{notion-link:${id}|${title}}}\n`;
};
const childDatabase: Handler = (block) => {
  const id = block.id ?? '';
  const title = block.child_database?.title ?? '';
  return `{{notion-link:${id}|${title}}}\n`;
};
const linkToPage: Handler = (block) => {
  const p = block.link_to_page;
  if (p.type === 'page_id') return `{{notion-link:${p.page_id}}}\n`;
  if (p.type === 'database_id') return `{{notion-link:${p.database_id}}}\n`;
  return '';
};

HANDLERS.table = tableBlock;
HANDLERS.equation = equationBlock;
HANDLERS.image = image;
HANDLERS.pdf = fileLike('pdf');
HANDLERS.file = fileLike('file');
HANDLERS.video = fileLike('video');
HANDLERS.audio = fileLike('audio');
HANDLERS.bookmark = embedBlock('bookmark');
HANDLERS.embed = embedBlock('embed');
HANDLERS.link_preview = embedBlock('link_preview');
HANDLERS.child_page = childPage;
HANDLERS.child_database = childDatabase;
HANDLERS.link_to_page = linkToPage;
```

Note: move the `import { URL as NodeURL } from 'node:url';` to the top of the file (after the existing imports) when you actually edit.

- [ ] **Step 4: Run all 5 test files, expect PASS**

- [ ] **Step 5: Commit**

```bash
cd .. && git add app/src/server/convert/ && git commit -m "feat(convert): tables, equations, media, embeds, link blocks"
```

---

## Task 9: Properties → frontmatter

**Files:**
- Create: `app/src/server/convert/properties.ts`, `app/src/server/convert/properties.test.ts`

Reference: `git show v0.1-python:tests/convert/test_properties.py` (18 tests). Port all of them.

- [ ] **Step 1: Write the test file** (port all 18 cases; one template below)

```ts
import { describe, it, expect } from 'vitest';
import { propertiesToFrontmatter } from './properties.js';

const richTitle = (text: string) => ({
  type: 'title',
  title: [{
    type: 'text', plain_text: text, text: { content: text, link: null }, href: null,
    annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
  }],
});

describe('propertiesToFrontmatter', () => {
  it('title', () => expect(propertiesToFrontmatter({ Name: richTitle('Fazer X') })).toEqual({ Name: 'Fazer X' }));
  // ... 17 more
});
```

- [ ] **Step 2: Run, see failures**

```bash
cd app && npm test -- src/server/convert/properties.test.ts
```

- [ ] **Step 3: Implement**

```ts
// app/src/server/convert/properties.ts
import { richTextToMd } from './inline.js';

type Prop = Record<string, any>;

export function propertiesToFrontmatter(props: Record<string, Prop>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(props)) out[name] = convertProp(prop);
  return out;
}

function convertProp(prop: Prop): unknown {
  switch (prop.type) {
    case 'title': return richTextToMd(prop.title ?? []);
    case 'rich_text': return richTextToMd(prop.rich_text ?? []);
    case 'number': return prop.number;
    case 'select': return prop.select?.name ?? null;
    case 'multi_select': return (prop.multi_select ?? []).map((i: any) => i.name);
    case 'status': return prop.status?.name ?? null;
    case 'date': return dateToStr(prop.date);
    case 'checkbox': return prop.checkbox;
    case 'url': return prop.url;
    case 'email': return prop.email;
    case 'phone_number': return prop.phone_number;
    case 'people': return (prop.people ?? []).map((p: any) => p.name).filter(Boolean);
    case 'files': return (prop.files ?? []).map(fileValue);
    case 'relation': return (prop.relation ?? []).map((r: any) => `{{notion-link:${r.id}}}`);
    case 'formula': return formulaValue(prop.formula ?? {});
    case 'rollup': return rollupValue(prop.rollup ?? {});
    case 'created_time': return prop.created_time;
    case 'last_edited_time': return prop.last_edited_time;
    case 'created_by': return prop.created_by?.name ?? null;
    case 'last_edited_by': return prop.last_edited_by?.name ?? null;
    default: return null;
  }
}

function dateToStr(date: any): string | null {
  if (!date) return null;
  return date.end ? `${date.start}/${date.end}` : date.start;
}
function fileValue(f: any): string {
  if (f.type === 'external') return f.external.url;
  return `{{notion-asset:${f.file.url}}}`;
}
function formulaValue(f: any): unknown {
  switch (f.type) {
    case 'number': return f.number;
    case 'string': return f.string;
    case 'boolean': return f.boolean;
    case 'date': return dateToStr(f.date);
    default: return null;
  }
}
function rollupValue(r: any): unknown {
  switch (r.type) {
    case 'number': return r.number;
    case 'date': return dateToStr(r.date);
    case 'array': return (r.array ?? []).map(convertProp);
    default: return null;
  }
}
```

- [ ] **Step 4: Run, expect PASS** for all 18 cases.

- [ ] **Step 5: Commit**

```bash
cd .. && git add app/src/server/convert/properties.ts app/src/server/convert/properties.test.ts
git commit -m "feat(convert): properties to YAML frontmatter values"
```

---

## Task 10: Path planning

**Files:**
- Create: `app/src/server/extract/plan.ts`, `app/src/server/extract/plan.test.ts`

Reference: `git show v0.1-python:tests/extract/test_plan.py` (9 tests).

- [ ] **Step 1: Port the 9 test cases**

```ts
// app/src/server/extract/plan.test.ts
import { describe, it, expect } from 'vitest';
import { planPaths, slugify } from './plan.js';
import type { PlannedNode } from '@shared/types';

const node = (over: Partial<PlannedNode>): PlannedNode => ({
  id: '', kind: 'page', title: '', parentId: null, childrenIds: [], blocks: [], pageData: {}, ...over,
});

describe('slugify', () => {
  it('keeps unicode', () => expect(slugify('Notas de Reunião')).toBe('Notas de Reunião'));
  it('replaces forbidden chars', () => expect(slugify('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j'));
  it('strips whitespace', () => expect(slugify('  hello  ')).toBe('hello'));
  it('empty → untitled', () => expect(slugify('')).toBe('untitled'));
});

describe('planPaths', () => {
  it('leaf page is a file', () => {
    const nodes = [node({ id: 'r', kind: 'page', title: 'Notas' })];
    const paths = planPaths(nodes, '/v');
    expect(paths.get('r')).toBe('/v/Notas.md');
  });

  it('page with children → folder + sibling file', () => {
    const nodes = [
      node({ id: 'r', kind: 'page', title: 'Notas', childrenIds: ['c'] }),
      node({ id: 'c', kind: 'page', title: 'Sub', parentId: 'r' }),
    ];
    const paths = planPaths(nodes, '/v');
    expect(paths.get('r')).toBe('/v/Notas.md');
    expect(paths.get('c')).toBe('/v/Notas/Sub.md');
  });

  it('database is always folder + sibling index', () => {
    const nodes = [
      node({ id: 'db', kind: 'database', title: 'Tarefas', childrenIds: ['i1'] }),
      node({ id: 'i1', kind: 'db_item', title: 'Fazer X', parentId: 'db' }),
    ];
    const paths = planPaths(nodes, '/v');
    expect(paths.get('db')).toBe('/v/Tarefas.md');
    expect(paths.get('i1')).toBe('/v/Tarefas/Fazer X.md');
  });

  it('slug collisions get numeric suffix by id order', () => {
    const nodes = [
      node({ id: 'a', kind: 'page', title: 'Dup' }),
      node({ id: 'b', kind: 'page', title: 'Dup' }),
      node({ id: 'c', kind: 'page', title: 'Dup' }),
    ];
    const paths = planPaths(nodes, '/v');
    expect(paths.get('a')).toBe('/v/Dup.md');
    expect(paths.get('b')).toBe('/v/Dup (2).md');
    expect(paths.get('c')).toBe('/v/Dup (3).md');
  });

  it('deep nesting', () => {
    const nodes = [
      node({ id: 'A', kind: 'page', title: 'A', childrenIds: ['B'] }),
      node({ id: 'B', kind: 'page', title: 'B', parentId: 'A', childrenIds: ['C'] }),
      node({ id: 'C', kind: 'page', title: 'C', parentId: 'B' }),
    ];
    const paths = planPaths(nodes, '/v');
    expect(paths.get('A')).toBe('/v/A.md');
    expect(paths.get('B')).toBe('/v/A/B.md');
    expect(paths.get('C')).toBe('/v/A/B/C.md');
  });
});
```

- [ ] **Step 2: Run, see failures**

```bash
cd app && npm test -- src/server/extract/plan.test.ts
```

- [ ] **Step 3: Implement**

```ts
// app/src/server/extract/plan.ts
import { posix as path } from 'node:path';
import type { PlannedNode } from '@shared/types';

const FORBIDDEN = /[\\/:*?"<>|]/g;

export function slugify(name: string): string {
  if (!name) return 'untitled';
  const s = name.replace(FORBIDDEN, '-').trim();
  return s || 'untitled';
}

export function planPaths(nodes: PlannedNode[], root: string): Map<string, string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const hasSubtree = (n: PlannedNode): boolean =>
    n.kind === 'database' || n.childrenIds.length > 0;

  const dirFor = (id: string): string => {
    const n = byId.get(id);
    if (!n) throw new Error(`unknown node ${id}`);
    const parentDir = n.parentId === null ? root : dirFor(n.parentId);
    return hasSubtree(n) ? path.join(parentDir, slugify(n.title)) : parentDir;
  };

  const siblingsByDir = new Map<string, PlannedNode[]>();
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  for (const n of sorted) {
    const parentDir = n.parentId === null ? root : dirFor(n.parentId);
    const group = siblingsByDir.get(parentDir) ?? [];
    group.push(n);
    siblingsByDir.set(parentDir, group);
  }

  const out = new Map<string, string>();
  for (const [parentDir, group] of siblingsByDir) {
    const used = new Map<string, number>();
    for (const n of group) {
      const base = slugify(n.title);
      const count = (used.get(base) ?? 0) + 1;
      used.set(base, count);
      const fname = count === 1 ? `${base}.md` : `${base} (${count}).md`;
      out.set(n.id, path.join(parentDir, fname));
    }
  }
  return out;
}
```

- [ ] **Step 4: Run, expect PASS** (all 9).

- [ ] **Step 5: Commit**

```bash
cd .. && git add app/src/server/extract/plan.ts app/src/server/extract/plan.test.ts
git commit -m "feat(extract): plan output paths from PlannedNode tree"
```

---

## Task 11: Notion fetchers (paginated)

**Files:**
- Create: `app/src/server/notion/fetch.ts`, `app/src/server/notion/fetch.test.ts`

Reference: `git show v0.1-python:tests/notion/test_fetch.py` (3 tests).

- [ ] **Step 1: Port the 3 tests** using the same MockAgent setup as Task 3.

```ts
// app/src/server/notion/fetch.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { NotionClient } from './client.js';
import { fetchBlockChildren, queryDatabase } from './fetch.js';

let mock: MockAgent; let previous: Dispatcher;
beforeEach(() => { previous = getGlobalDispatcher(); mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock); });
afterEach(async () => { await mock.close(); setGlobalDispatcher(previous); });

describe('fetchBlockChildren', () => {
  it('paginates', async () => {
    const pool = mock.get('https://api.notion.com');
    pool.intercept({ path: '/v1/blocks/parent/children?page_size=100', method: 'GET' })
      .reply(200, { results: [{ id: 'b1', type: 'paragraph', has_children: false, paragraph: { rich_text: [] } }], next_cursor: 'cur1', has_more: true });
    pool.intercept({ path: '/v1/blocks/parent/children?page_size=100&start_cursor=cur1', method: 'GET' })
      .reply(200, { results: [{ id: 'b2', type: 'paragraph', has_children: false, paragraph: { rich_text: [] } }], next_cursor: null, has_more: false });

    const client = new NotionClient({ token: 't' });
    const blocks = await fetchBlockChildren(client, 'parent');
    expect(blocks.map((b: any) => b.id)).toEqual(['b1', 'b2']);
  });

  it('recurses into nested blocks (toggle)', async () => {
    const pool = mock.get('https://api.notion.com');
    pool.intercept({ path: '/v1/blocks/parent/children?page_size=100', method: 'GET' })
      .reply(200, { results: [{ id: 'outer', type: 'toggle', has_children: true, toggle: { rich_text: [] } }], next_cursor: null, has_more: false });
    pool.intercept({ path: '/v1/blocks/outer/children?page_size=100', method: 'GET' })
      .reply(200, { results: [{ id: 'inner', type: 'paragraph', has_children: false, paragraph: { rich_text: [] } }], next_cursor: null, has_more: false });

    const client = new NotionClient({ token: 't' });
    const blocks = await fetchBlockChildren(client, 'parent');
    expect(blocks[0].id).toBe('outer');
    expect(blocks[0].children?.[0]?.id).toBe('inner');
  });

  it('queryDatabase paginates', async () => {
    const pool = mock.get('https://api.notion.com');
    pool.intercept({ path: '/v1/databases/db1/query', method: 'POST' })
      .reply(200, { results: [{ id: 'i1', properties: {} }], next_cursor: 'c', has_more: true });
    pool.intercept({ path: '/v1/databases/db1/query', method: 'POST' })
      .reply(200, { results: [{ id: 'i2', properties: {} }], next_cursor: null, has_more: false });

    const client = new NotionClient({ token: 't' });
    const items = await queryDatabase(client, 'db1');
    expect(items.map((i: any) => i.id)).toEqual(['i1', 'i2']);
  });
});
```

- [ ] **Step 2: Run, see failures.**

- [ ] **Step 3: Implement**

```ts
// app/src/server/notion/fetch.ts
import type { NotionClient } from './client.js';

export async function fetchBlockChildren(client: NotionClient, blockId: string): Promise<any[]> {
  const blocks = await paginateGet(client, `/blocks/${blockId}/children`);
  await Promise.all(
    blocks.map(async (b: any) => {
      b.children ??= [];
      if (b.has_children && b.type !== 'child_page' && b.type !== 'child_database') {
        b.children = await fetchBlockChildren(client, b.id);
      }
    })
  );
  return blocks;
}

export async function queryDatabase(client: NotionClient, databaseId: string): Promise<any[]> {
  return paginatePost(client, `/databases/${databaseId}/query`, {});
}

export async function getPage(client: NotionClient, pageId: string): Promise<any> {
  return client.get(`/pages/${pageId}`);
}

export async function getDatabase(client: NotionClient, databaseId: string): Promise<any> {
  return client.get(`/databases/${databaseId}`);
}

async function paginateGet(client: NotionClient, basePath: string): Promise<any[]> {
  const results: any[] = [];
  let cursor: string | null = null;
  while (true) {
    const qs = `?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const page: any = await client.get(basePath + qs);
    results.push(...(page.results ?? []));
    if (!page.has_more) return results;
    cursor = page.next_cursor;
  }
}

async function paginatePost(client: NotionClient, path: string, body: Record<string, unknown>): Promise<any[]> {
  const results: any[] = [];
  let cursor: string | null = null;
  while (true) {
    const pageBody: any = { ...body, page_size: 100 };
    if (cursor) pageBody.start_cursor = cursor;
    const page: any = await client.post(path, pageBody);
    results.push(...(page.results ?? []));
    if (!page.has_more) return results;
    cursor = page.next_cursor;
  }
}
```

- [ ] **Step 4: Run, expect PASS** (3 tests).

- [ ] **Step 5: Commit**

```bash
cd .. && git add app/src/server/notion/fetch.ts app/src/server/notion/fetch.test.ts
git commit -m "feat(notion): paginated fetchers for blocks and database items"
```

---

## Task 12: Tree discovery

**Files:**
- Create: `app/src/server/notion/discovery.ts`, `app/src/server/notion/discovery.test.ts`

Reference: `git show v0.1-python:tests/notion/test_discovery.py` (2 tests).

- [ ] **Step 1: Port the 2 tests**

```ts
// app/src/server/notion/discovery.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { NotionClient } from './client.js';
import { discoverSubtree, listSharedRoots } from './discovery.js';

let mock: MockAgent; let previous: Dispatcher;
beforeEach(() => { previous = getGlobalDispatcher(); mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock); });
afterEach(async () => { await mock.close(); setGlobalDispatcher(previous); });

const rich = (text: string) => ({
  type: 'text', plain_text: text, text: { content: text, link: null }, href: null,
  annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
});

describe('discovery', () => {
  it('listSharedRoots returns pages and databases', async () => {
    const pool = mock.get('https://api.notion.com');
    pool.intercept({ path: '/v1/search', method: 'POST' }).reply(200, {
      results: [
        { object: 'page', id: 'p1', properties: { title: { type: 'title', title: [rich('Notas')] } } },
        { object: 'database', id: 'd1', title: [rich('Tarefas')] },
      ],
      next_cursor: null, has_more: false,
    });

    const client = new NotionClient({ token: 't' });
    const roots = await listSharedRoots(client);
    const ids = new Set(roots.map((r) => r.id));
    expect(ids).toEqual(new Set(['p1', 'd1']));
    expect(roots.find((r) => r.id === 'p1')?.kind).toBe('page');
    expect(roots.find((r) => r.id === 'd1')?.kind).toBe('database');
  });

  it('discoverSubtree walks child_page, child_database, and db items', async () => {
    const pool = mock.get('https://api.notion.com');
    pool.intercept({ path: '/v1/pages/p1', method: 'GET' }).reply(200, {
      id: 'p1', properties: { title: { type: 'title', title: [rich('Root')] } },
    });
    pool.intercept({ path: '/v1/blocks/p1/children?page_size=100', method: 'GET' }).reply(200, {
      results: [
        { id: 'sub1', type: 'child_page', child_page: { title: 'Sub' }, has_children: false },
        { id: 'db1', type: 'child_database', child_database: { title: 'Items' }, has_children: false },
        { id: 'para', type: 'paragraph', paragraph: { rich_text: [] }, has_children: false },
      ], next_cursor: null, has_more: false,
    });
    pool.intercept({ path: '/v1/blocks/sub1/children?page_size=100', method: 'GET' })
      .reply(200, { results: [], next_cursor: null, has_more: false });
    pool.intercept({ path: '/v1/databases/db1/query', method: 'POST' }).reply(200, {
      results: [{ id: 'row1', properties: { Name: { type: 'title', title: [rich('Row 1')] } } }],
      next_cursor: null, has_more: false,
    });
    pool.intercept({ path: '/v1/blocks/row1/children?page_size=100', method: 'GET' })
      .reply(200, { results: [], next_cursor: null, has_more: false });

    const client = new NotionClient({ token: 't' });
    const nodes = await discoverSubtree(client, 'p1', 'page');
    const ids = new Set(nodes.map((n) => n.id));
    expect(ids).toEqual(new Set(['p1', 'sub1', 'db1', 'row1']));
    expect(new Set(nodes.find((n) => n.id === 'p1')!.childrenIds)).toEqual(new Set(['sub1', 'db1']));
    expect(nodes.find((n) => n.id === 'db1')!.childrenIds).toEqual(['row1']);
  });
});
```

- [ ] **Step 2: Run, see failures.**

- [ ] **Step 3: Implement**

```ts
// app/src/server/notion/discovery.ts
import type { NodeKind, PlannedNode } from '@shared/types';
import { richTextToMd } from '../convert/inline.js';
import type { NotionClient } from './client.js';
import { fetchBlockChildren, getDatabase, getPage, queryDatabase } from './fetch.js';

export async function listSharedRoots(client: NotionClient): Promise<PlannedNode[]> {
  const results: any[] = [];
  let cursor: string | null = null;
  while (true) {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const page: any = await client.post('/search', body);
    results.push(...(page.results ?? []));
    if (!page.has_more) break;
    cursor = page.next_cursor;
  }
  const roots: PlannedNode[] = [];
  for (const r of results) {
    if (r.object === 'page') {
      roots.push(makeNode(r.id, 'page', pageTitle(r), null));
    } else if (r.object === 'database') {
      roots.push(makeNode(r.id, 'database', richTextToMd(r.title ?? []) || 'Untitled', null));
    }
  }
  return roots;
}

export async function discoverSubtree(client: NotionClient, rootId: string, rootKind: NodeKind): Promise<PlannedNode[]> {
  const collected: PlannedNode[] = [];
  let root: PlannedNode;
  if (rootKind === 'page') {
    const page = await getPage(client, rootId);
    root = makeNode(rootId, 'page', pageTitle(page), null, page);
    await walkPage(client, root, collected);
  } else {
    const db = await getDatabase(client, rootId);
    root = makeNode(rootId, 'database', richTextToMd(db.title ?? []) || 'Untitled', null, db);
    await walkDatabase(client, root, collected);
  }
  return [root, ...collected];
}

async function walkPage(client: NotionClient, node: PlannedNode, out: PlannedNode[]): Promise<void> {
  node.blocks = await fetchBlockChildren(client, node.id);
  for (const block of node.blocks) {
    if (block.type === 'child_page') {
      const child = makeNode(block.id, 'page', block.child_page?.title ?? 'Untitled', node.id);
      node.childrenIds.push(child.id);
      out.push(child);
      await walkPage(client, child, out);
    } else if (block.type === 'child_database') {
      const child = makeNode(block.id, 'database', block.child_database?.title ?? 'Untitled', node.id);
      node.childrenIds.push(child.id);
      out.push(child);
      await walkDatabase(client, child, out);
    }
  }
}

async function walkDatabase(client: NotionClient, node: PlannedNode, out: PlannedNode[]): Promise<void> {
  const items = await queryDatabase(client, node.id);
  for (const item of items) {
    const itemNode = makeNode(item.id, 'db_item', pageTitle(item), node.id, item);
    node.childrenIds.push(itemNode.id);
    out.push(itemNode);
    await walkPage(client, itemNode, out);
  }
}

function makeNode(id: string, kind: NodeKind, title: string, parentId: string | null, pageData: any = {}): PlannedNode {
  return { id, kind, title, parentId, childrenIds: [], blocks: [], pageData };
}

function pageTitle(page: any): string {
  const props = page.properties ?? {};
  for (const prop of Object.values<any>(props)) {
    if (prop.type === 'title') return richTextToMd(prop.title ?? []) || 'Untitled';
  }
  return 'Untitled';
}
```

- [ ] **Step 4: Run, expect PASS** (2 tests).

- [ ] **Step 5: Commit**

```bash
cd .. && git add app/src/server/notion/discovery.ts app/src/server/notion/discovery.test.ts
git commit -m "feat(notion): tree discovery from /search + recursive walk"
```

---

## Task 13: Attachment downloader

**Files:**
- Create: `app/src/server/extract/attachments.ts`, `app/src/server/extract/attachments.test.ts`

Reference: `git show v0.1-python:tests/extract/test_attachments.py` (3 tests).

- [ ] **Step 1: Port the 3 tests**

```ts
// app/src/server/extract/attachments.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttachmentDownloader } from './attachments.js';

let mock: MockAgent; let previous: Dispatcher;
beforeEach(() => { previous = getGlobalDispatcher(); mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock); });
afterEach(async () => { await mock.close(); setGlobalDispatcher(previous); });

async function tmp() { return mkdtemp(join(tmpdir(), 'attach-')); }

describe('AttachmentDownloader', () => {
  it('writes file with hashed name', async () => {
    const dir = await tmp();
    const pool = mock.get('https://prod-files.s3.amazonaws.com');
    pool.intercept({ path: '/folder/image.png', method: 'GET' }).reply(200, Buffer.from('PNGDATA'));

    const dl = new AttachmentDownloader(join(dir, 'assets'));
    try {
      const local = await dl.download('https://prod-files.s3.amazonaws.com/folder/image.png');
      expect(local).toMatch(/-image\.png$/);
      expect(await readFile(local)).toEqual(Buffer.from('PNGDATA'));
    } finally { await dl.close(); }
  });

  it('deduplicates same url', async () => {
    const dir = await tmp();
    const pool = mock.get('https://prod-files.s3.amazonaws.com');
    pool.intercept({ path: '/x.png', method: 'GET' }).reply(200, Buffer.from('DATA'));
    const dl = new AttachmentDownloader(join(dir, 'assets'));
    try {
      const a = await dl.download('https://prod-files.s3.amazonaws.com/x.png');
      const b = await dl.download('https://prod-files.s3.amazonaws.com/x.png');
      expect(a).toBe(b);
      const files = await readdir(join(dir, 'assets'));
      expect(files).toHaveLength(1);
    } finally { await dl.close(); }
  });

  it('uses basename from path, not query string', async () => {
    const dir = await tmp();
    const pool = mock.get('https://prod-files.s3.amazonaws.com');
    pool.intercept({ path: '/x.png?sig=abc', method: 'GET' }).reply(200, Buffer.from('D'));
    const dl = new AttachmentDownloader(join(dir, 'assets'));
    try {
      const local = await dl.download('https://prod-files.s3.amazonaws.com/x.png?sig=abc');
      expect(local.endsWith('-x.png')).toBe(true);
    } finally { await dl.close(); }
  });
});
```

- [ ] **Step 2: Run, see failures.**

- [ ] **Step 3: Implement**

```ts
// app/src/server/extract/attachments.ts
import { request } from 'undici';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { URL as NodeURL } from 'node:url';
import { join } from 'node:path';
import pLimit from 'p-limit';

export class AttachmentDownloader {
  private readonly assetsDir: string;
  private readonly limit: ReturnType<typeof pLimit>;
  private readonly cache = new Map<string, string>();
  private readonly locks = new Map<string, Promise<string>>();
  private closed = false;

  constructor(assetsDir: string, concurrency = 8) {
    this.assetsDir = assetsDir;
    this.limit = pLimit(concurrency);
  }

  async close(): Promise<void> { this.closed = true; }

  async download(url: string): Promise<string> {
    if (this.cache.has(url)) return this.cache.get(url)!;
    const existing = this.locks.get(url);
    if (existing) return existing;

    const promise = this.limit(async () => {
      if (this.closed) throw new Error('downloader closed');
      const local = this.targetPath(url);
      await mkdir(this.assetsDir, { recursive: true });
      const res = await request(url);
      if (res.statusCode >= 400) {
        await res.body.dump();
        throw new Error(`download failed ${url}: ${res.statusCode}`);
      }
      const buf = Buffer.from(await res.body.arrayBuffer());
      await writeFile(local, buf);
      this.cache.set(url, local);
      return local;
    });
    this.locks.set(url, promise);
    try { return await promise; }
    finally { this.locks.delete(url); }
  }

  private targetPath(url: string): string {
    const hash = createHash('sha1').update(url).digest('hex').slice(0, 8);
    let basename = 'file';
    try {
      const u = new NodeURL(url);
      basename = u.pathname.split('/').pop() || 'file';
    } catch { /* keep default */ }
    return join(this.assetsDir, `${hash}-${basename}`);
  }
}
```

- [ ] **Step 4: Run, expect PASS** (3 tests).

- [ ] **Step 5: Commit**

```bash
cd .. && git add app/src/server/extract/attachments.ts app/src/server/extract/attachments.test.ts
git commit -m "feat(extract): parallel attachment downloader with URL dedup"
```

---

## Task 14: Placeholder resolution + report

**Files:**
- Create: `app/src/server/extract/resolve.ts`, `app/src/server/extract/resolve.test.ts`

Reference: `git show v0.1-python:tests/extract/test_resolve.py` (7 tests).

- [ ] **Step 1: Port the 7 tests**

```ts
// app/src/server/extract/resolve.test.ts
import { describe, it, expect } from 'vitest';
import { renderReport, resolvePlaceholders, type LinkContext, type BrokenLink } from './resolve.js';

const ctx = (over: Partial<LinkContext>): LinkContext => ({
  fromFile: '/v/A.md', idToPath: new Map(), urlToLocal: new Map(), vaultRoot: '/v', ...over,
});

describe('resolvePlaceholders', () => {
  it('known link → wikilink', () => {
    const { md, broken } = resolvePlaceholders('see {{notion-link:abc|Other}} for more',
      ctx({ idToPath: new Map([['abc', '/v/Other.md']]) }));
    expect(md).toBe('see [[Other]] for more');
    expect(broken).toEqual([]);
  });

  it('known link no label uses basename', () => {
    const { md, broken } = resolvePlaceholders('{{notion-link:abc}}',
      ctx({ idToPath: new Map([['abc', '/v/Some Page.md']]) }));
    expect(md).toBe('[[Some Page]]');
    expect(broken).toEqual([]);
  });

  it('unknown link with label → label text + report entry', () => {
    const { md, broken } = resolvePlaceholders('{{notion-link:xyz|External Page}}', ctx({}));
    expect(md).toBe('External Page');
    expect(broken).toEqual<BrokenLink[]>([{ id: 'xyz', label: 'External Page', fromFile: '/v/A.md' }]);
  });

  it('unknown link no label → "(link removed)"', () => {
    const { md, broken } = resolvePlaceholders('{{notion-link:xyz}}', ctx({}));
    expect(md).toBe('(link removed)');
    expect(broken).toEqual<BrokenLink[]>([{ id: 'xyz', label: null, fromFile: '/v/A.md' }]);
  });

  it('asset → relative path', () => {
    const { md } = resolvePlaceholders('![alt]({{notion-asset:https://x/y.png}})',
      ctx({ fromFile: '/v/sub/A.md', urlToLocal: new Map([['https://x/y.png', '/v/assets/a1b2c3d4-y.png']]) }));
    expect(md).toBe('![alt](../assets/a1b2c3d4-y.png)');
  });

  it('asset missing keeps original URL', () => {
    const { md } = resolvePlaceholders('![]({{notion-asset:https://x/y.png}})', ctx({}));
    expect(md).toBe('![](https://x/y.png)');
  });
});

describe('renderReport', () => {
  it('groups broken links and shows counts', () => {
    const report = renderReport({
      vaultRoot: '/v',
      pagesExtracted: 10, itemsExtracted: 5, attachmentsDownloaded: 2, totalBytes: 1024,
      durationS: 1.5,
      brokenLinks: [
        { id: 'xyz', label: 'External', fromFile: '/v/A.md' },
        { id: 'abc', label: null, fromFile: '/v/A.md' },
      ],
      failures: [{ id: 'page-1', reason: '404' }],
      warnings: ['unknown block: template'],
    });
    expect(report).toContain('Páginas extraídas: 10');
    expect(report).toContain('Itens de database extraídos: 5');
    expect(report).toContain('xyz');
    expect(report).toContain('Falhas (1)');
  });
});
```

- [ ] **Step 2: Run, see failures.**

- [ ] **Step 3: Implement**

```ts
// app/src/server/extract/resolve.ts
import { posix as path } from 'node:path';

const LINK_RE = /\{\{notion-link:([^|}]+)(?:\|([^}]+))?\}\}/g;
const ASSET_RE = /\{\{notion-asset:([^}]+)\}\}/g;

export interface BrokenLink { id: string; label: string | null; fromFile: string; }

export interface LinkContext {
  fromFile: string;
  idToPath: Map<string, string>;
  urlToLocal: Map<string, string>;
  vaultRoot: string;
}

export function resolvePlaceholders(md: string, ctx: LinkContext): { md: string; broken: BrokenLink[] } {
  const broken: BrokenLink[] = [];
  let out = md.replace(LINK_RE, (_match, id, label) => {
    const targetPath = ctx.idToPath.get(id);
    if (targetPath !== undefined) {
      const pageName = path.basename(targetPath, '.md');
      return `[[${pageName}]]`;
    }
    broken.push({ id, label: label ?? null, fromFile: ctx.fromFile });
    return label ?? '(link removed)';
  });
  out = out.replace(ASSET_RE, (_match, url) => {
    const local = ctx.urlToLocal.get(url);
    if (!local) return url;
    const rel = path.relative(path.dirname(ctx.fromFile), local);
    return rel;
  });
  return { md: out, broken };
}

export interface ReportInput {
  vaultRoot: string;
  pagesExtracted: number;
  itemsExtracted: number;
  attachmentsDownloaded: number;
  totalBytes: number;
  durationS: number;
  brokenLinks: BrokenLink[];
  failures: Array<{ id: string; reason: string }>;
  warnings: string[];
}

export function renderReport(input: ReportInput): string {
  const mb = input.totalBytes / (1024 * 1024);
  const lines: string[] = [
    '# Relatório de extração',
    '',
    `- Páginas extraídas: ${input.pagesExtracted}`,
    `- Itens de database extraídos: ${input.itemsExtracted}`,
    `- Anexos baixados: ${input.attachmentsDownloaded} (${mb.toFixed(1)} MB)`,
    `- Duração: ${input.durationS.toFixed(1)}s`,
    '',
  ];
  if (input.brokenLinks.length) {
    lines.push(`## Links para fora da seleção (${input.brokenLinks.length})`);
    for (const b of input.brokenLinks) {
      const rel = path.relative(input.vaultRoot, b.fromFile);
      const labelPart = b.label ? ` — ${b.label}` : '';
      lines.push(`- \`${b.id}\`${labelPart} (em [${rel}](${rel}))`);
    }
    lines.push('');
  }
  if (input.failures.length) {
    lines.push(`## Falhas (${input.failures.length})`);
    for (const f of input.failures) lines.push(`- \`${f.id}\`: ${f.reason}`);
    lines.push('');
  }
  if (input.warnings.length) {
    lines.push(`## Avisos (${input.warnings.length})`);
    for (const w of input.warnings) lines.push(`- ${w}`);
    lines.push('');
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run, expect PASS** (7 tests).

- [ ] **Step 5: Commit**

```bash
cd .. && git add app/src/server/extract/resolve.ts app/src/server/extract/resolve.test.ts
git commit -m "feat(extract): resolve placeholders to wikilinks + relative assets + report"
```

---

## Task 15: Event bus

**Files:**
- Create: `app/src/server/progress.ts`, `app/src/server/progress.test.ts`

Equivalent to v0.1's `progress.py` but using a simple AsyncIterable pattern.

- [ ] **Step 1: Tests**

```ts
// app/src/server/progress.test.ts
import { describe, it, expect } from 'vitest';
import { EventBus, eventToSse } from './progress.js';

describe('EventBus', () => {
  it('publish + subscribe receives events', async () => {
    const bus = new EventBus();
    const received: any[] = [];
    const iter = bus.subscribe();
    const consumer = (async () => {
      for await (const event of iter) {
        received.push(event);
        if (event.kind === 'extraction_done') break;
      }
    })();
    await bus.publish({ kind: 'discovery_started', data: {} });
    await bus.publish({ kind: 'extraction_done', data: { ok: true } });
    await consumer;
    expect(received.map((e) => e.kind)).toEqual(['discovery_started', 'extraction_done']);
  });

  it('eventToSse format', () => {
    const sse = eventToSse({ kind: 'node_done', data: { id: 'p1', title: 'X' } });
    expect(sse.startsWith('event: node_done\n')).toBe(true);
    expect(sse).toContain('"id":"p1"');
    expect(sse.endsWith('\n\n')).toBe(true);
  });
});
```

- [ ] **Step 2: Run, see failures.**

- [ ] **Step 3: Implement**

```ts
// app/src/server/progress.ts
import type { ProgressEvent } from '@shared/types';

export function eventToSse(event: ProgressEvent): string {
  return `event: ${event.kind}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export class EventBus {
  private subscribers = new Set<{ queue: ProgressEvent[]; resolve?: () => void }>();

  async publish(event: ProgressEvent): Promise<void> {
    for (const sub of this.subscribers) {
      sub.queue.push(event);
      sub.resolve?.();
    }
  }

  async *subscribe(): AsyncIterable<ProgressEvent> {
    const sub = { queue: [] as ProgressEvent[], resolve: undefined as undefined | (() => void) };
    this.subscribers.add(sub);
    try {
      while (true) {
        if (sub.queue.length) {
          yield sub.queue.shift()!;
          continue;
        }
        await new Promise<void>((r) => { sub.resolve = r; });
        sub.resolve = undefined;
      }
    } finally {
      this.subscribers.delete(sub);
    }
  }
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
cd .. && git add app/src/server/progress.ts app/src/server/progress.test.ts
git commit -m "feat(progress): event bus with SSE serialization"
```

---

## Task 16: Pipeline orchestrator

**Files:**
- Create: `app/src/server/extract/pipeline.ts`, `app/src/server/extract/pipeline.test.ts`

Reference: `git show v0.1-python:tests/extract/test_pipeline.py` (2 tests).

- [ ] **Step 1: Port the 2 tests**

```ts
// app/src/server/extract/pipeline.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotionClient } from '../notion/client.js';
import { EventBus } from '../progress.js';
import { runExtraction } from './pipeline.js';

let mock: MockAgent; let previous: Dispatcher;
beforeEach(() => { previous = getGlobalDispatcher(); mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock); });
afterEach(async () => { await mock.close(); setGlobalDispatcher(previous); });

const rich = (text: string) => [{
  type: 'text', text: { content: text, link: null }, plain_text: text, href: null,
  annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
}];
async function tmp() { return mkdtemp(join(tmpdir(), 'pipe-')); }

describe('runExtraction', () => {
  it('writes md for a simple page', async () => {
    const dir = await tmp();
    const pool = mock.get('https://api.notion.com');
    pool.intercept({ path: '/v1/pages/p1', method: 'GET' }).reply(200, {
      id: 'p1', properties: { title: { type: 'title', title: rich('Hello') } },
    });
    pool.intercept({ path: '/v1/blocks/p1/children?page_size=100', method: 'GET' }).reply(200, {
      results: [{ id: 'b1', type: 'paragraph', has_children: false, paragraph: { rich_text: rich('world') } }],
      next_cursor: null, has_more: false,
    });

    const client = new NotionClient({ token: 't' });
    const bus = new EventBus();
    const result = await runExtraction({ client, bus, outputDir: dir, rootSelection: [{ id: 'p1', kind: 'page' }] });
    const md = await readFile(join(dir, 'Hello.md'), 'utf8');
    expect(md).toContain('world');
    expect(result.pagesExtracted).toBe(1);
  });

  it('resolves internal wikilink to child page', async () => {
    const dir = await tmp();
    const pool = mock.get('https://api.notion.com');
    pool.intercept({ path: '/v1/pages/p1', method: 'GET' }).reply(200, {
      id: 'p1', properties: { title: { type: 'title', title: rich('Alpha') } },
    });
    pool.intercept({ path: '/v1/blocks/p1/children?page_size=100', method: 'GET' }).reply(200, {
      results: [
        { id: 'lb', type: 'link_to_page', has_children: false, link_to_page: { type: 'page_id', page_id: 'cp' } },
        { id: 'cp', type: 'child_page', has_children: false, child_page: { title: 'Beta' } },
      ], next_cursor: null, has_more: false,
    });
    pool.intercept({ path: '/v1/blocks/cp/children?page_size=100', method: 'GET' })
      .reply(200, { results: [], next_cursor: null, has_more: false });

    const client = new NotionClient({ token: 't' });
    const bus = new EventBus();
    await runExtraction({ client, bus, outputDir: dir, rootSelection: [{ id: 'p1', kind: 'page' }] });
    const alpha = await readFile(join(dir, 'Alpha.md'), 'utf8');
    expect(alpha).toContain('[[Beta]]');
  });
});
```

- [ ] **Step 2: Run, see failures.**

- [ ] **Step 3: Implement**

```ts
// app/src/server/extract/pipeline.ts
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import type { NodeKind, PlannedNode } from '@shared/types';
import { blocksToMd } from '../convert/blocks.js';
import { propertiesToFrontmatter } from '../convert/properties.js';
import type { NotionClient } from '../notion/client.js';
import { discoverSubtree } from '../notion/discovery.js';
import { EventBus } from '../progress.js';
import { AttachmentDownloader } from './attachments.js';
import { planPaths } from './plan.js';
import { renderReport, resolvePlaceholders, type BrokenLink, type LinkContext } from './resolve.js';

const ASSET_PLACEHOLDER = /\{\{notion-asset:([^}]+)\}\}/g;

export interface ExtractionResult {
  pagesExtracted: number;
  itemsExtracted: number;
  attachmentsDownloaded: number;
  totalBytes: number;
  durationS: number;
  brokenLinks: BrokenLink[];
  failures: Array<{ id: string; reason: string }>;
  warnings: string[];
}

export interface RunExtractionOpts {
  client: NotionClient;
  bus: EventBus;
  outputDir: string;
  rootSelection: Array<{ id: string; kind: NodeKind }>;
}

export async function runExtraction(opts: RunExtractionOpts): Promise<ExtractionResult> {
  const { client, bus, outputDir, rootSelection } = opts;
  const startedAt = Date.now();
  await mkdir(outputDir, { recursive: true });
  const downloader = new AttachmentDownloader(join(outputDir, 'assets'));
  const result: ExtractionResult = {
    pagesExtracted: 0, itemsExtracted: 0, attachmentsDownloaded: 0, totalBytes: 0,
    durationS: 0, brokenLinks: [], failures: [], warnings: [],
  };

  try {
    await bus.publish({ kind: 'discovery_started', data: {} });
    const allNodes: PlannedNode[] = [];
    for (const { id, kind } of rootSelection) {
      const subtree = await discoverSubtree(client, id, kind);
      allNodes.push(...subtree);
      await bus.publish({ kind: 'discovery_progress', data: { root_id: id, discovered: subtree.length } });
    }
    await bus.publish({ kind: 'discovery_done', data: { total: allNodes.length } });

    const paths = planPaths(allNodes, outputDir);
    const idToNode = new Map(allNodes.map((n) => [n.id, n]));
    const rendered = new Map<string, string>();

    for (const node of allNodes) {
      await bus.publish({ kind: 'node_started', data: { id: node.id, title: node.title } });
      try {
        rendered.set(node.id, await renderNode(node, idToNode));
        if (node.kind === 'page') result.pagesExtracted++;
        else if (node.kind === 'db_item') result.itemsExtracted++;
        await bus.publish({ kind: 'node_done', data: { id: node.id } });
      } catch (exc) {
        const reason = exc instanceof Error ? exc.message : String(exc);
        result.failures.push({ id: node.id, reason });
        await bus.publish({ kind: 'node_failed', data: { id: node.id, reason } });
      }
    }

    for (const node of allNodes) {
      const md = rendered.get(node.id);
      if (md === undefined) continue;
      const urlToLocal = await downloadAssets(md, downloader, bus);
      result.attachmentsDownloaded += urlToLocal.size;
      for (const local of urlToLocal.values()) {
        try { result.totalBytes += (await stat(local)).size; } catch { /* ignore */ }
      }
      const fromFile = paths.get(node.id)!;
      const ctx: LinkContext = { fromFile, idToPath: paths, urlToLocal, vaultRoot: outputDir };
      const { md: resolved, broken } = resolvePlaceholders(md, ctx);
      result.brokenLinks.push(...broken);
      await mkdir(dirname(fromFile), { recursive: true });
      await writeFile(fromFile, resolved, 'utf8');
    }

    result.durationS = (Date.now() - startedAt) / 1000;
    const report = renderReport({
      vaultRoot: outputDir,
      pagesExtracted: result.pagesExtracted, itemsExtracted: result.itemsExtracted,
      attachmentsDownloaded: result.attachmentsDownloaded, totalBytes: result.totalBytes,
      durationS: result.durationS,
      brokenLinks: result.brokenLinks, failures: result.failures, warnings: result.warnings,
    });
    await writeFile(join(outputDir, '_report.md'), report, 'utf8');
    await bus.publish({
      kind: 'extraction_done',
      data: { pages: result.pagesExtracted, items: result.itemsExtracted, attachments: result.attachmentsDownloaded },
    });
    return result;
  } finally {
    await downloader.close();
  }
}

async function renderNode(node: PlannedNode, idToNode: Map<string, PlannedNode>): Promise<string> {
  if (node.kind === 'page') return blocksToMd(node.blocks as any);
  if (node.kind === 'db_item') {
    const page = node.pageData as Record<string, any>;
    const fm: Record<string, unknown> = propertiesToFrontmatter(page.properties ?? {});
    fm.notion_id = node.id;
    fm.notion_url = page.url ?? '';
    fm.created_time = page.created_time ?? '';
    fm.last_edited_time = page.last_edited_time ?? '';
    const body = blocksToMd(node.blocks as any);
    return `---\n${yamlStringify(fm).trimEnd()}\n---\n\n${body}`;
  }
  if (node.kind === 'database') return renderDatabaseIndex(node, idToNode);
  return '';
}

function renderDatabaseIndex(node: PlannedNode, idToNode: Map<string, PlannedNode>): string {
  const rows = node.childrenIds.map((id) => idToNode.get(id)).filter((n): n is PlannedNode => !!n);
  if (!rows.length) return `# ${node.title}\n`;
  const lines = [`# ${node.title}`, '', '| Item |', '| --- |'];
  for (const row of rows) lines.push(`| {{notion-link:${row.id}|${row.title}}} |`);
  return `${lines.join('\n')}\n`;
}

async function downloadAssets(md: string, dl: AttachmentDownloader, bus: EventBus): Promise<Map<string, string>> {
  const urls = new Set<string>();
  for (const m of md.matchAll(ASSET_PLACEHOLDER)) urls.add(m[1]);
  const urlToLocal = new Map<string, string>();
  for (const url of urls) {
    try {
      const local = await dl.download(url);
      urlToLocal.set(url, local);
      await bus.publish({ kind: 'attachment_downloaded', data: { url, path: local } });
    } catch { /* swallow; report logged via warnings if needed */ }
  }
  return urlToLocal;
}
```

- [ ] **Step 4: Run, expect PASS** (2 tests).

- [ ] **Step 5: Commit**

```bash
cd .. && git add app/src/server/extract/pipeline.ts app/src/server/extract/pipeline.test.ts
git commit -m "feat(extract): pipeline orchestrator (discovery → convert → resolve → write)"
```

---

## Phase 3 — Fastify app, routes, CLI

## Task 17: Config loader

**Files:**
- Create: `app/src/server/config.ts`, `app/src/server/config.test.ts`

- [ ] **Step 1: Tests**

```ts
// app/src/server/config.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings, writeSettings } from './config.js';

describe('settings', () => {
  it('writes and reads back .env values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cfg-'));
    await writeSettings(dir, { notionToken: 'secret_abc', outputDir: '/v' });
    const loaded = await loadSettings(dir);
    expect(loaded.notionToken).toBe('secret_abc');
    expect(loaded.outputDir).toBe('/v');
  });

  it('returns missing fields as null', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cfg-'));
    await writeFile(join(dir, '.env'), '', 'utf8');
    const loaded = await loadSettings(dir);
    expect(loaded.notionToken).toBeNull();
    expect(loaded.outputDir).toBeNull();
  });
});
```

- [ ] **Step 2: Run, see failures.**

- [ ] **Step 3: Implement**

```ts
// app/src/server/config.ts
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface Settings {
  notionToken: string | null;
  outputDir: string | null;
  host: string;
  port: number;
}

export async function loadSettings(cwd: string): Promise<Settings> {
  let content = '';
  try { content = await readFile(join(cwd, '.env'), 'utf8'); }
  catch { /* file may not exist */ }
  const env = parseEnv(content);
  return {
    notionToken: env.NOTION_TOKEN || null,
    outputDir: env.OUTPUT_DIR || null,
    host: env.HOST || '127.0.0.1',
    port: Number.parseInt(env.PORT ?? '8765', 10),
  };
}

export async function writeSettings(
  cwd: string,
  updates: { notionToken?: string; outputDir?: string },
): Promise<void> {
  const current = await loadSettings(cwd);
  const merged = {
    NOTION_TOKEN: updates.notionToken ?? current.notionToken ?? '',
    OUTPUT_DIR: updates.outputDir ?? current.outputDir ?? '',
    HOST: current.host,
    PORT: String(current.port),
  };
  const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
  await writeFile(join(cwd, '.env'), `${lines.join('\n')}\n`, 'utf8');
}

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
cd .. && git add app/src/server/config.ts app/src/server/config.test.ts
git commit -m "feat(config): load and persist settings in .env"
```

---

## Task 18: Fastify app + routes

**Files:**
- Create: `app/src/server/app.ts`, `app/src/server/routes/{status,setup,roots,extract,events}.ts`
- Create: `app/src/server/app.test.ts`

- [ ] **Step 1: Test for `/api/status` and `/api/setup`**

```ts
// app/src/server/app.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from './app.js';

let mock: MockAgent; let previous: Dispatcher;
beforeEach(() => { previous = getGlobalDispatcher(); mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock); });
afterEach(async () => { await mock.close(); setGlobalDispatcher(previous); });

async function tmp() { return mkdtemp(join(tmpdir(), 'app-')); }

describe('Fastify app', () => {
  it('GET /api/status returns tokenConfigured=false on fresh dir', async () => {
    const cwd = await tmp();
    const app = await buildApp({ cwd });
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tokenConfigured: false, outputDir: null });
    await app.close();
  });

  it('POST /api/setup persists token + outputDir', async () => {
    const cwd = await tmp();
    const app = await buildApp({ cwd });
    const res = await app.inject({
      method: 'POST', url: '/api/setup',
      payload: { notionToken: 'secret_zzz', outputDir: '/v' },
    });
    expect(res.statusCode).toBe(204);
    const status = await app.inject({ method: 'GET', url: '/api/status' });
    expect(status.json()).toEqual({ tokenConfigured: true, outputDir: '/v' });
    await app.close();
  });

  it('GET /api/roots returns shared roots when token is configured', async () => {
    const cwd = await tmp();
    const pool = mock.get('https://api.notion.com');
    pool.intercept({ path: '/v1/search', method: 'POST' }).reply(200, {
      results: [{
        object: 'page', id: 'p1',
        properties: { title: { type: 'title', title: [{
          type: 'text', plain_text: 'Top', text: { content: 'Top', link: null }, href: null,
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
        }] } },
      }],
      next_cursor: null, has_more: false,
    });
    const app = await buildApp({ cwd });
    await app.inject({ method: 'POST', url: '/api/setup', payload: { notionToken: 't', outputDir: '/v' } });
    const res = await app.inject({ method: 'GET', url: '/api/roots' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: 'p1', kind: 'page', title: 'Top' }]);
    await app.close();
  });

  it('GET /api/roots returns 412 when token missing', async () => {
    const cwd = await tmp();
    const app = await buildApp({ cwd });
    const res = await app.inject({ method: 'GET', url: '/api/roots' });
    expect(res.statusCode).toBe(412);
    await app.close();
  });
});
```

- [ ] **Step 2: Run, see failures.**

- [ ] **Step 3: Implement app factory**

```ts
// app/src/server/app.ts
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadSettings, writeSettings } from './config.js';
import { NotionClient } from './notion/client.js';
import { listSharedRoots } from './notion/discovery.js';
import { EventBus } from './progress.js';
import { runExtraction } from './extract/pipeline.js';
import { eventToSse } from './progress.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface BuildAppOpts { cwd: string; }

export async function buildApp(opts: BuildAppOpts): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  const jobs = new Map<string, EventBus>();

  const staticDir = resolveStaticDir();
  if (staticDir) {
    await fastify.register(fastifyStatic, { root: staticDir, prefix: '/', wildcard: false });
    fastify.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  fastify.get('/api/status', async () => {
    const settings = await loadSettings(opts.cwd);
    return { tokenConfigured: !!settings.notionToken, outputDir: settings.outputDir };
  });

  fastify.post<{ Body: { notionToken: string; outputDir: string } }>('/api/setup', async (req, reply) => {
    const { notionToken, outputDir } = req.body;
    if (!notionToken || !outputDir) return reply.code(400).send({ error: 'notionToken and outputDir are required' });
    await writeSettings(opts.cwd, { notionToken, outputDir });
    return reply.code(204).send();
  });

  fastify.get('/api/roots', async (_req, reply) => {
    const settings = await loadSettings(opts.cwd);
    if (!settings.notionToken) return reply.code(412).send({ error: 'token not configured' });
    const client = new NotionClient({ token: settings.notionToken });
    const roots = await listSharedRoots(client);
    return roots.map((r) => ({ id: r.id, kind: r.kind, title: r.title }));
  });

  fastify.post<{ Body: { selection: Array<{ id: string; kind: 'page' | 'database' }> } }>('/api/extract', async (req, reply) => {
    const settings = await loadSettings(opts.cwd);
    if (!settings.notionToken || !settings.outputDir) return reply.code(412).send({ error: 'not configured' });
    const bus = new EventBus();
    const jobId = crypto.randomUUID();
    jobs.set(jobId, bus);
    const client = new NotionClient({ token: settings.notionToken });
    void runExtraction({
      client, bus,
      outputDir: settings.outputDir,
      rootSelection: req.body.selection,
    });
    return { job_id: jobId };
  });

  fastify.get<{ Querystring: { job?: string } }>('/api/events', async (req, reply) => {
    const job = req.query.job;
    const bus = job ? jobs.get(job) : undefined;
    reply.raw.setHeader('content-type', 'text/event-stream');
    reply.raw.setHeader('cache-control', 'no-cache');
    reply.raw.setHeader('connection', 'keep-alive');
    if (!bus) { reply.raw.end(); return reply; }
    reply.hijack();
    for await (const event of bus.subscribe()) {
      reply.raw.write(eventToSse(event));
      if (event.kind === 'extraction_done' || event.kind === 'error') break;
    }
    reply.raw.end();
    return reply;
  });

  return fastify;
}

function resolveStaticDir(): string | null {
  const candidates = [
    resolve(__dirname, '../web'),         // production build (dist/web)
    resolve(__dirname, '../../dist/web'), // dev from source via tsx
  ];
  return candidates.find((p) => existsSync(join(p, 'index.html'))) ?? null;
}
```

- [ ] **Step 4: Run, expect PASS** (4 tests).

- [ ] **Step 5: Commit**

```bash
cd .. && git add app/src/server/app.ts app/src/server/app.test.ts
git commit -m "feat(app): Fastify app with /api/status, setup, roots, extract, events"
```

---

## Task 19: CLI entrypoint

**Files:**
- Create: `app/bin/cli.ts`

Not unit-tested — exercised by manual smoke test in Task 24.

- [ ] **Step 1: Write CLI**

```ts
#!/usr/bin/env node
// app/bin/cli.ts
import { buildApp } from '../src/server/app.js';
import open from 'open';

async function main() {
  const cwd = process.cwd();
  const app = await buildApp({ cwd });

  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number.parseInt(process.env.PORT ?? '8765', 10);
  await app.listen({ host, port });
  const url = `http://${host}:${port}/`;
  console.log(`notion-2-obsidian running on ${url}`);

  if (!process.env.NO_OPEN) {
    try { await open(url); } catch { /* best effort */ }
  }

  const shutdown = async () => { await app.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run typecheck and lint**

```bash
cd app && npm run typecheck && npm run lint
```

Expected: PASS.

- [ ] **Step 3: Smoke test in dev mode (no full build needed)**

```bash
cd app && NO_OPEN=1 npx tsx bin/cli.ts &
# wait a second, then:
curl -s http://127.0.0.1:8765/api/status
# Expected: {"tokenConfigured":false,"outputDir":null}
# Then kill the server:
kill %1
```

- [ ] **Step 4: Commit**

```bash
cd .. && git add app/bin/cli.ts && git commit -m "feat(cli): bin/cli.ts boots Fastify and opens browser"
```

---

## Phase 4 — Frontend (React)

## Task 20: API client + main entry

**Files:**
- Create: `app/src/web/main.tsx`, `app/src/web/App.tsx`, `app/src/web/api.ts`, `app/src/web/styles.css`

- [ ] **Step 1: Write the API client**

```ts
// app/src/web/api.ts
import type { RootDTO } from '@shared/types';

export async function getStatus(): Promise<{ tokenConfigured: boolean; outputDir: string | null }> {
  const res = await fetch('/api/status');
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

export async function postSetup(notionToken: string, outputDir: string): Promise<void> {
  const res = await fetch('/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ notionToken, outputDir }),
  });
  if (!res.ok) throw new Error(`setup failed: ${res.status}`);
}

export async function getRoots(): Promise<RootDTO[]> {
  const res = await fetch('/api/roots');
  if (!res.ok) throw new Error(`roots failed: ${res.status}`);
  return res.json();
}

export async function startExtract(selection: Array<{ id: string; kind: string }>): Promise<string> {
  const res = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ selection }),
  });
  if (!res.ok) throw new Error(`extract failed: ${res.status}`);
  const { job_id } = await res.json();
  return job_id;
}
```

- [ ] **Step 2: Write main entry**

```tsx
// app/src/web/main.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><App /></React.StrictMode>);
```

- [ ] **Step 3: Write `App.tsx` shell with view-switching logic**

```tsx
// app/src/web/App.tsx
import { useEffect, useState } from 'react';
import { getStatus } from './api.js';
import { SetupView } from './components/SetupView.js';
import { TreeView } from './components/TreeView.js';
import { ProgressView } from './components/ProgressView.js';

type View = { name: 'loading' } | { name: 'setup' } | { name: 'selection' } | { name: 'progress'; jobId: string };

export function App() {
  const [view, setView] = useState<View>({ name: 'loading' });

  useEffect(() => {
    getStatus()
      .then((status) => setView({ name: status.tokenConfigured ? 'selection' : 'setup' }))
      .catch(() => setView({ name: 'setup' }));
  }, []);

  return (
    <div className="app">
      <header>
        <h1>notion-2-obsidian</h1>
        <p className="subtitle">Migre seu workspace do Notion para o Obsidian.</p>
      </header>
      <main>
        {view.name === 'loading' && <p>Carregando…</p>}
        {view.name === 'setup' && <SetupView onDone={() => setView({ name: 'selection' })} />}
        {view.name === 'selection' && <TreeView onStart={(jobId) => setView({ name: 'progress', jobId })} />}
        {view.name === 'progress' && <ProgressView jobId={view.jobId} />}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Write minimal CSS**

```css
/* app/src/web/styles.css */
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f5; color: #1f1f1d; }
.app { max-width: 720px; margin: 0 auto; }
header { padding: 1.5rem 2rem; background: white; border-bottom: 1px solid #e5e5e0; }
header h1 { margin: 0; font-size: 1.5rem; }
.subtitle { margin: 0.25rem 0 0; color: #666; }
main { padding: 1.5rem 2rem; }
button { padding: 0.6rem 1.2rem; font-size: 1rem; background: #2f6feb; color: white; border: 0; border-radius: 6px; cursor: pointer; }
button:disabled { background: #ccc; cursor: not-allowed; }
input, button { font: inherit; }
input[type="text"], input[type="password"] { padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; width: 100%; }
label { display: block; margin: 0.75rem 0; }
ul.tree { list-style: none; padding: 0; }
ul.tree li { padding: 0.5rem 0; border-bottom: 1px solid #ececec; }
progress { width: 100%; height: 1rem; }
pre.log { background: #1f1f1d; color: #d4d4ce; padding: 0.75rem; border-radius: 6px; max-height: 22rem; overflow: auto; font: 0.85rem ui-monospace, Menlo, monospace; }
.log-line.failed { color: #ff8b8b; }
.log-line.done { color: #88f0a0; }
```

- [ ] **Step 5: Commit**

```bash
cd .. && git add app/src/web/main.tsx app/src/web/App.tsx app/src/web/api.ts app/src/web/styles.css
git commit -m "feat(web): App shell, API client, base styles"
```

---

## Task 21: SetupView component

**Files:**
- Create: `app/src/web/components/SetupView.tsx`, `app/src/web/components/SetupView.test.tsx`

- [ ] **Step 1: Tests**

```tsx
// app/src/web/components/SetupView.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SetupView } from './SetupView.js';

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
});

describe('SetupView', () => {
  it('disables submit until both fields filled', () => {
    render(<SetupView onDone={vi.fn()} />);
    const button = screen.getByRole('button', { name: /salvar/i });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Notion token/i), { target: { value: 'secret_x' } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Pasta de sa/i), { target: { value: '/v' } });
    expect(button).not.toBeDisabled();
  });

  it('calls onDone after successful save', async () => {
    const onDone = vi.fn();
    render(<SetupView onDone={onDone} />);
    fireEvent.change(screen.getByLabelText(/Notion token/i), { target: { value: 'secret_x' } });
    fireEvent.change(screen.getByLabelText(/Pasta de sa/i), { target: { value: '/v' } });
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// app/src/web/components/SetupView.tsx
import { useState } from 'react';
import { postSetup } from '../api.js';

interface Props { onDone: () => void; }

export function SetupView({ onDone }: Props) {
  const [token, setToken] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !!token && !!outputDir && !busy;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await postSetup(token, outputDir); onDone(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={save}>
      <h2>Configuração</h2>
      <p>Crie uma internal integration em <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer">notion.so/profile/integrations</a>, compartilhe as páginas com ela, e cole o token aqui.</p>
      <label>
        Notion token
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoFocus />
      </label>
      <label>
        Pasta de saída (caminho absoluto)
        <input type="text" value={outputDir} onChange={(e) => setOutputDir(e.target.value)} placeholder="/Users/voce/Obsidian/Vault" />
      </label>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <button type="submit" disabled={!canSubmit}>{busy ? 'Salvando…' : 'Salvar'}</button>
    </form>
  );
}
```

- [ ] **Step 3: Run tests**

```bash
cd app && npm test -- src/web/components/SetupView.test.tsx
```

- [ ] **Step 4: Commit**

```bash
cd .. && git add app/src/web/components/SetupView.tsx app/src/web/components/SetupView.test.tsx
git commit -m "feat(web): SetupView for first-run token + output dir"
```

---

## Task 22: TreeView component

**Files:**
- Create: `app/src/web/components/TreeView.tsx`, `app/src/web/components/TreeView.test.tsx`

- [ ] **Step 1: Tests**

```tsx
// app/src/web/components/TreeView.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TreeView } from './TreeView.js';

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    if (url.endsWith('/api/roots')) {
      return new Response(JSON.stringify([
        { id: 'p1', kind: 'page', title: 'Notas' },
        { id: 'd1', kind: 'database', title: 'Tarefas' },
      ]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/api/extract')) {
      return new Response(JSON.stringify({ job_id: 'job-1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(null, { status: 404 });
  });
});

describe('TreeView', () => {
  it('lists roots and disables submit when nothing selected', async () => {
    render(<TreeView onStart={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Notas')).toBeTruthy());
    expect(screen.getByRole('button', { name: /extrair/i })).toBeDisabled();
  });

  it('enables submit when at least one root is checked', async () => {
    render(<TreeView onStart={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Notas')).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/Notas/));
    expect(screen.getByRole('button', { name: /extrair/i })).not.toBeDisabled();
  });

  it('starts extraction and reports the job id', async () => {
    const onStart = vi.fn();
    render(<TreeView onStart={onStart} />);
    await waitFor(() => expect(screen.getByText('Notas')).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/Notas/));
    fireEvent.click(screen.getByRole('button', { name: /extrair/i }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith('job-1'));
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// app/src/web/components/TreeView.tsx
import { useEffect, useState } from 'react';
import { getRoots, startExtract } from '../api.js';
import type { RootDTO } from '@shared/types';

const ICON: Record<string, string> = { page: '📄', database: '🗃️' };

interface Props { onStart: (jobId: string) => void; }

export function TreeView({ onStart }: Props) {
  const [roots, setRoots] = useState<RootDTO[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getRoots().then(setRoots).catch((e) => setError(String(e)));
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!roots) return;
    setBusy(true); setError(null);
    try {
      const selection = roots.filter((r) => selected.has(r.id)).map((r) => ({ id: r.id, kind: r.kind }));
      const jobId = await startExtract(selection);
      onStart(jobId);
    } catch (e) { setError(String(e)); setBusy(false); }
  }

  if (error) return <p style={{ color: 'crimson' }}>{error}</p>;
  if (!roots) return <p>Carregando árvore…</p>;
  if (!roots.length) return <p>Nenhuma página/database compartilhada com a integração ainda.</p>;

  return (
    <section>
      <h2>O que migrar?</h2>
      <ul className="tree">
        {roots.map((r) => (
          <li key={r.id}>
            <label>
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
              {` ${ICON[r.kind] ?? '•'} ${r.title}`}
            </label>
          </li>
        ))}
      </ul>
      <button disabled={selected.size === 0 || busy} onClick={submit}>
        {busy ? 'Iniciando…' : 'Extrair selecionados'}
      </button>
    </section>
  );
}
```

- [ ] **Step 3: Run tests, expect PASS.**

- [ ] **Step 4: Commit**

```bash
cd .. && git add app/src/web/components/TreeView.tsx app/src/web/components/TreeView.test.tsx
git commit -m "feat(web): TreeView with root selection and extract trigger"
```

---

## Task 23: ProgressView component

**Files:**
- Create: `app/src/web/components/ProgressView.tsx`

No unit tests — relies on EventSource which is messy to mock; smoke-tested in Task 24.

- [ ] **Step 1: Implement**

```tsx
// app/src/web/components/ProgressView.tsx
import { useEffect, useRef, useState } from 'react';

interface Props { jobId: string; }
type LogEntry = { text: string; cls: 'done' | 'failed' | ''; };

export function ProgressView({ jobId }: Props) {
  const [status, setStatus] = useState('Iniciando…');
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const source = new EventSource(`/api/events?job=${encodeURIComponent(jobId)}`);
    const append = (text: string, cls: LogEntry['cls'] = '') =>
      setLog((prev) => [...prev, { text, cls }]);

    source.addEventListener('discovery_started', () => append('Descoberta iniciada'));
    source.addEventListener('discovery_done', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setTotal(d.total);
      setStatus(`Descobertos ${d.total} nós. Extraindo…`);
      append(`Descobertos ${d.total} nós`);
    });
    source.addEventListener('node_done', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setDone((n) => n + 1);
      append(`✓ ${d.id}`, 'done');
    });
    source.addEventListener('node_failed', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      append(`✗ ${d.id}: ${d.reason}`, 'failed');
    });
    source.addEventListener('extraction_done', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setStatus(`Concluído: ${d.pages} páginas, ${d.items} itens, ${d.attachments} anexos.`);
      source.close();
    });

    return () => source.close();
  }, [jobId]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  return (
    <section>
      <h2>{status}</h2>
      <progress value={done} max={Math.max(total, 1)} />
      <pre className="log" ref={logRef}>
        {log.map((entry, i) => (
          <div key={i} className={`log-line ${entry.cls}`}>{entry.text}</div>
        ))}
      </pre>
    </section>
  );
}
```

- [ ] **Step 2: Verify the web build works**

```bash
cd app && npm run build:web
```

Expected: `dist/web/index.html` and assets emitted.

- [ ] **Step 3: Commit**

```bash
cd .. && git add app/src/web/components/ProgressView.tsx
git commit -m "feat(web): ProgressView consumes SSE events"
```

---

## Task 24: Full smoke test (manual)

**Files:** none (manual verification)

- [ ] **Step 1: Build everything**

```bash
cd app && npm run build
```

Expected: `dist/web/index.html` exists, `dist/cli.js` (or `dist/server/...` depending on tsc rootDir output) exists.

- [ ] **Step 2: Run the built CLI in a temp dir**

```bash
mkdir -p /tmp/n2o-smoke && cd /tmp/n2o-smoke
NO_OPEN=1 node /path/to/notion-2-obsidian/app/dist/cli.js &
sleep 1
curl -s http://127.0.0.1:8765/api/status
# Expected: {"tokenConfigured":false,"outputDir":null}
curl -s http://127.0.0.1:8765/ | head -20
# Expected: HTML containing <div id="root">
kill %1
```

- [ ] **Step 3: Open the browser**

In a regular terminal:
```bash
cd /tmp/n2o-smoke && node /path/to/notion-2-obsidian/app/dist/cli.js
```

Browser opens to the SetupView. Visually confirm the layout matches the styles.

If you have a real Notion token and a shared page, complete the setup → selection → extraction flow and confirm a vault is produced in the chosen output dir.

- [ ] **Step 4: Commit nothing** (manual verification only).

---

## Phase 5 — Astro site

## Task 25: Scaffold `site/`

**Files:**
- Create: `site/package.json`, `site/astro.config.mjs`, `site/tsconfig.json`, `site/tailwind.config.mjs`, `site/src/styles.css`

- [ ] **Step 1: Write `site/package.json`**

```json
{
  "name": "notion-2-obsidian-site",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "astro": "^4.15.6",
    "@astrojs/tailwind": "^5.1.0",
    "tailwindcss": "^3.4.10"
  }
}
```

- [ ] **Step 2: Write `site/astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://oandre.github.io',
  base: '/notion-2-obsidian',
  integrations: [tailwind()],
});
```

- [ ] **Step 3: Write `site/tsconfig.json`**

```json
{ "extends": "astro/tsconfigs/strict" }
```

- [ ] **Step 4: Write `site/tailwind.config.mjs`**

```js
export default {
  content: ['./src/**/*.{astro,html,md,mdx,tsx,ts}'],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 5: Write `site/src/styles.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 6: Install + verify scaffold builds**

```bash
cd site && npm install && npm run build
```

Expected: `site/dist/` produced (empty pages yet, but build succeeds).

- [ ] **Step 7: Commit**

```bash
cd .. && git add site/ && git commit -m "chore(site): scaffold Astro + Tailwind"
```

---

## Task 26: Layout and landing page

**Files:**
- Create: `site/src/layouts/Default.astro`, `site/src/pages/index.astro`

- [ ] **Step 1: Write the layout**

```astro
---
// site/src/layouts/Default.astro
import '../styles.css';
const { title, description } = Astro.props;
const base = import.meta.env.BASE_URL;
---
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
  </head>
  <body class="bg-neutral-50 text-neutral-900 antialiased">
    <header class="border-b border-neutral-200 bg-white">
      <div class="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between">
        <a href={base} class="font-semibold">notion-2-obsidian</a>
        <nav class="flex gap-4 text-sm text-neutral-600">
          <a href={`${base}/docs`}>Docs</a>
          <a href={`${base}/privacy`}>Privacy</a>
          <a href={`${base}/terms`}>Terms</a>
          <a href="https://github.com/oandre/notion-2-obsidian">GitHub</a>
        </nav>
      </div>
    </header>
    <main class="mx-auto max-w-3xl px-6 py-12">
      <slot />
    </main>
    <footer class="border-t border-neutral-200 mt-16">
      <div class="mx-auto max-w-3xl px-6 py-6 text-sm text-neutral-500">
        MIT-licensed. <a class="underline" href="https://github.com/oandre/notion-2-obsidian">Code on GitHub</a>.
      </div>
    </footer>
  </body>
</html>
```

- [ ] **Step 2: Write the landing page**

```astro
---
// site/src/pages/index.astro
import Default from '../layouts/Default.astro';
---
<Default title="notion-2-obsidian" description="Migre seu workspace do Notion para um vault Obsidian. Roda local, open source.">
  <section class="space-y-4">
    <h1 class="text-4xl font-semibold tracking-tight">Migre Notion → Obsidian. Local. Sem nuvem.</h1>
    <p class="text-lg text-neutral-700">Selecione as páginas que você quer, baixe um vault Obsidian completo: wikilinks, frontmatter, anexos.</p>
    <pre class="bg-neutral-900 text-neutral-100 rounded-md p-4 text-sm overflow-x-auto"><code>npx notion-2-obsidian@latest</code></pre>
  </section>

  <section class="grid gap-6 md:grid-cols-3 mt-12">
    <div>
      <h2 class="font-semibold mb-1">Você escolhe</h2>
      <p class="text-sm text-neutral-700">Árvore com as páginas e databases que você compartilhou com a integração. Marque o que quiser.</p>
    </div>
    <div>
      <h2 class="font-semibold mb-1">Markdown limpo</h2>
      <p class="text-sm text-neutral-700">Callouts, toggles, code com linguagem, tabelas, equações, embeds nativos do Obsidian.</p>
    </div>
    <div>
      <h2 class="font-semibold mb-1">Roda local</h2>
      <p class="text-sm text-neutral-700">Não há servidor. Não enviamos nada. Sua máquina conversa com a API do Notion e escreve em disco.</p>
    </div>
  </section>
</Default>
```

- [ ] **Step 3: Build and visually verify**

```bash
cd site && npm run build && npm run preview
```

Open `http://localhost:4321/notion-2-obsidian/` and confirm the layout renders.

- [ ] **Step 4: Commit**

```bash
cd .. && git add site/src/layouts site/src/pages/index.astro
git commit -m "feat(site): layout + landing page"
```

---

## Task 27: Privacy + Terms pages

**Files:**
- Create: `site/src/pages/privacy.astro`, `site/src/pages/terms.astro`

- [ ] **Step 1: Write privacy.astro**

```astro
---
import Default from '../layouts/Default.astro';
---
<Default title="Privacy Policy — notion-2-obsidian" description="Privacy policy">
  <article class="prose prose-neutral max-w-none">
    <h1>Privacy Policy</h1>
    <p><em>Last updated: 2026-05-11</em></p>

    <h2>What we collect</h2>
    <p><strong>Nothing.</strong> <code>notion-2-obsidian</code> is a local tool that runs on your machine. There is no server, no telemetry, no analytics. We do not collect, store, transmit, or share any user data.</p>

    <h2>What the tool accesses</h2>
    <ul>
      <li><strong>Notion API.</strong> The tool calls Notion's official API using the integration token you provide. Calls go directly from your machine to <code>api.notion.com</code>.</li>
      <li><strong>Notion-hosted files.</strong> Images and attachments referenced in your pages are downloaded from Notion's S3 URLs directly to your local disk.</li>
      <li><strong>Your local filesystem.</strong> The output vault is written to a path you choose.</li>
    </ul>

    <h2>Your Notion data</h2>
    <p>The integration token only has access to pages and databases you explicitly share with it inside Notion. You can revoke the token at any time from your Notion integrations page.</p>

    <h2>Third parties</h2>
    <p>The tool does not call any service besides Notion's API and the file URLs Notion itself emits. There are no third-party trackers, no ads, no SDKs.</p>

    <h2>Open source</h2>
    <p>The source code is public at <a href="https://github.com/oandre/notion-2-obsidian">github.com/oandre/notion-2-obsidian</a>. You can audit exactly what the tool does.</p>

    <h2>Contact</h2>
    <p>Questions or concerns: <a href="https://github.com/oandre/notion-2-obsidian/issues">file a GitHub issue</a>.</p>
  </article>
</Default>
```

- [ ] **Step 2: Write terms.astro**

```astro
---
import Default from '../layouts/Default.astro';
---
<Default title="Terms of Use — notion-2-obsidian" description="Terms of use">
  <article class="prose prose-neutral max-w-none">
    <h1>Terms of Use</h1>
    <p><em>Last updated: 2026-05-11</em></p>

    <h2>License</h2>
    <p><code>notion-2-obsidian</code> is open-source software distributed under the MIT License. You can use, modify, and redistribute it freely subject to the terms in the <a href="https://github.com/oandre/notion-2-obsidian/blob/main/LICENSE">LICENSE</a> file.</p>

    <h2>No warranty</h2>
    <p>The software is provided "as is", without warranty of any kind, express or implied. The authors are not liable for any loss of data, damage to your Notion workspace, or any other harm arising from use of the tool.</p>

    <h2>Notion's terms</h2>
    <p>By using this tool, you must comply with <a href="https://www.notion.so/Terms-and-Privacy-28ffdd083dc3473e9c2da6ec011b58ac">Notion's Terms of Service</a>. You are responsible for ensuring your use of the Notion API is permitted by Notion.</p>

    <h2>Service</h2>
    <p>This is not a hosted service. There is no SLA. The tool runs entirely on your machine. We do not operate any backend.</p>

    <h2>Changes</h2>
    <p>These terms may be updated. The current version is always at this URL.</p>
  </article>
</Default>
```

- [ ] **Step 3: Add `@tailwindcss/typography` for the `prose` classes**

```bash
cd site && npm install -D @tailwindcss/typography
```

Edit `site/tailwind.config.mjs`:

```js
import typography from '@tailwindcss/typography';
export default {
  content: ['./src/**/*.{astro,html,md,mdx,tsx,ts}'],
  theme: { extend: {} },
  plugins: [typography],
};
```

- [ ] **Step 4: Build and verify**

```bash
cd site && npm run build
```

Open the built `privacy.html` and `terms.html` in `site/dist/` to confirm.

- [ ] **Step 5: Commit**

```bash
cd .. && git add site/ && git commit -m "feat(site): privacy and terms pages with typography plugin"
```

---

## Task 28: Docs page

**Files:**
- Create: `site/src/pages/docs/index.astro`

- [ ] **Step 1: Write `docs/index.astro`**

```astro
---
import Default from '../../layouts/Default.astro';
---
<Default title="Docs — notion-2-obsidian" description="How to set up and use">
  <article class="prose prose-neutral max-w-none">
    <h1>Quickstart</h1>

    <h2>1. Create a Notion integration</h2>
    <ol>
      <li>Go to <a href="https://www.notion.so/profile/integrations">notion.so/profile/integrations</a>.</li>
      <li>Click <strong>+ New integration</strong>. Pick <strong>Internal</strong>. Name it whatever, pick your workspace.</li>
      <li>Copy the <strong>Internal Integration Token</strong>.</li>
    </ol>

    <h2>2. Share pages with the integration</h2>
    <p>In Notion, open the page you want to migrate → click <code>···</code> → <strong>Connections</strong> → pick your integration. Sub-pages and database rows are reachable automatically.</p>

    <h2>3. Run the tool</h2>
    <pre><code>npx notion-2-obsidian@latest</code></pre>
    <p>Your browser opens. Paste the token, pick an output folder, and select what to migrate.</p>

    <h2>What you get</h2>
    <ul>
      <li><strong>Pages</strong> → <code>.md</code> files (or folders if they have sub-pages, with a sibling <code>.md</code> for the page content).</li>
      <li><strong>Databases</strong> → folders with one <code>.md</code> per row. Properties go into YAML frontmatter. The folder gets a sibling <code>.md</code> with a table linking each row.</li>
      <li><strong>Mentions, relations, link_to_page</strong> → Obsidian wikilinks (<code>[[Page Name]]</code>) if the target was also extracted. Otherwise listed in <code>_report.md</code>.</li>
      <li><strong>Attachments</strong> → downloaded to <code>assets/</code>, links rewritten to relative paths.</li>
    </ul>

    <h2>Known limitations</h2>
    <ul>
      <li>Column layouts are flattened (content kept, layout lost).</li>
      <li>Synced blocks render inline; Obsidian has no direct transclusion equivalent.</li>
      <li>Comments and version history are not exported (Notion's API doesn't expose them).</li>
      <li>Each run overwrites the output directory. No incremental sync.</li>
    </ul>
  </article>
</Default>
```

- [ ] **Step 2: Build and verify**

```bash
cd site && npm run build
```

- [ ] **Step 3: Commit**

```bash
cd .. && git add site/src/pages/docs/index.astro
git commit -m "feat(site): docs quickstart page"
```

---

## Phase 6 — CI/CD

## Task 29: CI workflow (lint + test + build for app and site)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  app:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: app } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm', cache-dependency-path: app/package-lock.json }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build

  site:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: site } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm', cache-dependency-path: site/package-lock.json }
      - run: npm ci
      - run: npm run build
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: lint + test + build for app and site"
```

---

## Task 30: GitHub Pages deploy workflow

**Files:**
- Create: `.github/workflows/publish-pages.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: Publish Pages

on:
  push:
    branches: [main]
    paths:
      - 'site/**'
      - '.github/workflows/publish-pages.yml'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm', cache-dependency-path: site/package-lock.json }
      - run: npm ci
        working-directory: site
      - run: npm run build
        working-directory: site
      - uses: actions/upload-pages-artifact@v3
        with: { path: site/dist }
      - id: deploy
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: After committing and pushing, enable Pages in the repo settings**

In the GitHub repo: Settings → Pages → Source: "GitHub Actions". (Manual one-time setup; document in the README.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/publish-pages.yml
git commit -m "ci: deploy Astro site to GitHub Pages on push to main"
```

---

## Task 31: npm publish workflow

**Files:**
- Create: `.github/workflows/publish-npm.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: Publish to npm

on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: app } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
          cache: 'npm'
          cache-dependency-path: app/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 2: Add the `NPM_TOKEN` secret in the repo settings**

In GitHub: Settings → Secrets and variables → Actions → New repository secret → `NPM_TOKEN` with a token from https://www.npmjs.com/settings/<your-account>/tokens (Automation type, granular access to `notion-2-obsidian`).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/publish-npm.yml
git commit -m "ci: publish app to npm on version tags"
```

---

## Task 32: Final README + CLAUDE.md rewrite

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: Write final README**

```markdown
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
```

- [ ] **Step 2: Write final CLAUDE.md**

```markdown
# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## What this project is

A local Node CLI that migrates a Notion workspace to an Obsidian vault. Distributed as `npx notion-2-obsidian`. There is also a marketing/legal/docs site in `site/` deployed to GitHub Pages.

## Repo layout

- `app/` — the published npm package. TypeScript, Fastify backend, React + Vite frontend. The frontend is built and embedded inside `dist/` so a single `node dist/cli.js` boots the local server with static files baked in.
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
```

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: final README and CLAUDE.md for v0.2"
```

---

## Self-Review

**Spec coverage check** against `docs/superpowers/specs/2026-05-11-node-rewrite-design.md`:

- §2 Objetivo, §3 Decisões — Tasks 1, 2, 32 cover stack, distribution, license, repo cleanup.
- §4 Arquitetura (3-fase pipeline) — Tasks 12, 13, 14, 16 implement discovery, attachments, resolve, pipeline.
- §4.2 Concorrência (p-limit) — Tasks 3, 13 use `p-limit`.
- §5 Mapping — Tasks 5–9 cover all block types and properties; rules are referenced from v0.1.
- §6 Estrutura do repo — matches Task 2 (app/) and Task 25 (site/).
- §7 Build e distribuição — Task 2 (package.json with `bin`), Task 24 (smoke), Task 31 (publish workflow).
- §8 UI — Tasks 20–23 cover SetupView, TreeView, ProgressView.
- §9 API HTTP — Task 18 implements all five endpoints (`/api/status`, `/api/setup`, `/api/roots`, `/api/extract`, `/api/events`).
- §10 Testes — covered throughout.
- §11 Conteúdo do site — Tasks 26, 27, 28.
- §12 Python existing code — Task 1.
- §13 Erros — covered by individual tasks (412 on missing token in Task 18; per-node isolation in Task 16; downloader swallow in Task 16).
- §14 CI/CD — Tasks 29, 30, 31.

**Placeholder scan:** no "TBD"/"TODO" strings. Tasks 5, 6, 8, 9, 10 explicitly instruct "port the remaining cases from v0.1 at git tag X" — this is a deliberate, sourced reference, not a placeholder.

**Type consistency:**
- `PlannedNode` shape consistent across `plan.ts`, `discovery.ts`, `pipeline.ts`.
- `LinkContext` fields match between `resolve.ts` and `pipeline.ts`.
- `EventBus.publish/subscribe` signatures consistent.
- `NotionClient` constructor options consistent across tests and implementation.

One thing worth flagging: the spec's `/api/setup` returns 204; the test in Task 18 asserts `204`. Consistent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-11-node-rewrite.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review per task. Catches issues early, preserves your context.
2. **Inline Execution** — execute tasks in this session sequentially. Faster end-to-end but adds to context.

Which approach?
