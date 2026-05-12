import type { PlannedNode } from '@shared/types';
import { describe, expect, it } from 'vitest';
import { expandSelectionToDescendants } from './selection.js';

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

describe('expandSelectionToDescendants', () => {
  it('returns the input set when no descendants exist', () => {
    const tree = [node({ id: 'a' })];
    expect(expandSelectionToDescendants(new Set(['a']), tree)).toEqual(new Set(['a']));
  });

  it('includes direct children', () => {
    const tree = [
      node({ id: 'a', childrenIds: ['b', 'c'] }),
      node({ id: 'b', parentId: 'a' }),
      node({ id: 'c', parentId: 'a' }),
    ];
    expect(expandSelectionToDescendants(new Set(['a']), tree)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('includes grandchildren recursively', () => {
    const tree = [
      node({ id: 'a', childrenIds: ['b'] }),
      node({ id: 'b', parentId: 'a', childrenIds: ['c'] }),
      node({ id: 'c', parentId: 'b' }),
    ];
    expect(expandSelectionToDescendants(new Set(['a']), tree)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('union when multiple roots are selected', () => {
    const tree = [
      node({ id: 'a', childrenIds: ['b'] }),
      node({ id: 'b', parentId: 'a' }),
      node({ id: 'x' }),
    ];
    expect(expandSelectionToDescendants(new Set(['a', 'x']), tree)).toEqual(
      new Set(['a', 'b', 'x']),
    );
  });

  it('selecting only a leaf does not pull in ancestors', () => {
    const tree = [node({ id: 'a', childrenIds: ['b'] }), node({ id: 'b', parentId: 'a' })];
    expect(expandSelectionToDescendants(new Set(['b']), tree)).toEqual(new Set(['b']));
  });
});
