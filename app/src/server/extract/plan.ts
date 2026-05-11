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

  const hasSubtree = (n: PlannedNode): boolean => n.kind === 'database' || n.childrenIds.length > 0;

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
