import type { PlannedNode } from '@shared/types';

export function expandSelectionToDescendants(
  selected: Set<string>,
  tree: PlannedNode[],
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
