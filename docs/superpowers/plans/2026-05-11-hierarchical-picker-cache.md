# Hierarchical Picker + Workspace Tree Cache — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat root list with a hierarchical, drill-down workspace picker, and persist the discovered tree to disk so subsequent runs skip the long Notion API discovery.

**Architecture:** Discovery becomes a separate phase (`discoverWorkspace`) producing a `PlannedNode[]` of the full accessible workspace, serialized to `<OUTPUT_DIR>/.notion-2-obsidian-cache.json`. The Fastify app gains `/api/tree` (with optional `?refresh=true`) and changes `/api/extract` to consume `{ selectedIds }`. The React frontend gets a recursive `TreeNode` component with checkboxes, expand/collapse, indeterminate state, and a refresh button.

**Tech Stack:** Same as v0.2 — TypeScript, Fastify, undici, React, Vite, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-05-11-hierarchical-picker-cache-design.md`

**Branch:** `feat/hierarchical-picker-cache` (already created on top of `main`).

---

## File Structure (after this plan)

```
app/
├── src/
│   ├── server/
│   │   ├── cache.ts                          # NEW
│   │   ├── cache.test.ts                     # NEW
│   │   ├── app.ts                            # MODIFIED (routes)
│   │   ├── app.test.ts                       # MODIFIED
│   │   ├── extract/
│   │   │   ├── pipeline.ts                   # MODIFIED (signature)
│   │   │   ├── pipeline.test.ts              # MODIFIED
│   │   │   └── selection.ts                  # NEW (expandWithDescendants etc.)
│   │   │   └── selection.test.ts             # NEW
│   │   └── notion/
│   │       ├── discovery.ts                  # MODIFIED (export discoverWorkspace)
│   │       └── discovery.test.ts             # MODIFIED
│   └── web/
│       ├── api.ts                            # MODIFIED (getTree, postExtract)
│       └── components/
│           ├── TreeView.tsx                  # REWRITTEN (recursive)
│           ├── TreeView.test.tsx             # MODIFIED
│           └── TreeNode.tsx                  # NEW
│           └── DiscoveryProgress.tsx         # NEW
```

`PlannedNode` (shared/types.ts) is unchanged.

---

## Task 1: Selection helpers

Pure utility module: given the full tree + a set of user-selected ids, compute the effective set of ids to render and write. The rule (from spec §4.2.1):

- A selected node implies all its descendants.
- Ancestors of selected nodes are NOT in the effective set (no `.md` written for them); they exist in the tree only so `planPaths` can resolve correct paths through them.

**Files:**
- Create: `app/src/server/extract/selection.ts`
- Create: `app/src/server/extract/selection.test.ts`

- [ ] **Step 1: Failing test**

```ts
// app/src/server/extract/selection.test.ts
import { describe, it, expect } from 'vitest';
import type { PlannedNode } from '@shared/types';
import { expandSelectionToDescendants } from './selection.js';

function node(over: Partial<PlannedNode>): PlannedNode {
  return {
    id: '', kind: 'page', title: '',
    parentId: null, childrenIds: [],
    blocks: [], pageData: {},
    ...over,
  };
}

describe('expandSelectionToDescendants', () => {
  it('returns the input set when no descendants exist', () => {
    const tree = [node({ id: 'a' })];
    expect(expandSelectionToDescendants(new Set(['a']), tree)).toEqual(new Set(['a']));
  });

  it('includes direct children', () => {
    const tree = [
      node({ id: 'a', childrenIds: ['b', 'c'] }),
      node({ id: 'b', parentId: 'a' }),
      node({ id: 'c', parentId: 'a' }),
    ];
    expect(expandSelectionToDescendants(new Set(['a']), tree)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('includes grandchildren recursively', () => {
    const tree = [
      node({ id: 'a', childrenIds: ['b'] }),
      node({ id: 'b', parentId: 'a', childrenIds: ['c'] }),
      node({ id: 'c', parentId: 'b' }),
    ];
    expect(expandSelectionToDescendants(new Set(['a']), tree)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('union when multiple roots are selected', () => {
    const tree = [
      node({ id: 'a', childrenIds: ['b'] }),
      node({ id: 'b', parentId: 'a' }),
      node({ id: 'x' }),
    ];
    expect(expandSelectionToDescendants(new Set(['a', 'x']), tree)).toEqual(new Set(['a', 'b', 'x']));
  });

  it('selecting only a leaf does not pull in ancestors', () => {
    const tree = [
      node({ id: 'a', childrenIds: ['b'] }),
      node({ id: 'b', parentId: 'a' }),
    ];
    expect(expandSelectionToDescendants(new Set(['b']), tree)).toEqual(new Set(['b']));
  });
});
```

- [ ] **Step 2: Run, see failures**

```bash
cd app && npm test -- src/server/extract/selection.test.ts 2>&1 | tail -10
```

Expected: module not found.

- [ ] **Step 3: Implement**

```ts
// app/src/server/extract/selection.ts
import type { PlannedNode } from '@shared/types';

export function expandSelectionToDescendants(
  selected: Set<string>,
  tree: PlannedNode[]
): Set<string> {
  const byId = new Map(tree.map((n) => [n.id, n]));
  const out = new Set<string>();

  function add(id: string): void {
    if (out.has(id)) return;
    out.add(id);
    const node = byId.get(id);
    if (!node) return;
    for (const childId of node.childrenIds) add(childId);
  }

  for (const id of selected) add(id);
  return out;
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd app && npm test -- src/server/extract/selection.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
cd /Users/andresimoes/Documents/Mecanizou/Lab/notion-extractor
git add app/src/server/extract/selection.ts app/src/server/extract/selection.test.ts
git -c user.name="andresimoes" -c user.email="sou@oand.re" commit -m "feat(extract): expandSelectionToDescendants helper"
```

---

## Task 2: `discoverWorkspace` — full-tree variant of discovery

Currently `discovery.ts` exports `listSharedRoots` (returns just the roots) and `discoverSubtree(client, rootId, rootKind)` (walks ONE subtree). For v0.3 we add `discoverWorkspace(client)` that walks ALL roots and returns the union `PlannedNode[]`. Old functions stay (still useful for tests).

**Files:**
- Modify: `app/src/server/notion/discovery.ts`
- Modify: `app/src/server/notion/discovery.test.ts`

- [ ] **Step 1: Add a failing test for `discoverWorkspace`**

Append to `app/src/server/notion/discovery.test.ts`:

```ts
describe('discoverWorkspace', () => {
  it('walks every root returned by /search', async () => {
    const pool = mock.get('https://api.notion.com');

    // /search returns two workspace-level roots
    pool.intercept({ path: '/v1/search', method: 'POST' }).reply(200, {
      results: [
        {
          object: 'page',
          id: 'p1',
          properties: { title: { type: 'title', title: [rich('Notas')] } },
        },
        {
          object: 'database',
          id: 'd1',
          title: [rich('Tarefas')],
        },
      ],
      next_cursor: null,
      has_more: false,
    });

    // Walk root p1
    pool.intercept({ path: '/v1/pages/p1', method: 'GET' }).reply(200, {
      id: 'p1',
      properties: { title: { type: 'title', title: [rich('Notas')] } },
    });
    pool
      .intercept({ path: '/v1/blocks/p1/children?page_size=100', method: 'GET' })
      .reply(200, { results: [], next_cursor: null, has_more: false });

    // Walk root d1 (database query)
    pool.intercept({ path: '/v1/databases/d1', method: 'GET' }).reply(200, {
      id: 'd1',
      title: [rich('Tarefas')],
    });
    pool.intercept({ path: '/v1/databases/d1/query', method: 'POST' }).reply(200, {
      results: [],
      next_cursor: null,
      has_more: false,
    });

    const { discoverWorkspace } = await import('./discovery.js');
    const client = new NotionClient({ token: 't' });
    const nodes = await discoverWorkspace(client);

    expect(new Set(nodes.map((n) => n.id))).toEqual(new Set(['p1', 'd1']));
  });
});
```

- [ ] **Step 2: Run, see failure**

```bash
cd app && npm test -- src/server/notion/discovery.test.ts 2>&1 | tail -10
```

Expected: import or function-not-defined failure.

- [ ] **Step 3: Implement `discoverWorkspace`**

Append to `app/src/server/notion/discovery.ts` (after the existing `discoverSubtree` definition, before the `function makeNode` block):

```ts
export async function discoverWorkspace(client: NotionClient): Promise<PlannedNode[]> {
  const roots = await listSharedRoots(client);
  const trees: PlannedNode[][] = [];
  for (const root of roots) {
    const subtree = await discoverSubtree(client, root.id, root.kind);
    trees.push(subtree);
  }
  // Flatten without losing parent/child wiring (each subtree already has it).
  return trees.flat();
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd app && npm test -- src/server/notion/discovery.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add app/src/server/notion/discovery.ts app/src/server/notion/discovery.test.ts
git -c user.name="andresimoes" -c user.email="sou@oand.re" commit -m "feat(notion): discoverWorkspace walks all roots into one tree"
```

---

## Task 3: Cache module

Persist a `CachedTree` (nodes + workspace id + discovered timestamp + version) to a JSON file inside the output dir.

**Files:**
- Create: `app/src/server/cache.ts`
- Create: `app/src/server/cache.test.ts`

- [ ] **Step 1: Failing test**

```ts
// app/src/server/cache.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { invalidateCache, loadCache, saveCache, type CachedTree } from './cache.js';

async function tmp() {
  return mkdtemp(join(tmpdir(), 'cache-'));
}

function fixture(): CachedTree {
  return {
    version: 1,
    workspaceId: 'ws-1',
    discoveredAt: '2026-05-11T17:00:00.000Z',
    nodes: [
      {
        id: 'p1',
        kind: 'page',
        title: 'Notas',
        parentId: null,
        childrenIds: [],
        blocks: [],
        pageData: {},
      },
    ],
  };
}

describe('cache', () => {
  it('saveCache writes a JSON file under .notion-2-obsidian-cache.json', async () => {
    const dir = await tmp();
    await saveCache(dir, fixture());
    const raw = await readFile(join(dir, '.notion-2-obsidian-cache.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.workspaceId).toBe('ws-1');
    expect(parsed.nodes).toHaveLength(1);
  });

  it('loadCache returns null when file is absent', async () => {
    const dir = await tmp();
    expect(await loadCache(dir, 'ws-1')).toBeNull();
  });

  it('loadCache returns the tree when file matches workspaceId and version', async () => {
    const dir = await tmp();
    await saveCache(dir, fixture());
    const got = await loadCache(dir, 'ws-1');
    expect(got?.nodes[0]?.id).toBe('p1');
  });

  it('loadCache returns null when workspaceId mismatches', async () => {
    const dir = await tmp();
    await saveCache(dir, fixture());
    expect(await loadCache(dir, 'ws-OTHER')).toBeNull();
  });

  it('loadCache returns null when version mismatches', async () => {
    const dir = await tmp();
    await writeFile(
      join(dir, '.notion-2-obsidian-cache.json'),
      JSON.stringify({ ...fixture(), version: 99 }),
      'utf8'
    );
    expect(await loadCache(dir, 'ws-1')).toBeNull();
  });

  it('loadCache returns null when JSON is malformed', async () => {
    const dir = await tmp();
    await writeFile(join(dir, '.notion-2-obsidian-cache.json'), '{ not json', 'utf8');
    expect(await loadCache(dir, 'ws-1')).toBeNull();
  });

  it('invalidateCache removes the file (idempotent)', async () => {
    const dir = await tmp();
    await saveCache(dir, fixture());
    await invalidateCache(dir);
    expect(await loadCache(dir, 'ws-1')).toBeNull();
    // second call should not throw
    await invalidateCache(dir);
  });
});
```

- [ ] **Step 2: Run, see failures**

```bash
cd app && npm test -- src/server/cache.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Implement**

```ts
// app/src/server/cache.ts
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PlannedNode } from '@shared/types';

const FILENAME = '.notion-2-obsidian-cache.json';
const CURRENT_VERSION = 1;

export interface CachedTree {
  version: number;
  workspaceId: string | null;
  discoveredAt: string;
  nodes: PlannedNode[];
}

export async function loadCache(
  outputDir: string,
  expectedWorkspaceId: string | null
): Promise<CachedTree | null> {
  let raw: string;
  try {
    raw = await readFile(join(outputDir, FILENAME), 'utf8');
  } catch {
    return null;
  }
  let parsed: CachedTree;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed.version !== CURRENT_VERSION) return null;
  if (parsed.workspaceId !== expectedWorkspaceId) return null;
  if (!Array.isArray(parsed.nodes)) return null;
  return parsed;
}

export async function saveCache(
  outputDir: string,
  tree: CachedTree
): Promise<void> {
  const payload = { ...tree, version: CURRENT_VERSION };
  await writeFile(
    join(outputDir, FILENAME),
    JSON.stringify(payload, null, 2),
    'utf8'
  );
}

export async function invalidateCache(outputDir: string): Promise<void> {
  try {
    await unlink(join(outputDir, FILENAME));
  } catch {
    // already absent — idempotent
  }
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd app && npm test -- src/server/cache.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add app/src/server/cache.ts app/src/server/cache.test.ts
git -c user.name="andresimoes" -c user.email="sou@oand.re" commit -m "feat(cache): JSON-on-disk workspace tree cache"
```

---

## Task 4: Refactor `runExtraction` to accept a pre-discovered tree

Hoje `runExtraction` faz discovery internamente. Vamos mudar a assinatura para receber `tree: PlannedNode[]` + `selectedIds: string[]`. Discovery sai do orquestrador.

**Files:**
- Modify: `app/src/server/extract/pipeline.ts`
- Modify: `app/src/server/extract/pipeline.test.ts`

- [ ] **Step 1: Update the failing tests first**

Replace the existing `pipeline.test.ts` test bodies — they currently pass `rootSelection: [{id, kind: 'page'}]`. The new tests pass a pre-built tree:

```ts
// app/src/server/extract/pipeline.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  type Dispatcher,
} from 'undici';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlannedNode } from '@shared/types';
import { NotionClient } from '../notion/client.js';
import { EventBus } from '../progress.js';
import { runExtraction } from './pipeline.js';

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

async function tmp() {
  return mkdtemp(join(tmpdir(), 'pipe-'));
}

function makeNode(over: Partial<PlannedNode>): PlannedNode {
  return {
    id: '', kind: 'page', title: '',
    parentId: null, childrenIds: [],
    blocks: [], pageData: {}, ...over,
  };
}

function paragraph(id: string, text: string) {
  return {
    id, type: 'paragraph',
    has_children: false, children: [],
    paragraph: {
      rich_text: [
        {
          type: 'text', text: { content: text, link: null },
          plain_text: text, href: null,
          annotations: {
            bold: false, italic: false, strikethrough: false,
            underline: false, code: false, color: 'default',
          },
        },
      ],
    },
  };
}

describe('runExtraction (tree-driven)', () => {
  it('writes md for a single selected page', async () => {
    const dir = await tmp();
    const tree = [
      makeNode({
        id: 'p1', kind: 'page', title: 'Hello',
        blocks: [paragraph('b1', 'world')],
      }),
    ];

    const client = new NotionClient({ token: 't' });
    const bus = new EventBus();
    const result = await runExtraction({
      client, bus,
      outputDir: dir,
      tree,
      selectedIds: ['p1'],
    });

    const md = await readFile(join(dir, 'Hello.md'), 'utf8');
    expect(md).toContain('world');
    expect(result.pagesExtracted).toBe(1);
  });

  it('selecting a parent pulls descendants in automatically', async () => {
    const dir = await tmp();
    const tree = [
      makeNode({
        id: 'p1', kind: 'page', title: 'Alpha',
        childrenIds: ['p2'],
        blocks: [
          {
            id: 'cp', type: 'child_page', has_children: false, children: [],
            child_page: { title: 'Beta' },
          },
        ],
      }),
      makeNode({ id: 'p2', kind: 'page', title: 'Beta', parentId: 'p1' }),
    ];

    const client = new NotionClient({ token: 't' });
    const bus = new EventBus();
    await runExtraction({
      client, bus,
      outputDir: dir,
      tree,
      selectedIds: ['p1'], // selecting Alpha implies Beta
    });

    const alpha = await readFile(join(dir, 'Alpha.md'), 'utf8');
    expect(alpha).toContain('[[Beta]]');
    const beta = await readFile(join(dir, 'Alpha', 'Beta.md'), 'utf8');
    expect(beta).toBeDefined();
  });

  it('selecting a leaf does NOT write the ancestor md (but folder exists)', async () => {
    const dir = await tmp();
    const tree = [
      makeNode({ id: 'p1', kind: 'page', title: 'Alpha', childrenIds: ['p2'] }),
      makeNode({
        id: 'p2', kind: 'page', title: 'Beta', parentId: 'p1',
        blocks: [paragraph('b', 'deep content')],
      }),
    ];

    const client = new NotionClient({ token: 't' });
    const bus = new EventBus();
    await runExtraction({
      client, bus,
      outputDir: dir,
      tree,
      selectedIds: ['p2'],
    });

    // Beta.md exists at the correct path
    const beta = await readFile(join(dir, 'Alpha', 'Beta.md'), 'utf8');
    expect(beta).toContain('deep content');
    // Alpha.md was NOT generated
    await expect(readFile(join(dir, 'Alpha.md'), 'utf8')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Update the implementation**

Open `app/src/server/extract/pipeline.ts` and replace the `RunExtractionOpts` interface and `runExtraction` function with this version:

```ts
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import type { PlannedNode } from '@shared/types';
import { blocksToMd } from '../convert/blocks.js';
import { propertiesToFrontmatter } from '../convert/properties.js';
import type { NotionClient } from '../notion/client.js';
import { EventBus } from '../progress.js';
import { AttachmentDownloader } from './attachments.js';
import { planPaths } from './plan.js';
import {
  type BrokenLink,
  type LinkContext,
  renderReport,
  resolvePlaceholders,
} from './resolve.js';
import { expandSelectionToDescendants } from './selection.js';

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
  tree: PlannedNode[];
  selectedIds: string[];
}

export async function runExtraction(opts: RunExtractionOpts): Promise<ExtractionResult> {
  const { client, bus, outputDir, tree, selectedIds } = opts;
  void client; // kept on the signature for future use (asset downloads may need auth)
  const startedAt = Date.now();
  await mkdir(outputDir, { recursive: true });
  const downloader = new AttachmentDownloader(join(outputDir, 'assets'));
  const result: ExtractionResult = {
    pagesExtracted: 0, itemsExtracted: 0,
    attachmentsDownloaded: 0, totalBytes: 0, durationS: 0,
    brokenLinks: [], failures: [], warnings: [],
  };

  const effective = expandSelectionToDescendants(new Set(selectedIds), tree);
  const idToNode = new Map(tree.map((n) => [n.id, n]));
  const paths = planPaths(tree, outputDir);

  try {
    const rendered = new Map<string, string>();
    for (const node of tree) {
      if (!effective.has(node.id)) continue;
      await bus.publish({ kind: 'node_started', data: { id: node.id, title: node.title } });
      try {
        rendered.set(node.id, await renderNode(node, idToNode));
        if (node.kind === 'page') result.pagesExtracted++;
        else if (node.kind === 'db_item') result.itemsExtracted++;
        await bus.publish({ kind: 'node_done', data: { id: node.id } });
      } catch (exc) {
        const reason = exc instanceof Error ? exc.message : String(exc);
        result.failures.push({ id: node.id, reason });
        await bus.publish({
          kind: 'node_failed',
          data: { id: node.id, reason },
        });
      }
    }

    for (const node of tree) {
      const md = rendered.get(node.id);
      if (md === undefined) continue;
      const urlToLocal = await downloadAssets(md, downloader, bus);
      result.attachmentsDownloaded += urlToLocal.size;
      for (const local of urlToLocal.values()) {
        try {
          result.totalBytes += (await stat(local)).size;
        } catch {
          // ignore
        }
      }
      const fromFile = paths.get(node.id);
      if (!fromFile) continue;
      const ctx: LinkContext = {
        fromFile, idToPath: paths, urlToLocal, vaultRoot: outputDir,
      };
      const { md: resolved, broken } = resolvePlaceholders(md, ctx);
      result.brokenLinks.push(...broken);
      await mkdir(dirname(fromFile), { recursive: true });
      await writeFile(fromFile, resolved, 'utf8');
    }

    result.durationS = (Date.now() - startedAt) / 1000;
    const report = renderReport({
      vaultRoot: outputDir,
      pagesExtracted: result.pagesExtracted,
      itemsExtracted: result.itemsExtracted,
      attachmentsDownloaded: result.attachmentsDownloaded,
      totalBytes: result.totalBytes,
      durationS: result.durationS,
      brokenLinks: result.brokenLinks,
      failures: result.failures,
      warnings: result.warnings,
    });
    await writeFile(join(outputDir, '_report.md'), report, 'utf8');
    await bus.publish({
      kind: 'extraction_done',
      data: {
        pages: result.pagesExtracted,
        items: result.itemsExtracted,
        attachments: result.attachmentsDownloaded,
      },
    });
    return result;
  } finally {
    await downloader.close();
  }
}

async function renderNode(
  node: PlannedNode,
  idToNode: Map<string, PlannedNode>
): Promise<string> {
  if (node.kind === 'page') return blocksToMd(node.blocks);
  if (node.kind === 'db_item') {
    const page = node.pageData as Record<string, unknown> & {
      properties?: Record<string, unknown>;
      url?: string;
      created_time?: string;
      last_edited_time?: string;
    };
    const fm: Record<string, unknown> = propertiesToFrontmatter(
      (page.properties ?? {}) as Record<string, Record<string, unknown>>
    );
    fm.notion_id = node.id;
    fm.notion_url = page.url ?? '';
    fm.created_time = page.created_time ?? '';
    fm.last_edited_time = page.last_edited_time ?? '';
    const body = blocksToMd(node.blocks);
    return `---\n${yamlStringify(fm).trimEnd()}\n---\n\n${body}`;
  }
  if (node.kind === 'database') return renderDatabaseIndex(node, idToNode);
  return '';
}

function renderDatabaseIndex(
  node: PlannedNode,
  idToNode: Map<string, PlannedNode>
): string {
  const rows = node.childrenIds
    .map((id) => idToNode.get(id))
    .filter((n): n is PlannedNode => !!n);
  if (!rows.length) return `# ${node.title}\n`;
  const lines = [`# ${node.title}`, '', '| Item |', '| --- |'];
  for (const row of rows) {
    lines.push(`| {{notion-link:${row.id}|${row.title}}} |`);
  }
  return `${lines.join('\n')}\n`;
}

async function downloadAssets(
  md: string,
  dl: AttachmentDownloader,
  bus: EventBus
): Promise<Map<string, string>> {
  const urls = new Set<string>();
  for (const m of md.matchAll(ASSET_PLACEHOLDER)) {
    if (m[1]) urls.add(m[1]);
  }
  const urlToLocal = new Map<string, string>();
  for (const url of urls) {
    try {
      const local = await dl.download(url);
      urlToLocal.set(url, local);
      await bus.publish({
        kind: 'attachment_downloaded',
        data: { url, path: local },
      });
    } catch {
      // swallow per-asset failures
    }
  }
  return urlToLocal;
}
```

The key change: drops the `discoverSubtree` import/call; reads `tree` from opts; uses `expandSelectionToDescendants` to compute the effective set; uses `effective.has(node.id)` to skip non-selected nodes (parents that exist in the tree for path-resolution but aren't supposed to be written).

- [ ] **Step 3: Run all server tests, expect PASS**

```bash
cd app && npm test -- src/server 2>&1 | tail -15
```

Three pipeline tests pass. Other server tests are unchanged.

- [ ] **Step 4: Commit**

```bash
git add app/src/server/extract/pipeline.ts app/src/server/extract/pipeline.test.ts
git -c user.name="andresimoes" -c user.email="sou@oand.re" commit -m "refactor(extract): runExtraction takes tree + selectedIds (no discovery)"
```

---

## Task 5: New `/api/tree` route + extract endpoint contract change

The Fastify app gains `/api/tree` (with optional `?refresh=true`), keeps state for the latest tree, and changes `/api/extract` to receive `{ selectedIds }` instead of `{ selection }`.

**Files:**
- Modify: `app/src/server/app.ts`
- Modify: `app/src/server/app.test.ts`

- [ ] **Step 1: Update the failing tests**

Replace `app/src/server/app.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  type Dispatcher,
} from 'undici';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from './app.js';

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

async function tmp() {
  return mkdtemp(join(tmpdir(), 'app-'));
}

const richTitle = (text: string) => ({
  type: 'title',
  title: [
    {
      type: 'text',
      plain_text: text,
      text: { content: text, link: null },
      href: null,
      annotations: {
        bold: false, italic: false, strikethrough: false,
        underline: false, code: false, color: 'default',
      },
    },
  ],
});

async function setupApp() {
  const cwd = await tmp();
  const app = await buildApp({ cwd });
  await app.inject({
    method: 'POST', url: '/api/setup',
    payload: { notionToken: 't', outputDir: cwd },
  });
  return { app, cwd };
}

describe('Fastify app — v0.3', () => {
  it('GET /api/status fresh: tokenConfigured=false', async () => {
    const cwd = await tmp();
    const app = await buildApp({ cwd });
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    expect(res.json()).toEqual({ tokenConfigured: false, outputDir: null });
    await app.close();
  });

  it('POST /api/setup persists token + outputDir', async () => {
    const { app, cwd } = await setupApp();
    const status = await app.inject({ method: 'GET', url: '/api/status' });
    expect(status.json()).toEqual({ tokenConfigured: true, outputDir: cwd });
    await app.close();
  });

  it('GET /api/tree returns nodes (412 if not configured)', async () => {
    const cwd = await tmp();
    const app = await buildApp({ cwd });
    const noToken = await app.inject({ method: 'GET', url: '/api/tree' });
    expect(noToken.statusCode).toBe(412);
    await app.close();
  });

  it('GET /api/tree fetches and caches on first call', async () => {
    const { app, cwd } = await setupApp();
    const pool = mock.get('https://api.notion.com');
    pool.intercept({ path: '/v1/search', method: 'POST' }).reply(200, {
      results: [
        {
          object: 'page', id: 'p1',
          properties: { title: richTitle('Top') },
        },
      ],
      next_cursor: null, has_more: false,
    });
    pool.intercept({ path: '/v1/pages/p1', method: 'GET' }).reply(200, {
      id: 'p1',
      properties: { title: richTitle('Top') },
    });
    pool
      .intercept({ path: '/v1/blocks/p1/children?page_size=100', method: 'GET' })
      .reply(200, { results: [], next_cursor: null, has_more: false });

    const res = await app.inject({ method: 'GET', url: '/api/tree' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { nodes: Array<{ id: string }>; discoveredAt: string };
    expect(body.nodes.find((n) => n.id === 'p1')).toBeDefined();

    // Cache file should exist now
    const cached = await readFile(join(cwd, '.notion-2-obsidian-cache.json'), 'utf8');
    expect(JSON.parse(cached).nodes.find((n: { id: string }) => n.id === 'p1')).toBeDefined();
    await app.close();
  });

  it('POST /api/extract requires prior /api/tree (412 otherwise)', async () => {
    const { app } = await setupApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/extract',
      payload: { selectedIds: ['p1'] },
    });
    expect(res.statusCode).toBe(412);
    await app.close();
  });
});
```

- [ ] **Step 2: Update the implementation**

Replace the body of `app/src/server/app.ts` with this version:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { PlannedNode } from '@shared/types';
import { invalidateCache, loadCache, saveCache, type CachedTree } from './cache.js';
import { loadSettings, writeSettings } from './config.js';
import { NotionClient } from './notion/client.js';
import { discoverWorkspace, listSharedRoots } from './notion/discovery.js';
import { EventBus, eventToSse } from './progress.js';
import { runExtraction } from './extract/pipeline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface BuildAppOpts {
  cwd: string;
}

export async function buildApp(opts: BuildAppOpts): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  const jobs = new Map<string, EventBus>();
  let latestTree: PlannedNode[] | null = null;
  let latestDiscoveredAt: string | null = null;

  const staticDir = resolveStaticDir();
  if (staticDir) {
    await fastify.register(fastifyStatic, {
      root: staticDir,
      prefix: '/',
      index: ['index.html'],
    });
    fastify.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  fastify.get('/api/status', async () => {
    const settings = await loadSettings(opts.cwd);
    return {
      tokenConfigured: !!settings.notionToken,
      outputDir: settings.outputDir,
    };
  });

  fastify.post<{ Body: { notionToken: string; outputDir: string } }>(
    '/api/setup',
    async (req, reply) => {
      const { notionToken, outputDir } = req.body;
      if (!notionToken || !outputDir) {
        return reply.code(400).send({ error: 'notionToken and outputDir are required' });
      }
      await writeSettings(opts.cwd, { notionToken, outputDir });
      // setup invalidates any prior in-memory state
      latestTree = null;
      latestDiscoveredAt = null;
      return reply.code(204).send();
    }
  );

  fastify.get<{ Querystring: { refresh?: string } }>(
    '/api/tree',
    async (req, reply) => {
      const settings = await loadSettings(opts.cwd);
      if (!settings.notionToken || !settings.outputDir) {
        return reply.code(412).send({ error: 'not configured' });
      }
      const refresh = req.query.refresh === 'true';
      const client = new NotionClient({ token: settings.notionToken });

      // workspaceId for cache validity
      const roots = await listSharedRoots(client);
      const workspaceId = pickWorkspaceId(roots);

      if (!refresh) {
        const cached = await loadCache(settings.outputDir, workspaceId);
        if (cached) {
          latestTree = cached.nodes;
          latestDiscoveredAt = cached.discoveredAt;
          return { nodes: cached.nodes, discoveredAt: cached.discoveredAt, cached: true };
        }
      } else {
        await invalidateCache(settings.outputDir);
      }

      const nodes = await discoverWorkspace(client);
      const discoveredAt = new Date().toISOString();
      const tree: CachedTree = {
        version: 1,
        workspaceId,
        discoveredAt,
        nodes,
      };
      try {
        await saveCache(settings.outputDir, tree);
      } catch {
        // permission errors are non-fatal — we still have the tree in memory
      }
      latestTree = nodes;
      latestDiscoveredAt = discoveredAt;
      return { nodes, discoveredAt, cached: false };
    }
  );

  fastify.post<{ Body: { selectedIds: string[] } }>(
    '/api/extract',
    async (req, reply) => {
      const settings = await loadSettings(opts.cwd);
      if (!settings.notionToken || !settings.outputDir) {
        return reply.code(412).send({ error: 'not configured' });
      }
      if (!latestTree) {
        return reply.code(412).send({ error: 'call /api/tree first' });
      }
      const { selectedIds } = req.body;
      if (!Array.isArray(selectedIds)) {
        return reply.code(400).send({ error: 'selectedIds[] required' });
      }

      const bus = new EventBus();
      const jobId = randomUUID();
      jobs.set(jobId, bus);
      const client = new NotionClient({ token: settings.notionToken });
      void runExtraction({
        client, bus,
        outputDir: settings.outputDir,
        tree: latestTree,
        selectedIds,
      });
      return { job_id: jobId };
    }
  );

  fastify.get<{ Querystring: { job?: string } }>('/api/events', async (req, reply) => {
    const job = req.query.job;
    const bus = job ? jobs.get(job) : undefined;
    reply.raw.setHeader('content-type', 'text/event-stream');
    reply.raw.setHeader('cache-control', 'no-cache');
    reply.raw.setHeader('connection', 'keep-alive');
    if (!bus) {
      reply.raw.end();
      return reply;
    }
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

function pickWorkspaceId(roots: PlannedNode[]): string | null {
  // Notion's /search results carry parent.workspace_id on workspace-level pages.
  // Our PlannedNode discards parent. As a stable identifier we use the sorted
  // list of root ids hashed-like: join the first 3 sorted ids. That's enough
  // to detect when the token suddenly points to a totally different workspace.
  const ids = roots.map((r) => r.id).sort();
  if (ids.length === 0) return null;
  return ids.slice(0, 3).join('|');
}

function resolveStaticDir(): string | null {
  const candidates = [
    resolve(__dirname, '../../web'),
    resolve(__dirname, '../../dist/web'),
  ];
  return candidates.find((p) => existsSync(join(p, 'index.html'))) ?? null;
}
```

Note: the spec said `workspaceId` would come from the search results. The Notion search API doesn't reliably expose a workspace UUID — using a derived id from the root set (`pickWorkspaceId`) is a pragmatic, stable substitute. If the user re-points the token to a completely different workspace, the root id set changes and the cache invalidates.

- [ ] **Step 3: Run all tests**

```bash
cd app && npm test 2>&1 | tail -15
```

The 4 app tests pass; existing pipeline and discovery tests pass; total moves up from the previous baseline by a handful.

- [ ] **Step 4: Commit**

```bash
git add app/src/server/app.ts app/src/server/app.test.ts
git -c user.name="andresimoes" -c user.email="sou@oand.re" commit -m "feat(app): /api/tree with cache, /api/extract takes selectedIds"
```

---

## Task 6: Frontend API client + types

Replace `getRoots` with `getTree` / `refreshTree` and update `startExtract` to send `selectedIds`.

**Files:**
- Modify: `app/src/web/api.ts`

- [ ] **Step 1: Replace `app/src/web/api.ts`**

```ts
import type { PlannedNode } from '@shared/types';

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

export interface TreeResponse {
  nodes: PlannedNode[];
  discoveredAt: string;
  cached: boolean;
}

export async function getTree(): Promise<TreeResponse> {
  const res = await fetch('/api/tree');
  if (!res.ok) throw new Error(`tree failed: ${res.status}`);
  return res.json();
}

export async function refreshTree(): Promise<TreeResponse> {
  const res = await fetch('/api/tree?refresh=true');
  if (!res.ok) throw new Error(`tree refresh failed: ${res.status}`);
  return res.json();
}

export async function startExtract(selectedIds: string[]): Promise<string> {
  const res = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ selectedIds }),
  });
  if (!res.ok) throw new Error(`extract failed: ${res.status}`);
  const { job_id } = (await res.json()) as { job_id: string };
  return job_id;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd app && npm run typecheck 2>&1 | tail -5
```

The frontend will now reference functions that the `TreeView` hasn't been updated for — typecheck might complain about `getRoots` not being exported. That's expected; Task 7 fixes the consumer.

If typecheck passes (because TS only flags imports actually used), proceed. If it fails on `TreeView`, that's also expected — Task 7 rewrites it.

- [ ] **Step 3: Commit**

```bash
git add app/src/web/api.ts
git -c user.name="andresimoes" -c user.email="sou@oand.re" commit -m "feat(web): API client gains getTree/refreshTree, drops getRoots"
```

---

## Task 7: Recursive `TreeNode` + rewritten `TreeView`

Two new files: `TreeNode.tsx` (recursive node renderer with checkbox/chevron/indeterminate state) and `DiscoveryProgress.tsx` (used during first-run discovery). `TreeView.tsx` is rewritten to orchestrate them.

**Files:**
- Create: `app/src/web/components/TreeNode.tsx`
- Create: `app/src/web/components/DiscoveryProgress.tsx`
- Modify: `app/src/web/components/TreeView.tsx`
- Modify: `app/src/web/components/TreeView.test.tsx`
- Modify: `app/src/web/styles.css`

- [ ] **Step 1: Update CSS**

Append to `app/src/web/styles.css`:

```css
.tree-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
.tree-header .meta { font-size: 0.85rem; color: #777; }
.tree-toolbar { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.tree-toolbar button { font-size: 0.85rem; padding: 0.3rem 0.6rem; background: #eee; color: #333; }
.tree-node { padding: 0.15rem 0; }
.tree-node .row { display: flex; align-items: center; gap: 0.35rem; cursor: default; }
.tree-node .chev { width: 1rem; display: inline-block; text-align: center; cursor: pointer; user-select: none; color: #888; }
.tree-node .chev.placeholder { cursor: default; color: transparent; }
.tree-node .children { margin-left: 1.25rem; border-left: 1px solid #eee; padding-left: 0.5rem; }
.discovery-progress { padding: 1rem; }
.discovery-progress p { color: #555; margin: 0.5rem 0; }
```

- [ ] **Step 2: Write `TreeNode.tsx`**

```tsx
// app/src/web/components/TreeNode.tsx
import { useMemo } from 'react';
import type { PlannedNode } from '@shared/types';

const ICON: Record<string, string> = { page: '📄', database: '🗃️', db_item: '·' };

interface Props {
  node: PlannedNode;
  childrenOf: Map<string, PlannedNode[]>;
  selected: Set<string>;
  expanded: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
}

export function TreeNode({
  node,
  childrenOf,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
}: Props) {
  const children = childrenOf.get(node.id) ?? [];
  const hasChildren = children.length > 0;
  const isExpanded = expanded.has(node.id);

  // selection state: full (this id is in selected) | none | indeterminate
  const state = useMemo(() => {
    if (selected.has(node.id)) return 'full' as const;
    const descSelected = anyDescendantSelected(node, childrenOf, selected);
    return descSelected ? ('indeterminate' as const) : ('none' as const);
  }, [node, childrenOf, selected]);

  return (
    <div className="tree-node">
      <div className="row">
        <span
          className={`chev ${hasChildren ? '' : 'placeholder'}`}
          onClick={hasChildren ? () => onToggleExpand(node.id) : undefined}
        >
          {hasChildren ? (isExpanded ? '▾' : '▸') : '•'}
        </span>
        <input
          type="checkbox"
          checked={state === 'full'}
          ref={(el) => {
            if (el) el.indeterminate = state === 'indeterminate';
          }}
          onChange={() => onToggleSelect(node.id)}
        />
        <label onClick={() => onToggleSelect(node.id)}>
          {ICON[node.kind] ?? '•'} {node.title}
        </label>
      </div>
      {hasChildren && isExpanded && (
        <div className="children">
          {children.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              childrenOf={childrenOf}
              selected={selected}
              expanded={expanded}
              onToggleSelect={onToggleSelect}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function anyDescendantSelected(
  node: PlannedNode,
  childrenOf: Map<string, PlannedNode[]>,
  selected: Set<string>
): boolean {
  const children = childrenOf.get(node.id) ?? [];
  for (const c of children) {
    if (selected.has(c.id)) return true;
    if (anyDescendantSelected(c, childrenOf, selected)) return true;
  }
  return false;
}
```

- [ ] **Step 3: Write `DiscoveryProgress.tsx`**

```tsx
// app/src/web/components/DiscoveryProgress.tsx
export function DiscoveryProgress() {
  return (
    <div className="discovery-progress">
      <p>Descobrindo o workspace…</p>
      <p>Isso só acontece na primeira vez. Em execuções futuras, o picker carrega instantâneo.</p>
      <progress />
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `TreeView.tsx`**

```tsx
// app/src/web/components/TreeView.tsx
import { useEffect, useMemo, useState } from 'react';
import type { PlannedNode } from '@shared/types';
import { getTree, refreshTree, startExtract } from '../api.js';
import { TreeNode } from './TreeNode.js';
import { DiscoveryProgress } from './DiscoveryProgress.js';

interface Props {
  onStart: (jobId: string) => void;
}

export function TreeView({ onStart }: Props) {
  const [nodes, setNodes] = useState<PlannedNode[] | null>(null);
  const [discoveredAt, setDiscoveredAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    getTree()
      .then((r) => {
        setNodes(r.nodes);
        setDiscoveredAt(r.discoveredAt);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const { roots, childrenOf } = useMemo(() => {
    const all = nodes ?? [];
    const byParent = new Map<string | null, PlannedNode[]>();
    for (const n of all) {
      const key = n.parentId;
      const list = byParent.get(key) ?? [];
      list.push(n);
      byParent.set(key, list);
    }
    const childMap = new Map<string, PlannedNode[]>();
    for (const [parent, kids] of byParent) {
      if (parent !== null) childMap.set(parent, kids);
    }
    return {
      roots: byParent.get(null) ?? [],
      childrenOf: childMap,
    };
  }, [nodes]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    const all = nodes ?? [];
    setExpanded(new Set(all.map((n) => n.id)));
  }

  function collapseAll() {
    setExpanded(new Set());
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function doRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const r = await refreshTree();
      setNodes(r.nodes);
      setDiscoveredAt(r.discoveredAt);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const jobId = await startExtract([...selected]);
      onStart(jobId);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  if (error) return <p style={{ color: 'crimson' }}>{error}</p>;
  if (nodes === null) return <DiscoveryProgress />;
  if (!nodes.length) return <p>Nenhuma página/database compartilhada com a integração ainda.</p>;

  return (
    <section>
      <div className="tree-header">
        <h2>O que migrar?</h2>
        <div className="meta">
          {discoveredAt && (
            <>
              Última atualização: {new Date(discoveredAt).toLocaleString('pt-BR')}{' '}
              <button
                type="button"
                onClick={doRefresh}
                disabled={refreshing}
                aria-label="Refresh tree"
              >
                {refreshing ? '↻…' : '↻ Refresh'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="tree-toolbar">
        <button type="button" onClick={expandAll}>Expandir tudo</button>
        <button type="button" onClick={collapseAll}>Recolher tudo</button>
        <button type="button" onClick={clearSelection}>Limpar seleção</button>
      </div>

      <div>
        {roots.map((r) => (
          <TreeNode
            key={r.id}
            node={r}
            childrenOf={childrenOf}
            selected={selected}
            expanded={expanded}
            onToggleSelect={toggleSelect}
            onToggleExpand={toggleExpand}
          />
        ))}
      </div>

      <button
        type="button"
        disabled={selected.size === 0 || busy}
        onClick={submit}
        style={{ marginTop: '1rem' }}
      >
        {busy ? 'Iniciando…' : `Extrair selecionados (${selected.size})`}
      </button>
    </section>
  );
}
```

- [ ] **Step 5: Update `TreeView.test.tsx`**

Replace `app/src/web/components/TreeView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TreeView } from './TreeView.js';

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    if (url.includes('/api/tree')) {
      return new Response(
        JSON.stringify({
          discoveredAt: '2026-05-11T17:00:00.000Z',
          cached: true,
          nodes: [
            {
              id: 'r1', kind: 'page', title: 'Notas',
              parentId: null, childrenIds: ['c1'],
              blocks: [], pageData: {},
            },
            {
              id: 'c1', kind: 'page', title: 'Sub',
              parentId: 'r1', childrenIds: [],
              blocks: [], pageData: {},
            },
            {
              id: 'd1', kind: 'database', title: 'Tarefas',
              parentId: null, childrenIds: [],
              blocks: [], pageData: {},
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url.endsWith('/api/extract')) {
      return new Response(JSON.stringify({ job_id: 'job-1' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(null, { status: 404 });
  });
});

describe('TreeView (recursive)', () => {
  it('renders top-level nodes and disables submit when nothing is selected', async () => {
    render(<TreeView onStart={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Notas/)).toBeTruthy());
    expect(screen.getByText(/Tarefas/)).toBeTruthy();
    // child not visible (collapsed)
    expect(screen.queryByText(/Sub/)).toBeNull();
    expect(
      screen.getByRole('button', { name: /extrair/i })
    ).toBeDisabled();
  });

  it('expanding shows children', async () => {
    render(<TreeView onStart={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Notas/)).toBeTruthy());
    // click chevron next to Notas
    const chevs = screen.getAllByText(/[▸▾]/);
    fireEvent.click(chevs[0]!);
    expect(screen.getByText(/Sub/)).toBeTruthy();
  });

  it('selecting parent and submitting passes the parent id', async () => {
    const onStart = vi.fn();
    render(<TreeView onStart={onStart} />);
    await waitFor(() => expect(screen.getByText(/Notas/)).toBeTruthy());

    const notasCheckbox = screen
      .getAllByRole('checkbox')
      .find((cb, i) => {
        // First root is Notas (idx 0 in roots order)
        // The render order produces checkboxes [Notas, Tarefas] when nothing expanded
        return i === 0;
      });
    fireEvent.click(notasCheckbox!);

    fireEvent.click(screen.getByRole('button', { name: /extrair/i }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith('job-1'));

    const lastCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    const body = JSON.parse((lastCall?.[1] as RequestInit).body as string);
    expect(body).toEqual({ selectedIds: ['r1'] });
  });
});
```

- [ ] **Step 6: Run all tests and the build**

```bash
cd app && npm test 2>&1 | tail -15
cd app && npm run typecheck 2>&1 | tail -5
cd app && npm run lint 2>&1 | tail -5
cd app && npm run build 2>&1 | tail -8
```

All exit 0. If biome flags unused imports or other style nits, apply auto-fixes.

- [ ] **Step 7: Commit**

```bash
git add app/src/web/components/ app/src/web/styles.css
git -c user.name="andresimoes" -c user.email="sou@oand.re" commit -m "feat(web): recursive TreeView with checkbox/expand + DiscoveryProgress"
```

---

## Task 8: Update `App.tsx` and end-to-end smoke

The `App` shell already accepts a `jobId` and switches views. Confirm the new API surface doesn't break it.

**Files:**
- Modify: `app/src/web/App.tsx` (only if needed)

- [ ] **Step 1: Re-read `App.tsx` and confirm it still works**

```bash
cd app && cat src/web/App.tsx
```

The current `App.tsx` does `getStatus()` and switches between `setup`/`selection`/`progress` views. `TreeView` still has the same `onStart: (jobId) => void` signature. No change required.

- [ ] **Step 2: Build and smoke-test in dev mode**

```bash
cd app && (NO_OPEN=1 PORT=8767 npm run dev > /tmp/v3-dev.log 2>&1 &)
sleep 6
curl -sS http://127.0.0.1:8767/api/status
echo
curl -sS http://127.0.0.1:5173/ | head -c 200
echo
pkill -f "tsx watch bin/cli.ts" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
```

Expected: `/api/status` returns `{"tokenConfigured":false,"outputDir":null}`; Vite returns the React HTML. Both processes terminate cleanly after `pkill`.

- [ ] **Step 3: Run full build of production CLI**

```bash
cd app && npm run build
ls -la dist/bin/ dist/web/ 2>&1 | head -10
```

Expected: `dist/bin/cli.js`, `dist/web/index.html` + assets exist.

- [ ] **Step 4: Commit (only if App.tsx changed; otherwise skip)**

Typically nothing to commit here — the smoke test is verification, not code.

---

## Task 9: Update README + docs page

Document the new behavior (hierarchical picker, cache file, refresh button) so users understand the change.

**Files:**
- Modify: `README.md`
- Modify: `site/src/pages/docs/index.astro`

- [ ] **Step 1: Update `README.md`**

In the "Troubleshooting" section, add a new bullet at the bottom:

Find this block:

```markdown
- **Want to start over** — delete the output directory and re-run. Each run overwrites everything.
```

Replace with:

```markdown
- **Want to start over** — delete the output directory and re-run. Each run overwrites everything (except the `.notion-2-obsidian-cache.json` cache file at the root — see below).
- **Workspace tree feels out of date** — the picker caches the workspace structure in `<output>/.notion-2-obsidian-cache.json` so reopens are instant. Click the **↻ Refresh** button to re-walk the workspace. The cache also invalidates automatically if the token suddenly points to a different workspace.
```

- [ ] **Step 2: Update `site/src/pages/docs/index.astro`**

Find the "Troubleshooting" section and add the same bullets. Then add a new section after "What you get":

```astro
    <h2>Workspace tree cache</h2>
    <p>The first time you open the picker, the tool walks every page and database your integration can see — for big workspaces this can take a minute. The result is cached at <code>&lt;output&gt;/.notion-2-obsidian-cache.json</code> so subsequent opens are instant. Hit the <strong>↻ Refresh</strong> button in the picker header to re-walk the workspace whenever you've added or moved pages in Notion.</p>
```

- [ ] **Step 3: Verify Astro builds**

```bash
cd site && npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
cd /Users/andresimoes/Documents/Mecanizou/Lab/notion-extractor
git add README.md site/src/pages/docs/index.astro
git -c user.name="andresimoes" -c user.email="sou@oand.re" commit -m "docs: explain hierarchical picker, cache file, and refresh button"
```

---

## Self-Review

**Spec coverage check** (against `docs/superpowers/specs/2026-05-11-hierarchical-picker-cache-design.md`):

- §3 Decisões de produto — covered: cache scope (task 3), modo eager (task 5), refresh manual (tasks 5, 7), granularidade (task 1 + 4), cache location (task 3), versionamento (task 3).
- §4.1 Fluxo — covered end-to-end via tasks 5 (server) + 7 (client).
- §4.2 Pipeline split — Task 2 (`discoverWorkspace`) + Task 4 (`runExtraction` refactor).
- §4.2.1 Regra de seleção e estrutura de saída — Task 1 (`expandSelectionToDescendants`) + Task 4 (effective filtering in pipeline) + tests cover the leaf-without-ancestor case.
- §4.3 Cache em disco — Task 3.
- §4.4 Cache module — Task 3.
- §4.5 API HTTP — Task 5.
- §4.6 Eventos SSE — unchanged from v0.2; no new task needed.
- §5 Frontend — Tasks 6, 7.
- §7 Tratamento de erros — covered: cache returns null on bad JSON/version/workspace (Task 3); 412 on /api/extract without /api/tree (Task 5); per-node failure isolation kept from v0.2.
- §8 Testes — every assertion in spec §8 maps to a test in tasks 1–7.
- §9 Migração v0.2 → v0.3 — no breaking output changes; addressed in task 9 documentation.

**Placeholder scan:** No "TBD"/"TODO". The plan uses concrete code in every step.

**Type consistency:**
- `PlannedNode` is unchanged across all tasks.
- `CachedTree` interface defined in Task 3; used consistently in Task 5.
- `RunExtractionOpts.tree`/`selectedIds` introduced in Task 4; consumed identically in Task 5 (`POST /api/extract`).
- API client functions `getTree`/`refreshTree`/`startExtract(string[])` defined in Task 6; consumed by `TreeView` in Task 7.

**One known nuance (documented inline):** the spec §4.3 envisioned reading the Notion workspace_id directly from `/search`. In practice, that field isn't reliably exposed by the public Notion API, so Task 5 derives a stable id from the set of root ids. This is documented in the implementation note in Task 5. Effect on user: cache invalidates correctly when the token points to a workspace with a different set of shared roots; if a user shares additional new roots with the same workspace, the derived id might change and trigger an unnecessary re-discovery — acceptable, since they can also click Refresh.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-11-hierarchical-picker-cache.md`. Two execution options:

1. **Subagent-Driven (recommended for high-leverage tasks 4, 5, 7)** — fresh subagent per task with two-stage review on the architectural pieces.
2. **Inline Execution** — implement straight through; this plan has 9 focused tasks, none too large.

Which approach?
