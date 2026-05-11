import type { NotionClient } from './client.js';

// biome-ignore lint/suspicious/noExplicitAny: Notion blocks are dynamic JSON
type Block = Record<string, any>;

export async function fetchBlockChildren(client: NotionClient, blockId: string): Promise<Block[]> {
  const blocks = await paginateGet(client, `/blocks/${blockId}/children`);
  await Promise.all(
    blocks.map(async (b: Block) => {
      b.children ??= [];
      if (b.has_children && b.type !== 'child_page' && b.type !== 'child_database') {
        b.children = await fetchBlockChildren(client, b.id);
      }
    }),
  );
  return blocks;
}

export async function queryDatabase(client: NotionClient, databaseId: string): Promise<Block[]> {
  return paginatePost(client, `/databases/${databaseId}/query`, {});
}

export async function getPage(client: NotionClient, pageId: string): Promise<Block> {
  return client.get(`/pages/${pageId}`);
}

export async function getDatabase(client: NotionClient, databaseId: string): Promise<Block> {
  return client.get(`/databases/${databaseId}`);
}

interface NotionPage {
  results: Block[];
  has_more: boolean;
  next_cursor: string | null;
}

async function paginateGet(client: NotionClient, basePath: string): Promise<Block[]> {
  const results: Block[] = [];
  let cursor: string | null = null;
  for (;;) {
    const qs: string = `?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const page: NotionPage = await client.get<NotionPage>(basePath + qs);
    results.push(...(page.results ?? []));
    if (!page.has_more) return results;
    cursor = page.next_cursor;
  }
}

async function paginatePost(
  client: NotionClient,
  reqPath: string,
  body: Record<string, unknown>,
): Promise<Block[]> {
  const results: Block[] = [];
  let cursor: string | null = null;
  for (;;) {
    const pageBody: Record<string, unknown> = { ...body, page_size: 100 };
    if (cursor) pageBody.start_cursor = cursor;
    const page: NotionPage = await client.post<NotionPage>(reqPath, pageBody);
    results.push(...(page.results ?? []));
    if (!page.has_more) return results;
    cursor = page.next_cursor;
  }
}
