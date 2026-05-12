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

export async function loadCache(outputDir: string): Promise<CachedTree | null> {
  let raw: string;
  try {
    raw = await readFile(join(outputDir, FILENAME), 'utf8');
  } catch {
    return null;
  }
  let parsed: CachedTree;
  try {
    parsed = JSON.parse(raw) as CachedTree;
  } catch {
    return null;
  }
  if (parsed.version !== CURRENT_VERSION) return null;
  if (!Array.isArray(parsed.nodes)) return null;
  return parsed;
}

export async function saveCache(outputDir: string, tree: CachedTree): Promise<void> {
  const payload: CachedTree = { ...tree, version: CURRENT_VERSION };
  await writeFile(join(outputDir, FILENAME), JSON.stringify(payload, null, 2), 'utf8');
}

export async function invalidateCache(outputDir: string): Promise<void> {
  try {
    await unlink(join(outputDir, FILENAME));
  } catch {
    // already absent — idempotent
  }
}
