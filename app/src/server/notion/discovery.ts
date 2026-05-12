import type { LightNode, NodeKind, PlannedNode } from '@shared/types';
import { richTextToMd } from '../convert/inline.js';
import type { EventBus } from '../progress.js';
import type { NotionClient } from './client.js';
import { fetchBlockChildren, getDatabase, getPage, queryDatabase } from './fetch.js';

// biome-ignore lint/suspicious/noExplicitAny: Notion payloads are dynamic
type Block = Record<string, any>;

export async function listSharedRoots(client: NotionClient): Promise<PlannedNode[]> {
  const results: Block[] = [];
  let cursor: string | null = null;
  for (;;) {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const page = await client.post<{
      results: Block[];
      has_more: boolean;
      next_cursor: string | null;
    }>('/search', body);
    results.push(...(page.results ?? []));
    if (!page.has_more) break;
    cursor = page.next_cursor;
  }

  // /search returns EVERY page/database the integration can see, including
  // descendants of shared roots. Walking each as an independent root would
  // multiply work (and produce duplicate PlannedNodes for the same id).
  // Keep only items whose parent is the workspace OR whose parent is not
  // in the result set (case where the integration was shared directly with
  // a sub-page, not its ancestor).
  const resultIds = new Set(results.map((r) => r.id as string));
  const isRoot = (r: Block): boolean => {
    const parent = r.parent;
    if (!parent) return true;
    if (parent.type === 'workspace') return true;
    if (parent.type === 'page_id') return !resultIds.has(parent.page_id);
    if (parent.type === 'database_id') return !resultIds.has(parent.database_id);
    if (parent.type === 'block_id') return !resultIds.has(parent.block_id);
    return true;
  };

  const roots: PlannedNode[] = [];
  for (const r of results) {
    if (!isRoot(r)) continue;
    if (r.object === 'page') {
      roots.push(makeNode(r.id, 'page', pageTitle(r), null));
    } else if (r.object === 'database') {
      roots.push(makeNode(r.id, 'database', richTextToMd(r.title ?? []) || 'Untitled', null));
    }
  }
  return roots;
}

export async function discoverSubtree(
  client: NotionClient,
  rootId: string,
  rootKind: NodeKind,
  bus?: EventBus,
): Promise<PlannedNode[]> {
  const collected: PlannedNode[] = [];
  let root: PlannedNode;
  if (rootKind === 'page') {
    const page = await getPage(client, rootId);
    root = makeNode(rootId, 'page', pageTitle(page), null, page);
    await walkPage(client, root, collected, { bus, rootId });
  } else {
    const db = await getDatabase(client, rootId);
    root = makeNode(rootId, 'database', richTextToMd(db.title ?? []) || 'Untitled', null, db);
    await walkDatabase(client, root, collected, { bus, rootId });
  }
  return [root, ...collected];
}

export async function discoverWorkspace(
  client: NotionClient,
  bus?: EventBus,
  onRootCompleted?: (subtree: PlannedNode[]) => Promise<void> | void,
): Promise<PlannedNode[]> {
  if (bus) await bus.publish({ kind: 'roots_listing', data: {} });
  const roots = await listSharedRoots(client);
  if (bus) await bus.publish({ kind: 'roots_listed', data: { count: roots.length } });

  const out: PlannedNode[] = [];
  // Roots walk in parallel. NotionClient's p-limit(3) still throttles
  // the actual HTTP calls so we don't exceed Notion's rate limit; this
  // just keeps the semaphore saturated instead of one-root-at-a-time.
  await Promise.all(
    roots.map(async (root) => {
      if (bus) {
        await bus.publish({
          kind: 'root_started',
          data: { id: root.id, title: root.title, kind: root.kind },
        });
      }
      try {
        const subtree = await discoverSubtree(client, root.id, root.kind, bus);
        out.push(...subtree);
        if (onRootCompleted) await onRootCompleted(subtree);
        if (bus) {
          let pages = 0;
          let databases = 0;
          let dbItems = 0;
          for (const n of subtree) {
            if (n.kind === 'page') pages++;
            else if (n.kind === 'database') databases++;
            else if (n.kind === 'db_item') dbItems++;
          }
          const lightSubtree: LightNode[] = subtree.map((n) => ({
            id: n.id,
            kind: n.kind,
            title: n.title,
            parentId: n.parentId,
            childrenIds: n.childrenIds,
          }));
          await bus.publish({
            kind: 'root_completed',
            data: {
              id: root.id,
              title: root.title,
              pages,
              databases,
              dbItems,
              subtree: lightSubtree,
            },
          });
        }
      } catch (err) {
        // Skip this root, continue with others. Common cause: a shared
        // database the integration can't query (400 "does not contain
        // any data sources accessible by this API bot").
        const reason = err instanceof Error ? err.message : String(err);
        if (bus) {
          await bus.publish({
            kind: 'root_failed',
            data: { id: root.id, title: root.title, reason },
          });
        }
      }
    }),
  );

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

async function walkPage(
  client: NotionClient,
  node: PlannedNode,
  out: PlannedNode[],
  ctx: { bus: EventBus | undefined; rootId: string },
): Promise<void> {
  const blocks: Block[] = await fetchBlockChildren(client, node.id);
  // biome-ignore lint/suspicious/noExplicitAny: casting to shared NotionBlock shape
  node.blocks = blocks as any;

  // First pass (synchronous): create child nodes and append them to the
  // parent + the flat output. Preserves the order of node.childrenIds.
  const walks: Array<Promise<void>> = [];
  for (const block of blocks) {
    if (block.type === 'child_page') {
      const child = makeNode(
        block.id as string,
        'page',
        (block.child_page?.title as string) ?? 'Untitled',
        node.id,
      );
      node.childrenIds.push(child.id);
      out.push(child);
      walks.push(runChildWalk(child, () => walkPage(client, child, out, ctx), ctx, out));
    } else if (block.type === 'child_database') {
      const child = makeNode(
        block.id as string,
        'database',
        (block.child_database?.title as string) ?? 'Untitled',
        node.id,
      );
      node.childrenIds.push(child.id);
      out.push(child);
      walks.push(
        runChildWalk(
          child,
          // Inaccessible databases (e.g., new data-sources model) keep
          // the database node but skip their rows — don't fail the parent.
          () => walkDatabase(client, child, out, ctx).catch(() => undefined),
          ctx,
          out,
        ),
      );
    }
  }

  // Second pass (parallel): NotionClient's p-limit(3) keeps the actual
  // HTTP throughput in check; we just keep its queue saturated.
  await Promise.all(walks);
}

async function runChildWalk(
  child: PlannedNode,
  walk: () => Promise<void>,
  ctx: { bus: EventBus | undefined; rootId: string },
  out: PlannedNode[],
): Promise<void> {
  if (ctx.bus) {
    await ctx.bus.publish({
      kind: 'discovery_progress',
      data: { discovered: out.length, currentRoot: ctx.rootId, title: child.title },
    });
  }
  await walk();
}

async function walkDatabase(
  client: NotionClient,
  node: PlannedNode,
  out: PlannedNode[],
  ctx: { bus: EventBus | undefined; rootId: string },
): Promise<void> {
  const items = await queryDatabase(client, node.id);
  const walks: Array<Promise<void>> = [];
  for (const item of items) {
    const itemNode = makeNode(item.id as string, 'db_item', pageTitle(item), node.id, item);
    node.childrenIds.push(itemNode.id);
    out.push(itemNode);
    walks.push(runChildWalk(itemNode, () => walkPage(client, itemNode, out, ctx), ctx, out));
  }
  await Promise.all(walks);
}

function makeNode(
  id: string,
  kind: NodeKind,
  title: string,
  parentId: string | null,
  pageData: Block = {},
): PlannedNode {
  return { id, kind, title, parentId, childrenIds: [], blocks: [], pageData };
}

function pageTitle(page: Block): string {
  const props = (page.properties ?? {}) as Record<string, Block>;
  for (const prop of Object.values(props)) {
    if (prop.type === 'title') return richTextToMd(prop.title ?? []) || 'Untitled';
  }
  return 'Untitled';
}
