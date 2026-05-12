import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type CachedTree, invalidateCache, loadCache, saveCache } from './cache.js';

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
    expect(await loadCache(dir)).toBeNull();
  });

  it('loadCache returns the tree when file is valid', async () => {
    const dir = await tmp();
    await saveCache(dir, fixture());
    const got = await loadCache(dir);
    expect(got?.nodes[0]?.id).toBe('p1');
  });

  it('loadCache returns the tree even when workspaceId would have mismatched before', async () => {
    // workspaceId validation moved to discovery — caller decides what to do
    // with a stale workspace. loadCache no longer rejects on this basis.
    const dir = await tmp();
    await saveCache(dir, { ...fixture(), workspaceId: 'ws-different' });
    const got = await loadCache(dir);
    expect(got?.workspaceId).toBe('ws-different');
  });

  it('loadCache returns null when version mismatches', async () => {
    const dir = await tmp();
    await writeFile(
      join(dir, '.notion-2-obsidian-cache.json'),
      JSON.stringify({ ...fixture(), version: 99 }),
      'utf8',
    );
    expect(await loadCache(dir)).toBeNull();
  });

  it('loadCache returns null when JSON is malformed', async () => {
    const dir = await tmp();
    await writeFile(join(dir, '.notion-2-obsidian-cache.json'), '{ not json', 'utf8');
    expect(await loadCache(dir)).toBeNull();
  });

  it('invalidateCache removes the file (idempotent)', async () => {
    const dir = await tmp();
    await saveCache(dir, fixture());
    await invalidateCache(dir);
    expect(await loadCache(dir)).toBeNull();
    await invalidateCache(dir);
  });
});
