import type { PlannedNode } from '@shared/types';
import { describe, expect, it } from 'vitest';
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
