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
