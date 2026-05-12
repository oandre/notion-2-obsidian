import type { NodeKind, PlannedNode } from '@shared/types';
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

async function walkPage(
  client: NotionClient,
  node: PlannedNode,
  out: PlannedNode[],
  ctx: { bus: EventBus | undefined; rootId: string },
): Promise<void> {
  const blocks: Block[] = await fetchBlockChildren(client, node.id);
  // biome-ignore lint/suspicious/noExplicitAny: casting to shared NotionBlock shape
  node.blocks = blocks as any;
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
      if (ctx.bus) {
        await ctx.bus.publish({
          kind: 'discovery_progress',
          data: { discovered: out.length, currentRoot: ctx.rootId, title: child.title },
        });
      }
      await walkPage(client, child, out, ctx);
    } else if (block.type === 'child_database') {
      const child = makeNode(
        block.id as string,
        'database',
        (block.child_database?.title as string) ?? 'Untitled',
        node.id,
      );
      node.childrenIds.push(child.id);
      out.push(child);
      if (ctx.bus) {
        await ctx.bus.publish({
          kind: 'discovery_progress',
          data: { discovered: out.length, currentRoot: ctx.rootId, title: child.title },
        });
      }
      await walkDatabase(client, child, out, ctx);
    }
  }
}

async function walkDatabase(
  client: NotionClient,
  node: PlannedNode,
  out: PlannedNode[],
  ctx: { bus: EventBus | undefined; rootId: string },
): Promise<void> {
  const items = await queryDatabase(client, node.id);
  for (const item of items) {
    const itemNode = makeNode(item.id as string, 'db_item', pageTitle(item), node.id, item);
    node.childrenIds.push(itemNode.id);
    out.push(itemNode);
    if (ctx.bus) {
      await ctx.bus.publish({
        kind: 'discovery_progress',
        data: { discovered: out.length, currentRoot: ctx.rootId, title: itemNode.title },
      });
    }
    await walkPage(client, itemNode, out, ctx);
  }
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
