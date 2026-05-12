# Progressive Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic "Descobrindo workspace…" spinner with a phase-by-phase progressive loader during discovery, and add total/phase/title visibility to the extraction progress UI.

**Architecture:** `/api/tree` on cache miss becomes job-based (returns `{ job_id }`, frontend subscribes via SSE) — same pattern as `/api/extract`. `discoverWorkspace`/`discoverSubtree` gain an optional `EventBus` parameter to emit `roots_listing/listed`, `root_started/done`, `discovery_progress`, and `tree_ready` events. `runExtraction` adds `extraction_planned`/`phase_started`/`node_writing` events and includes `title` + `kind` in `node_started`. Frontend `DiscoveryProgress` becomes a stateful component subscribing to events; `ProgressView` shows real numerator/denominator and the current phase.

**Tech Stack:** TypeScript, Fastify, EventSource (SSE), React, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-05-11-progressive-loader-design.md`

**Branch:** `feat/progressive-loader` (already created on top of `feat/hierarchical-picker-cache`, which is v0.3).

---

## File Structure (after this plan)

```
app/
├── src/
│   ├── shared/types.ts                       # MODIFIED (new ProgressEventKind values)
│   ├── server/
│   │   ├── app.ts                            # MODIFIED (job-based /api/tree on miss)
│   │   ├── app.test.ts                       # MODIFIED
│   │   ├── notion/discovery.ts               # MODIFIED (bus param + new events)
│   │   ├── notion/discovery.test.ts          # MODIFIED (one new test)
│   │   └── extract/
│   │       ├── pipeline.ts                   # MODIFIED (phase events + planned)
│   │       └── pipeline.test.ts              # MODIFIED (one new test)
│   └── web/
│       ├── api.ts                            # MODIFIED (getTree union return)
│       └── components/
│           ├── DiscoveryProgress.tsx         # REWRITTEN (event-driven)
│           ├── DiscoveryProgress.test.tsx    # NEW
│           ├── TreeView.tsx                  # MODIFIED (cached vs jobId branch)
│           ├── TreeView.test.tsx             # MODIFIED
│           └── ProgressView.tsx              # MODIFIED (totals + phase + title)
```

---

## Task 1: Extend `ProgressEventKind` and add helper to count by kind

The shared type needs the new event names. We also need a small helper used by the pipeline (to compute totals for `extraction_planned`).

**Files:**
- Modify: `app/src/shared/types.ts`
- Create: `app/src/server/extract/counts.ts`
- Create: `app/src/server/extract/counts.test.ts`

- [ ] **Step 1: Update `app/src/shared/types.ts`**

Replace the existing `ProgressEventKind` union (find the line that starts with `export type ProgressEventKind`) with:

```ts
export type ProgressEventKind =
  | 'discovery_started'
  | 'roots_listing'
  | 'roots_listed'
  | 'root_started'
  | 'discovery_progress'
  | 'root_done'
  | 'discovery_done'
  | 'tree_ready'
  | 'extraction_started'
  | 'extraction_planned'
  | 'phase_started'
  | 'node_started'
  | 'node_done'
  | 'node_failed'
  | 'node_writing'
  | 'attachment_downloaded'
  | 'extraction_done'
  | 'error';
```

Note: `discovery_started` is kept (used for `/api/tree` discovery start). `discovery_progress`, `discovery_done`, `node_started`, `node_done`, `node_failed`, `attachment_downloaded`, `extraction_done`, `error` were already there. The rest are new.

- [ ] **Step 2: Write the failing test for `countByKind`**

`app/src/server/extract/counts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { PlannedNode } from '@shared/types';
import { countByKind } from './counts.js';

function node(over: Partial<PlannedNode>): PlannedNode {
  return {
    id: '',
    kind: 'page',
    title: '',
    parentId: null,
    childrenIds: [],
    blocks: [],
    pageData: {},
    ...over,
  };
}

describe('countByKind', () => {
  it('counts pages, db_items, and databases inside an effective id set', () => {
    const tree: PlannedNode[] = [
      node({ id: 'p1', kind: 'page' }),
      node({ id: 'p2', kind: 'page' }),
      node({ id: 'db1', kind: 'database' }),
      node({ id: 'r1', kind: 'db_item' }),
      node({ id: 'r2', kind: 'db_item' }),
      node({ id: 'r3', kind: 'db_item' }),
      node({ id: 'unused', kind: 'page' }),
    ];
    const effective = new Set(['p1', 'p2', 'db1', 'r1', 'r2', 'r3']);
    expect(countByKind(effective, tree)).toEqual({
      totalPages: 2,
      totalDatabases: 1,
      totalDbItems: 3,
      totalNodes: 6,
    });
  });

  it('zero counts when effective is empty', () => {
    const tree: PlannedNode[] = [node({ id: 'p1', kind: 'page' })];
    expect(countByKind(new Set(), tree)).toEqual({
      totalPages: 0,
      totalDatabases: 0,
      totalDbItems: 0,
      totalNodes: 0,
    });
  });
});
```

- [ ] **Step 3: Run, see failure**

```bash
cd app && npm test -- src/server/extract/counts.test.ts 2>&1 | tail -10
```

- [ ] **Step 4: Implement**

`app/src/server/extract/counts.ts`:

```ts
import type { PlannedNode } from '@shared/types';

export interface KindCounts {
  totalPages: number;
  totalDatabases: number;
  totalDbItems: number;
  totalNodes: number;
}

export function countByKind(effective: Set<string>, tree: PlannedNode[]): KindCounts {
  const counts: KindCounts = {
    totalPages: 0,
    totalDatabases: 0,
    totalDbItems: 0,
    totalNodes: 0,
  };
  for (const node of tree) {
    if (!effective.has(node.id)) continue;
    counts.totalNodes++;
    if (node.kind === 'page') counts.totalPages++;
    else if (node.kind === 'database') counts.totalDatabases++;
    else if (node.kind === 'db_item') counts.totalDbItems++;
  }
  return counts;
}
```

- [ ] **Step 5: Run, expect PASS + typecheck + lint**

```bash
cd app && npm test -- src/server/extract/counts.test.ts 2>&1 | tail -5
cd app && npm run typecheck 2>&1 | tail -3
cd app && npm run lint 2>&1 | tail -3
```

All exit 0.

- [ ] **Step 6: Commit**

```bash
cd /Users/andresimoes/Documents/Mecanizou/Lab/notion-extractor
git add app/src/shared/types.ts app/src/server/extract/counts.ts app/src/server/extract/counts.test.ts
git -c user.name="andresimoes" -c user.email="sou@oand.re" commit -m "feat(shared+extract): new ProgressEventKind values + countByKind helper

Adds the event kinds the v0.4 progressive loader will emit
(roots_listing/listed, root_started/done, tree_ready,
extraction_started/planned, phase_started, node_writing). Adds the
countByKind helper used by the pipeline to compute extraction_planned
totals from the effective id set + the cached tree.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `discoverWorkspace` and `discoverSubtree` emit events when bus is provided

Adds an optional `bus: EventBus` parameter to both discovery functions. When provided, publishes `roots_listing`/`roots_listed` (at the entry), `root_started`/`root_done` (per root), and `discovery_progress` (each time a `PlannedNode` child is added).

**Files:**
- Modify: `app/src/server/notion/discovery.ts`
- Modify: `app/src/server/notion/discovery.test.ts` (add one new test verifying events)

- [ ] **Step 1: Write the failing test**

Append to `app/src/server/notion/discovery.test.ts` (after the existing `discoverWorkspace` describe block):

```ts
describe('discoverWorkspace with bus', () => {
  it('emits roots_listing, roots_listed, root_started, root_done events', async () => {
    const pool = mock.get('https://api.notion.com');

    pool.intercept({ path: '/v1/search', method: 'POST' }).reply(200, {
      results: [
        {
          object: 'page',
          id: 'p1',
          properties: { title: { type: 'title', title: [rich('Notas')] } },
        },
      ],
      next_cursor: null,
      has_more: false,
    });

    pool.intercept({ path: '/v1/pages/p1', method: 'GET' }).reply(200, {
      id: 'p1',
      properties: { title: { type: 'title', title: [rich('Notas')] } },
    });
    pool
      .intercept({ path: '/v1/blocks/p1/children?page_size=100', method: 'GET' })
      .reply(200, { results: [], next_cursor: null, has_more: false });

    const { discoverWorkspace } = await import('./discovery.js');
    const { EventBus } = await import('../progress.js');
    const bus = new EventBus();
    const collected: Array<{ kind: string; data: Record<string, unknown> }> = [];
    const consumer = (async () => {
      for await (const event of bus.subscribe()) {
        collected.push({ kind: event.kind, data: event.data });
        if (event.kind === 'root_done' && (event.data as { id?: string }).id === 'p1') {
          break;
        }
      }
    })();
    await new Promise((r) => setTimeout(r, 0));

    const client = new NotionClient({ token: 't' });
    const nodes = await discoverWorkspace(client, bus);
    await consumer;

    expect(nodes.map((n) => n.id)).toEqual(['p1']);
    const kinds = collected.map((e) => e.kind);
    expect(kinds).toContain('roots_listing');
    expect(kinds).toContain('roots_listed');
    expect(kinds).toContain('root_started');
    expect(kinds).toContain('root_done');

    const rootsListed = collected.find((e) => e.kind === 'roots_listed');
    expect(rootsListed?.data).toEqual({ count: 1 });
    const rootStarted = collected.find((e) => e.kind === 'root_started');
    expect(rootStarted?.data).toEqual({ id: 'p1', title: 'Notas', kind: 'page' });
    const rootDone = collected.find((e) => e.kind === 'root_done');
    expect(rootDone?.data).toEqual({
      id: 'p1',
      title: 'Notas',
      pages: 1,
      databases: 0,
      dbItems: 0,
    });
  });
});
```

- [ ] **Step 2: Run, see failure**

```bash
cd app && npm test -- src/server/notion/discovery.test.ts 2>&1 | tail -10
```

Expected: fails because `discoverWorkspace` currently has signature `(client)` not `(client, bus)`.

- [ ] **Step 3: Modify `discoverWorkspace` and helpers in `app/src/server/notion/discovery.ts`**

Find the existing `discoverWorkspace` function and replace it with this version (along with the helper changes below):

```ts
export async function discoverWorkspace(
  client: NotionClient,
  bus?: EventBus,
): Promise<PlannedNode[]> {
  if (bus) await bus.publish({ kind: 'roots_listing', data: {} });
  const roots = await listSharedRoots(client);
  if (bus) await bus.publish({ kind: 'roots_listed', data: { count: roots.length } });

  const out: PlannedNode[] = [];
  for (const root of roots) {
    if (bus) {
      await bus.publish({
        kind: 'root_started',
        data: { id: root.id, title: root.title, kind: root.kind },
      });
    }
    const subtree = await discoverSubtree(client, root.id, root.kind, bus);
    out.push(...subtree);
    if (bus) {
      let pages = 0;
      let databases = 0;
      let dbItems = 0;
      for (const n of subtree) {
        if (n.kind === 'page') pages++;
        else if (n.kind === 'database') databases++;
        else if (n.kind === 'db_item') dbItems++;
      }
      await bus.publish({
        kind: 'root_done',
        data: { id: root.id, title: root.title, pages, databases, dbItems },
      });
    }
  }
  if (bus) {
    let pages = 0;
    let databases = 0;
    let dbItems = 0;
    for (const n of out) {
      if (n.kind === 'page') pages++;
      else if (n.kind === 'database') databases++;
      else if (n.kind === 'db_item') dbItems++;
    }
    await bus.publish({
      kind: 'discovery_done',
      data: { total: out.length, byKind: { pages, databases, dbItems } },
    });
  }
  return out;
}
```

Also update `discoverSubtree` to accept and propagate the bus:

```ts
export async function discoverSubtree(
  client: NotionClient,
  rootId: string,
  rootKind: NodeKind,
  bus?: EventBus,
): Promise<PlannedNode[]> {
  // ... existing setup of root node ...
  // when calling walkPage / walkDatabase, pass `bus` along
}
```

And inside `walkPage` and `walkDatabase`, after each call to `node.childrenIds.push(child.id); out.push(child);`, add:

```ts
if (bus) {
  await bus.publish({
    kind: 'discovery_progress',
    data: { discovered: out.length, currentRoot: root.id, title: child.title },
  });
}
```

You'll need to thread `bus` and `root.id` (the ancestor root) into `walkPage` / `walkDatabase`. The simplest threading:

```ts
async function walkPage(
  client: NotionClient,
  node: PlannedNode,
  out: PlannedNode[],
  ctx: { bus?: EventBus; rootId: string },
): Promise<void> { /* ... */ }
```

Update the call sites in `discoverSubtree` accordingly (pass `{ bus, rootId: rootId }`). Inside `walkPage`/`walkDatabase`, when recursing, pass the same `ctx` through.

Add `import { EventBus } from '../progress.js';` to the top of `discovery.ts` if not present.

Read the current `discovery.ts` first with `cat /Users/andresimoes/Documents/Mecanizou/Lab/notion-extractor/app/src/server/notion/discovery.ts` to see the exact existing shape and adapt the diff carefully — there are several inner functions to thread `bus` through.

- [ ] **Step 4: Run, expect PASS**

```bash
cd app && npm test -- src/server/notion/discovery.test.ts 2>&1 | tail -10
cd app && npm run typecheck 2>&1 | tail -3
cd app && npm run lint 2>&1 | tail -3
```

The new test passes, existing discovery tests still pass (they call `discoverWorkspace(client)` without bus — back-compat).

If biome flags type issues, add types explicitly. If it auto-fixes formatting, accept.

- [ ] **Step 5: Commit**

```bash
cd /Users/andresimoes/Documents/Mecanizou/Lab/notion-extractor
git add app/src/server/notion/discovery.ts app/src/server/notion/discovery.test.ts
git -c user.name="andresimoes" -c user.email="sou@oand.re" commit -m "feat(notion): discoverWorkspace emits progress events when bus is provided

Threads an optional EventBus through discoverWorkspace, discoverSubtree,
walkPage, and walkDatabase. When the bus is present, publishes:
- roots_listing before /v1/search
- roots_listed after /v1/search (with count)
- root_started before each subtree walk (with id, title, kind)
- discovery_progress for each new PlannedNode child added (with running
  count, currentRoot id, and the child's title)
- root_done after each subtree (with per-kind counts inside that root)
- discovery_done at the very end (with totals and per-kind counts)

When bus is omitted, behavior is identical to v0.3 (back-compat for
existing tests).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `runExtraction` emits `extraction_started`, `extraction_planned`, `phase_started`, and richer per-node events

The pipeline gets explicit phase boundaries and a planning event with totals.

**Files:**
- Modify: `app/src/server/extract/pipeline.ts`
- Modify: `app/src/server/extract/pipeline.test.ts` (add one new test)

- [ ] **Step 1: Write the failing test**

Append to `app/src/server/extract/pipeline.test.ts`:

```ts
import { EventBus } from '../progress.js';

describe('runExtraction events (v0.4 phase + planned)', () => {
  it('emits extraction_started, extraction_planned, two phase_starteds, node_writing', async () => {
    const dir = await tmp();
    const tree: PlannedNode[] = [
      makeNode({
        id: 'p1',
        kind: 'page',
        title: 'Hello',
        blocks: [paragraph('b1', 'world')],
      }),
      makeNode({
        id: 'd1',
        kind: 'database',
        title: 'Tarefas',
        childrenIds: ['r1'],
      }),
      makeNode({
        id: 'r1',
        kind: 'db_item',
        title: 'Fazer X',
        parentId: 'd1',
        pageData: {},
      }),
    ];

    const collected: Array<{ kind: string; data: Record<string, unknown> }> = [];
    const bus = new EventBus();
    const consumer = (async () => {
      for await (const event of bus.subscribe()) {
        collected.push({ kind: event.kind, data: event.data });
        if (event.kind === 'extraction_done') break;
      }
    })();
    await new Promise((r) => setTimeout(r, 0));

    await runExtraction({
      bus,
      outputDir: dir,
      tree,
      selectedIds: ['p1', 'd1'],
    });
    await consumer;

    const kinds = collected.map((e) => e.kind);
    expect(kinds).toContain('extraction_started');
    expect(kinds).toContain('extraction_planned');

    const planned = collected.find((e) => e.kind === 'extraction_planned');
    expect(planned?.data).toEqual({
      totalPages: 1,
      totalDatabases: 1,
      totalDbItems: 1,
      totalNodes: 3,
    });

    const phases = collected
      .filter((e) => e.kind === 'phase_started')
      .map((e) => (e.data as { name: string }).name);
    expect(phases).toEqual(['render', 'download_and_write']);

    const nodeStarted = collected.find((e) => e.kind === 'node_started');
    expect(nodeStarted?.data).toMatchObject({ id: 'p1', title: 'Hello', kind: 'page' });

    const nodeWriting = collected.find((e) => e.kind === 'node_writing');
    expect(nodeWriting?.data).toMatchObject({ id: 'p1', title: 'Hello' });
  });
});
```

- [ ] **Step 2: Run, see failure**

```bash
cd app && npm test -- src/server/extract/pipeline.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Modify `app/src/server/extract/pipeline.ts`**

The current pipeline structure: discover → render-loop → write-loop. We add events around these.

Open the file and make these edits:

1. Add `import { countByKind } from './counts.js';` near the existing imports.

2. Inside `runExtraction`, replace the section that begins with `try {` (the start of the try block) up to and including the first event publish, with this expanded block:

```ts
  try {
    await bus.publish({ kind: 'extraction_started', data: {} });

    const effective = expandSelectionToDescendants(new Set(selectedIds), tree);
    const idToNode = new Map(tree.map((n) => [n.id, n]));
    const paths = planPaths(tree, outputDir);

    const counts = countByKind(effective, tree);
    await bus.publish({
      kind: 'extraction_planned',
      data: {
        totalPages: counts.totalPages,
        totalDatabases: counts.totalDatabases,
        totalDbItems: counts.totalDbItems,
        totalNodes: counts.totalNodes,
      },
    });

    await bus.publish({ kind: 'phase_started', data: { name: 'render' } });

    const rendered = new Map<string, string>();
    for (const node of tree) {
      if (!effective.has(node.id)) continue;
      await bus.publish({
        kind: 'node_started',
        data: { id: node.id, title: node.title, kind: node.kind },
      });
      // ... rest of the render-loop body unchanged ...
```

(Note: this consolidates the `try` opening with the new events. The previous version of the code had `effective`/`idToNode`/`paths` already inside `try` per the Task 4 fix.)

3. Right before the **second** loop (the `for (const node of tree)` that handles writing), add the phase event and add the `node_writing` publish inside the loop **before** `writeFile`:

```ts
    await bus.publish({ kind: 'phase_started', data: { name: 'download_and_write' } });

    for (const node of tree) {
      const md = rendered.get(node.id);
      if (md === undefined) continue;
      const urlToLocal = await downloadAssets(md, downloader, bus);
      // ... existing attachment size accounting ...
      const fromFile = paths.get(node.id);
      if (!fromFile) continue;
      const ctx: LinkContext = { /* unchanged */ };
      const { md: resolved, broken } = resolvePlaceholders(md, ctx);
      result.brokenLinks.push(...broken);
      await mkdir(dirname(fromFile), { recursive: true });
      await bus.publish({
        kind: 'node_writing',
        data: { id: node.id, title: node.title },
      });
      await writeFile(fromFile, resolved, 'utf8');
    }
```

4. `extraction_done` at the end stays as is.

Read the file once with `cat /Users/andresimoes/Documents/Mecanizou/Lab/notion-extractor/app/src/server/extract/pipeline.ts` before editing to make sure you produce a minimal diff.

- [ ] **Step 4: Run, expect PASS**

```bash
cd app && npm test 2>&1 | tail -10
cd app && npm run typecheck 2>&1 | tail -3
cd app && npm run lint 2>&1 | tail -3
```

All tests pass (existing pipeline tests still green; new event test passes).

- [ ] **Step 5: Commit**

```bash
git add app/src/server/extract/pipeline.ts app/src/server/extract/pipeline.test.ts
git -c user.name="andresimoes" -c user.email="sou@oand.re" commit -m "feat(extract): emit extraction_planned, phase_started, node_writing

runExtraction now emits a full progress narrative:
- extraction_started at entry
- extraction_planned with per-kind totals derived from countByKind
- phase_started { name: 'render' } before the render loop
- node_started carries title + kind in payload (not just id)
- phase_started { name: 'download_and_write' } between phases
- node_writing { id, title } right before each writeFile

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `/api/tree` returns a job_id on cache miss, runs discovery in background

The endpoint becomes a union return: `{ nodes, discoveredAt, cached: true }` on hit, or `{ job_id, cached: false }` on miss. Discovery runs in a background async IIFE that publishes events through the bus assigned to that job_id and finalizes by publishing `tree_ready`.

**Files:**
- Modify: `app/src/server/app.ts`
- Modify: `app/src/server/app.test.ts`

- [ ] **Step 1: Update the failing test**

Replace the existing `it('GET /api/tree fetches and caches on first call', ...)` test in `app/src/server/app.test.ts` with this version that exercises the new job-based shape:

```ts
  it('GET /api/tree on cache miss returns { job_id, cached: false } and tree_ready arrives via SSE', async () => {
    const { app, cwd } = await setupApp();
    const pool = mock.get('https://api.notion.com');

    // First /v1/search call: cache-miss check
    pool.intercept({ path: '/v1/search', method: 'POST' }).reply(200, {
      results: [
        { object: 'page', id: 'p1', properties: { title: richTitle('Top') } },
      ],
      next_cursor: null,
      has_more: false,
    });
    // Second /v1/search call: inside discoverWorkspace
    pool.intercept({ path: '/v1/search', method: 'POST' }).reply(200, {
      results: [
        { object: 'page', id: 'p1', properties: { title: richTitle('Top') } },
      ],
      next_cursor: null,
      has_more: false,
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
    const body = res.json() as { job_id?: string; nodes?: unknown; cached: boolean };
    expect(body.cached).toBe(false);
    expect(body.job_id).toMatch(/^[0-9a-f-]+$/);
    expect(body.nodes).toBeUndefined();

    // Wait for the background discovery to complete by polling /api/extract
    // — once the bg discovery sets latestTree, /api/extract no longer 412s.
    let extractRes;
    for (let i = 0; i < 50; i++) {
      extractRes = await app.inject({
        method: 'POST',
        url: '/api/extract',
        payload: { selectedIds: ['p1'] },
      });
      if (extractRes.statusCode !== 412) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(extractRes?.statusCode).toBe(200);

    // Cache file should exist now
    const cached = await readFile(join(cwd, '.notion-2-obsidian-cache.json'), 'utf8');
    expect(JSON.parse(cached).nodes.find((n: { id: string }) => n.id === 'p1')).toBeDefined();
    await app.close();
  });

  it('GET /api/tree on cache hit returns nodes synchronously (no job_id)', async () => {
    const { app, cwd } = await setupApp();
    const pool = mock.get('https://api.notion.com');

    // First call: miss → discovery
    pool.intercept({ path: '/v1/search', method: 'POST' }).reply(200, {
      results: [
        { object: 'page', id: 'p1', properties: { title: richTitle('Top') } },
      ],
      next_cursor: null,
      has_more: false,
    });
    pool.intercept({ path: '/v1/search', method: 'POST' }).reply(200, {
      results: [
        { object: 'page', id: 'p1', properties: { title: richTitle('Top') } },
      ],
      next_cursor: null,
      has_more: false,
    });
    pool.intercept({ path: '/v1/pages/p1', method: 'GET' }).reply(200, {
      id: 'p1',
      properties: { title: richTitle('Top') },
    });
    pool
      .intercept({ path: '/v1/blocks/p1/children?page_size=100', method: 'GET' })
      .reply(200, { results: [], next_cursor: null, has_more: false });

    await app.inject({ method: 'GET', url: '/api/tree' });
    // Wait for bg discovery
    for (let i = 0; i < 50; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/extract',
        payload: { selectedIds: [] },
      });
      if (r.statusCode === 400 || r.statusCode === 200) break;
      await new Promise((r2) => setTimeout(r2, 20));
    }

    // Second /api/tree call: cache hit, only the workspaceId-key /v1/search needed
    pool.intercept({ path: '/v1/search', method: 'POST' }).reply(200, {
      results: [
        { object: 'page', id: 'p1', properties: { title: richTitle('Top') } },
      ],
      next_cursor: null,
      has_more: false,
    });

    const res = await app.inject({ method: 'GET', url: '/api/tree' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { job_id?: string; nodes?: Array<{ id: string }>; cached: boolean };
    expect(body.cached).toBe(true);
    expect(body.job_id).toBeUndefined();
    expect(body.nodes?.find((n) => n.id === 'p1')).toBeDefined();
    await app.close();
  });
```

(The first test is the replacement for the existing cache-miss test. The second is brand new — confirms cache-hit path still returns the inline shape.)

- [ ] **Step 2: Run, see failures**

```bash
cd app && npm test -- src/server/app.test.ts 2>&1 | tail -15
```

- [ ] **Step 3: Replace the `/api/tree` handler in `app/src/server/app.ts`**

Find the existing `fastify.get<{ Querystring: { refresh?: string } }>('/api/tree', ...)` handler and replace it with this version. The handler decides synchronously whether it's a cache hit (return nodes inline) or miss (return job_id and dispatch the discovery into the bg).

```ts
  fastify.get<{ Querystring: { refresh?: string } }>(
    '/api/tree',
    async (req, reply) => {
      const settings = await loadSettings(opts.cwd);
      if (!settings.notionToken || !settings.outputDir) {
        return reply.code(412).send({ error: 'not configured' });
      }
      const refresh = req.query.refresh === 'true';
      const client = new NotionClient({ token: settings.notionToken });

      const roots = await listSharedRoots(client);
      const workspaceId = pickWorkspaceId(roots);

      if (!refresh) {
        const cached = await loadCache(settings.outputDir, workspaceId);
        if (cached) {
          latestTree = cached.nodes;
          return {
            nodes: cached.nodes,
            discoveredAt: cached.discoveredAt,
            cached: true,
          };
        }
      } else {
        await invalidateCache(settings.outputDir);
      }

      // Cache miss → background discovery + SSE job
      const bus = new EventBus();
      const jobId = randomUUID();
      jobs.set(jobId, bus);

      const outputDir = settings.outputDir;
      void (async () => {
        await bus.publish({ kind: 'discovery_started', data: {} });
        try {
          const nodes = await discoverWorkspace(client, bus);
          const discoveredAt = new Date().toISOString();
          const tree: CachedTree = {
            version: 1,
            workspaceId,
            discoveredAt,
            nodes,
          };
          try {
            await saveCache(outputDir, tree);
          } catch {
            // non-fatal
          }
          latestTree = nodes;
          await bus.publish({
            kind: 'tree_ready',
            data: { nodes, discoveredAt },
          });
        } catch (err) {
          await bus.publish({
            kind: 'error',
            data: { message: err instanceof Error ? err.message : String(err) },
          });
        }
      })();

      return { job_id: jobId, cached: false };
    },
  );
```

Also update the `/api/events` handler's break condition so it closes the stream on `tree_ready` too:

```ts
      if (
        event.kind === 'extraction_done' ||
        event.kind === 'error' ||
        event.kind === 'tree_ready'
      ) break;
```

- [ ] **Step 4: Run all tests**

```bash
cd app && npm test 2>&1 | tail -10
cd app && npm run typecheck 2>&1 | tail -3
cd app && npm run lint 2>&1 | tail -3
```

All exit 0. The two `/api/tree` tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/server/app.ts app/src/server/app.test.ts
git -c user.name="andresimoes" -c user.email="sou@oand.re" commit -m "feat(app): /api/tree on cache miss returns job_id; discovery runs in bg

On a cache miss the handler now:
- creates an EventBus + jobId
- kicks off discoverWorkspace(client, bus) in a fire-and-forget IIFE
- returns { job_id, cached: false } immediately so the frontend can
  subscribe to /api/events?job=<id>
- the IIFE saves the cache, sets latestTree, and emits tree_ready with
  the full nodes payload as its final event

Cache hit path is unchanged. /api/events now also closes the stream
on tree_ready.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend `api.ts` reflects the new `/api/tree` union return

**Files:**
- Modify: `app/src/web/api.ts`

- [ ] **Step 1: Update `TreeResponse` and the `getTree` / `refreshTree` return types**

Open `app/src/web/api.ts` and replace the `TreeResponse` block and the two functions that return it:

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

export type TreeResponse =
  | { cached: true; nodes: PlannedNode[]; discoveredAt: string }
  | { cached: false; job_id: string };

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

- [ ] **Step 2: Verify typecheck**

```bash
cd app && npm run typecheck 2>&1 | tail -5
```

The consumer (`TreeView.tsx`) will now type-error because its current code does `setNodes(r.nodes)` directly, assuming nodes always exist. Task 6 fixes this. Skip.

- [ ] **Step 3: Commit**

```bash
git add app/src/web/api.ts
git -c user.name="andresimoes" -c user.email="sou@oand.re" commit -m "feat(web): TreeResponse is a discriminated union (cached vs jobId)

Reflects the new /api/tree contract: cache hit returns inline nodes,
cache miss returns a job_id. Consumers discriminate by the cached flag.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Rewrite `DiscoveryProgress` as event-driven component

Pulls events from `/api/events?job=<id>`, renders a counter, current root description, and a per-root status list.

**Files:**
- Modify: `app/src/web/components/DiscoveryProgress.tsx`
- Create: `app/src/web/components/DiscoveryProgress.test.tsx`
- Append to: `app/src/web/styles.css`

- [ ] **Step 1: Append a few CSS classes**

Append to `app/src/web/styles.css`:

```css
.discovery-progress h2 { margin-top: 0; }
.discovery-progress .counter { font-size: 1.25rem; font-weight: 600; margin: 0.25rem 0; }
.discovery-progress .current { color: #555; margin: 0 0 1rem; min-height: 1.25rem; }
.discovery-progress .roots-list { list-style: none; padding: 0; margin: 0; font-size: 0.85rem; color: #555; }
.discovery-progress .roots-list li { padding: 0.15rem 0; }
.discovery-progress .roots-list .pending { color: #999; }
.discovery-progress .roots-list .done { color: #2a7a2a; }
.discovery-progress .roots-list .active { color: #2f6feb; }
.discovery-progress .err { color: crimson; margin-top: 0.5rem; }
```

- [ ] **Step 2: Rewrite `DiscoveryProgress.tsx`**

Replace `app/src/web/components/DiscoveryProgress.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { PlannedNode } from '@shared/types';

interface RootSummary {
  id: string;
  title: string;
  kind: string;
  status: 'pending' | 'active' | 'done';
  pages: number;
  databases: number;
  dbItems: number;
}

interface Props {
  jobId: string;
  onTreeReady: (nodes: PlannedNode[], discoveredAt: string) => void;
}

export function DiscoveryProgress({ jobId, onTreeReady }: Props) {
  const [discovered, setDiscovered] = useState(0);
  const [currentText, setCurrentText] = useState('');
  const [roots, setRoots] = useState<RootSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const onTreeReadyRef = useRef(onTreeReady);
  onTreeReadyRef.current = onTreeReady;

  useEffect(() => {
    const source = new EventSource(`/api/events?job=${encodeURIComponent(jobId)}`);

    source.addEventListener('discovery_started', () => {
      setCurrentText('Procurando workspace…');
    });

    source.addEventListener('roots_listing', () => {
      setCurrentText('Procurando workspace…');
    });

    source.addEventListener('roots_listed', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { count: number };
      setCurrentText(`Encontradas ${data.count} raízes`);
    });

    source.addEventListener('root_started', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        id: string;
        title: string;
        kind: string;
      };
      setCurrentText(`Mapeando "${data.title}"`);
      setRoots((prev) => [
        ...prev,
        { ...data, status: 'active', pages: 0, databases: 0, dbItems: 0 },
      ]);
    });

    source.addEventListener('discovery_progress', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        discovered: number;
        currentRoot?: string;
        title?: string;
      };
      setDiscovered(data.discovered);
      if (data.title) setCurrentText(`Mapeando "${data.title}"`);
    });

    source.addEventListener('root_done', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        id: string;
        title: string;
        pages: number;
        databases: number;
        dbItems: number;
      };
      setRoots((prev) =>
        prev.map((r) =>
          r.id === data.id
            ? {
                ...r,
                status: 'done',
                pages: data.pages,
                databases: data.databases,
                dbItems: data.dbItems,
              }
            : r,
        ),
      );
    });

    source.addEventListener('tree_ready', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        nodes: PlannedNode[];
        discoveredAt: string;
      };
      onTreeReadyRef.current(data.nodes, data.discoveredAt);
      source.close();
    });

    source.addEventListener('error', (e) => {
      const evt = e as MessageEvent;
      const msg = evt.data
        ? (JSON.parse(evt.data) as { message?: string }).message ?? 'Discovery failed'
        : 'Connection lost';
      setError(msg);
      source.close();
    });

    return () => source.close();
  }, [jobId]);

  return (
    <div className="discovery-progress">
      <h2>Mapeando o workspace…</h2>
      <p className="counter">{discovered} nós encontrados</p>
      <p className="current">{currentText}</p>
      <progress />
      <ul className="roots-list">
        {roots.map((r) => {
          const summary =
            r.status === 'done'
              ? ` (${r.pages} pages${r.databases ? `, ${r.databases} db` : ''}${r.dbItems ? `, ${r.dbItems} items` : ''})`
              : r.status === 'active'
                ? ' (em progresso)'
                : '';
          const marker = r.status === 'done' ? '✓' : r.status === 'active' ? '⟳' : '·';
          return (
            <li key={r.id} className={r.status}>
              {marker} {r.title}{summary}
            </li>
          );
        })}
      </ul>
      {error && <p className="err">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Add a focused test**

Create `app/src/web/components/DiscoveryProgress.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import type { PlannedNode } from '@shared/types';
import { DiscoveryProgress } from './DiscoveryProgress.js';

// Minimal EventSource stub: dispatch events synchronously via fireEvent on listeners.
class FakeEventSource {
  url: string;
  listeners: Map<string, Array<(e: MessageEvent) => void>> = new Map();
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, fn: (e: MessageEvent) => void) {
    const list = this.listeners.get(name) ?? [];
    list.push(fn);
    this.listeners.set(name, list);
  }

  emit(name: string, data: unknown) {
    const list = this.listeners.get(name) ?? [];
    const event = new MessageEvent(name, { data: JSON.stringify(data) });
    for (const fn of list) fn(event);
  }

  close() {
    this.closed = true;
  }

  static instances: FakeEventSource[] = [];
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DiscoveryProgress', () => {
  it('shows counter, current root, and calls onTreeReady when tree_ready arrives', async () => {
    const onTreeReady = vi.fn();
    render(<DiscoveryProgress jobId="job-1" onTreeReady={onTreeReady} />);
    const es = FakeEventSource.instances[0]!;

    es.emit('roots_listed', { count: 1 });
    expect(await screen.findByText(/Encontradas 1 ra/i)).toBeTruthy();

    es.emit('root_started', { id: 'p1', title: 'Notas', kind: 'page' });
    expect(await screen.findByText(/Mapeando "Notas"/)).toBeTruthy();

    es.emit('discovery_progress', { discovered: 5, currentRoot: 'p1' });
    expect(await screen.findByText(/5 nós encontrados/)).toBeTruthy();

    es.emit('root_done', { id: 'p1', title: 'Notas', pages: 3, databases: 0, dbItems: 0 });

    const nodes: PlannedNode[] = [
      { id: 'p1', kind: 'page', title: 'Notas', parentId: null, childrenIds: [], blocks: [], pageData: {} },
    ];
    es.emit('tree_ready', { nodes, discoveredAt: '2026-05-11T18:00:00Z' });

    await waitFor(() => expect(onTreeReady).toHaveBeenCalledWith(nodes, '2026-05-11T18:00:00Z'));
    expect(es.closed).toBe(true);
  });
});
```

- [ ] **Step 4: Run all tests**

```bash
cd app && npm test 2>&1 | tail -15
cd app && npm run typecheck 2>&1 | tail -5
cd app && npm run lint 2>&1 | tail -5
```

All exit 0. (Some `TreeView` typecheck/test issues may surface — Task 7 fixes those.)

- [ ] **Step 5: Commit**

```bash
git add app/src/web/components/DiscoveryProgress.tsx app/src/web/components/DiscoveryProgress.test.tsx app/src/web/styles.css
git -c user.name="andresimoes" -c user.email="sou@oand.re" commit -m "feat(web): DiscoveryProgress streams events from /api/events

Subscribes to the discovery job's SSE stream and renders:
- a running 'X nós encontrados' counter
- a current-action line ('Mapeando \"Notas\"', etc.)
- a list of roots with per-root status (pending/active/done) and counts
  once each root completes
- error display + close on error or tree_ready

When tree_ready arrives, calls the onTreeReady callback so TreeView
can switch to the tree view.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `TreeView` handles cache-hit vs job-id branch; passes onTreeReady down

The `TreeView` now has two paths: if `getTree()` returns a cached payload, populate state directly. If it returns a `job_id`, render `DiscoveryProgress` until `onTreeReady` fires.

**Files:**
- Modify: `app/src/web/components/TreeView.tsx`
- Modify: `app/src/web/components/TreeView.test.tsx`

- [ ] **Step 1: Update the test**

Open `app/src/web/components/TreeView.test.tsx`. Find the `vi.spyOn(globalThis, 'fetch').mockImplementation(...)` block. The current mock returns `nodes` directly. Replace with a version that returns the cached shape (so we don't need to also mock EventSource here):

```ts
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    if (url.includes('/api/tree')) {
      return new Response(
        JSON.stringify({
          cached: true,                                   // ← important: cached path
          discoveredAt: '2026-05-11T17:00:00.000Z',
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
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.endsWith('/api/extract')) {
      return new Response(JSON.stringify({ job_id: 'job-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(null, { status: 404 });
  });
});
```

The three existing test cases (renders top-level nodes, expanding shows children, selecting parent submits) keep working unchanged because they hit the cached path.

- [ ] **Step 2: Update `TreeView.tsx` to handle the union**

Open `app/src/web/components/TreeView.tsx`. Replace the `useEffect` that loads the tree with this version, and add a `discoveryJobId` state and an `onTreeReady` callback:

```tsx
  const [discoveryJobId, setDiscoveryJobId] = useState<string | null>(null);
  // ... existing useState declarations stay above ...

  useEffect(() => {
    getTree()
      .then((r) => {
        if (r.cached) {
          setNodes(r.nodes);
          setDiscoveredAt(r.discoveredAt);
        } else {
          setDiscoveryJobId(r.job_id);
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  function handleTreeReady(newNodes: PlannedNode[], newDiscoveredAt: string) {
    setNodes(newNodes);
    setDiscoveredAt(newDiscoveredAt);
    setDiscoveryJobId(null);
  }
```

Replace the `if (nodes === null) return <DiscoveryProgress />;` line with:

```tsx
  if (nodes === null) {
    if (discoveryJobId) {
      return <DiscoveryProgress jobId={discoveryJobId} onTreeReady={handleTreeReady} />;
    }
    return <p>Carregando…</p>;
  }
```

Update the `doRefresh` function so that if `refreshTree` returns a job_id (cache miss after invalidation), it also goes through the discovery flow:

```tsx
  async function doRefresh() {
    setRefreshing(true);
    setError(null);
    setNodes(null);
    try {
      const r = await refreshTree();
      if (r.cached) {
        setNodes(r.nodes);
        setDiscoveredAt(r.discoveredAt);
      } else {
        setDiscoveryJobId(r.job_id);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }
```

The `import { DiscoveryProgress } from './DiscoveryProgress.js';` should already be there.

- [ ] **Step 3: Run all tests**

```bash
cd app && npm test 2>&1 | tail -10
cd app && npm run typecheck 2>&1 | tail -3
cd app && npm run lint 2>&1 | tail -3
```

All exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/src/web/components/TreeView.tsx app/src/web/components/TreeView.test.tsx
git -c user.name="andresimoes" -c user.email="sou@oand.re" commit -m "feat(web): TreeView handles cache-hit / job_id branch

If getTree returns cached → render the tree immediately. If it returns
a job_id → render DiscoveryProgress with the jobId and an onTreeReady
callback. Same logic on refreshTree, so Refresh after invalidation
goes through the progressive loader.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `ProgressView` shows totals, current phase, and node titles

**Files:**
- Modify: `app/src/web/components/ProgressView.tsx`

- [ ] **Step 1: Replace `ProgressView.tsx`**

Replace the entire `app/src/web/components/ProgressView.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react';

interface Props {
  jobId: string;
}

type LogEntry = { text: string; cls: 'done' | 'failed' | 'writing' | '' };

const PHASE_LABEL: Record<string, string> = {
  render: 'Renderizando blocos',
  download_and_write: 'Baixando anexos e escrevendo arquivos',
};

export function ProgressView({ jobId }: Props) {
  const [phase, setPhase] = useState('Iniciando…');
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const source = new EventSource(`/api/events?job=${encodeURIComponent(jobId)}`);
    const append = (text: string, cls: LogEntry['cls'] = '') =>
      setLog((prev) => [...prev, { text, cls }]);

    source.addEventListener('extraction_planned', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        totalPages: number;
        totalDbItems: number;
        totalDatabases: number;
        totalNodes: number;
      };
      setTotal(data.totalNodes);
      setSummary(
        `${data.totalNodes} nós (${data.totalPages} páginas, ${data.totalDbItems} items, ${data.totalDatabases} db)`,
      );
    });

    source.addEventListener('phase_started', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { name: string };
      setPhase(PHASE_LABEL[data.name] ?? data.name);
    });

    source.addEventListener('node_started', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        id: string;
        title?: string;
      };
      append(`⟳ ${data.title ?? data.id}`);
    });

    source.addEventListener('node_done', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { id: string };
      setDone((n) => n + 1);
      append(`✓ ${data.id}`, 'done');
    });

    source.addEventListener('node_failed', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        id: string;
        reason: string;
      };
      append(`✗ ${data.id}: ${data.reason}`, 'failed');
    });

    source.addEventListener('node_writing', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        id: string;
        title?: string;
      };
      append(`→ escrevendo ${data.title ?? data.id}`, 'writing');
    });

    source.addEventListener('attachment_downloaded', () => {
      // discreet — could be a count later
    });

    source.addEventListener('extraction_done', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        pages: number;
        items: number;
        attachments: number;
      };
      setPhase(
        `Concluído: ${data.pages} páginas, ${data.items} itens, ${data.attachments} anexos.`,
      );
      source.close();
    });

    return () => source.close();
  }, [jobId]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  return (
    <section>
      <h2>{phase}</h2>
      {summary && <p>{summary}</p>}
      <progress value={done} max={Math.max(total, 1)} />
      <p>
        {done}/{Math.max(total, 1)} nós
      </p>
      <pre className="log" ref={logRef}>
        {log.map((entry, i) => (
          <div key={i} className={`log-line ${entry.cls}`}>
            {entry.text}
          </div>
        ))}
      </pre>
    </section>
  );
}
```

Also append a CSS rule for the `writing` log line — open `app/src/web/styles.css` and add:

```css
.log-line.writing { color: #88c2ff; }
```

- [ ] **Step 2: Run tests and build**

```bash
cd app && npm test 2>&1 | tail -10
cd app && npm run typecheck 2>&1 | tail -3
cd app && npm run lint 2>&1 | tail -3
cd app && npm run build:web 2>&1 | tail -8
```

All exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/src/web/components/ProgressView.tsx app/src/web/styles.css
git -c user.name="andresimoes" -c user.email="sou@oand.re" commit -m "feat(web): ProgressView shows totals, current phase, and node titles

- Reads totals from extraction_planned and uses them as the progress
  bar denominator.
- Phase label updates from phase_started events (Renderizando blocos
  / Baixando anexos e escrevendo arquivos).
- node_started/done/failed/writing entries in the log now use titles
  when available.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Smoke test — full build + boot

No new code; just verify everything boots end-to-end and the routes still behave.

- [ ] **Step 1: Full build**

```bash
cd /Users/andresimoes/Documents/Mecanizou/Lab/notion-extractor/app
npm run build 2>&1 | tail -10
ls -la dist/bin/ dist/web/ 2>&1 | head -10
```

Expected: `dist/bin/cli.js` and `dist/web/index.html` both exist.

- [ ] **Step 2: Boot built CLI in a temp dir, hit endpoints**

```bash
cd /tmp && rm -rf n2o-v4 && mkdir n2o-v4 && cd n2o-v4
NO_OPEN=1 PORT=8768 node /Users/andresimoes/Documents/Mecanizou/Lab/notion-extractor/app/dist/bin/cli.js &
PID=$!
sleep 2
echo "--- /api/status ---"
curl -s http://127.0.0.1:8768/api/status
echo
echo "--- /api/tree (no setup, expect 412) ---"
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8768/api/tree
echo "--- /api/extract (no tree, expect 412) ---"
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "content-type: application/json" -d '{"selectedIds":["x"]}' http://127.0.0.1:8768/api/extract
echo "--- GET / (expect HTML) ---"
curl -s http://127.0.0.1:8768/ | head -c 120
echo
kill $PID 2>/dev/null
wait $PID 2>/dev/null
echo done
```

Expected: `tokenConfigured:false`, `412`, `412`, HTML body.

- [ ] **Step 3: No commit needed** (verification only).

---

## Task 10: Update README + docs page

Add a short note that discovery now shows phase-by-phase progress and extraction has a real progress bar.

**Files:**
- Modify: `README.md`
- Modify: `site/src/pages/docs/index.astro`

- [ ] **Step 1: Update README.md**

Find the "## Troubleshooting" section. Just **before** the `## Development` section (i.e. immediately after Troubleshooting), insert a new section:

```markdown
## Progress feedback

When you first open the picker, the tool walks every page and database the integration can see. The discovery UI shows what it's doing in real time: how many nodes have been mapped so far, which root is being walked right now, and a per-root summary as each one finishes ("Notas: 12 pages, 1 database"). On a cache hit, the picker opens instantly without the discovery phase.

During extraction, the progress UI shows the total number of nodes about to be processed, the current phase (rendering blocks vs downloading attachments and writing files), and a rolling log of each node with its title.

```

- [ ] **Step 2: Update `site/src/pages/docs/index.astro`**

Find the "Workspace tree cache" section. Replace the existing paragraph with this expanded version:

```astro
    <h2>Workspace tree cache</h2>
    <p>The first time you open the picker, the tool walks every page and database your integration can see — for big workspaces this can take a minute. The result is cached at <code>&lt;output&gt;/.notion-2-obsidian-cache.json</code> so subsequent opens are instant.</p>
    <p>While the first walk is in progress, the UI shows live feedback: a running counter of nodes mapped so far, the current root being walked (e.g. "Mapeando 'Notas'"), and a per-root summary as each one finishes. Hit the <strong>↻ Refresh</strong> button in the picker header to re-walk the workspace whenever you've added or moved pages in Notion.</p>
    <p>During extraction, you'll see total counts (pages, items, databases), the current phase (rendering blocks vs downloading attachments and writing files), and a live log of each node by title.</p>
```

- [ ] **Step 3: Verify the Astro site still builds**

```bash
cd site && npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
cd /Users/andresimoes/Documents/Mecanizou/Lab/notion-extractor
git add README.md site/src/pages/docs/index.astro
git -c user.name="andresimoes" -c user.email="sou@oand.re" commit -m "docs: mention progressive discovery + extraction progress

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage check** (against `docs/superpowers/specs/2026-05-11-progressive-loader-design.md`):

- §4.1 (job-based `/api/tree` on miss) — Task 4.
- §4.2 (discovery events) — Tasks 1 (event kinds), 2 (emission).
- §4.3 (extraction events) — Tasks 1 (event kinds), 3 (emission).
- §4.4 (signature changes) — Tasks 2 + 3.
- §4.5 (frontend changes) — Tasks 5, 6, 7, 8.
- §4.6 (backwards compat) — Tasks 2 (optional bus), 4 (union return), 7 (UI handles both shapes).
- §5 (UI mockups) — implemented in Tasks 6 + 8.
- §6 (tests) — covered: counts.test (Task 1), discovery.test (Task 2), pipeline.test (Task 3), app.test (Task 4), DiscoveryProgress.test (Task 6), existing TreeView/ProgressView coverage retained.
- §7 (error handling) — Discovery error → bus emits `error` (Task 4), UI shows inline + close (Task 6). EventSource disconnect handled by `onerror` in the SSE listener (Task 6 — note: only an inline error, no auto-reconnect, matches spec).

**Placeholder scan:** No "TBD" or "TODO". Every step has concrete content.

**Type consistency:**
- `TreeResponse` is a discriminated union in Task 5; consumed in Task 7 via the `cached` field.
- `EventBus` is the same type across tasks 2, 3, 4.
- New `ProgressEventKind` values are added once in Task 1 and used in Tasks 2, 3, 4, 6, 8.
- `node_started` payload now includes `title` + `kind` (Tasks 3, 8 — `ProgressView` reads them).
- `phase_started` `name` values: `'render' | 'download_and_write'` consistent between Task 3 (emit) and Task 8 (PHASE_LABEL map).

**One known nuance documented inline:** in Task 4's test, after kicking off `/api/tree`, we wait for the background discovery to finish by polling `/api/extract` until it stops returning 412 — that's the cleanest cross-process signal without complicating the test with a real SSE listener. It's a small acceptable hack; the alternative (a real SSE consumer in vitest) is heavier and orthogonal to what we're verifying.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-11-progressive-loader.md`. Two execution options:

1. **Subagent-Driven (recommended for tasks 4, 6, 7, 8 — the integration-heavy ones)** — fresh subagent per task, full review on the high-leverage pieces.
2. **Inline Execution** — implement straight through.

Which approach?
