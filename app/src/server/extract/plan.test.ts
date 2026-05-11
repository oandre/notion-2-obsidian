import type { PlannedNode } from '@shared/types';
import { describe, expect, it } from 'vitest';
import { planPaths, slugify } from './plan.js';

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

describe('slugify', () => {
  it('keeps unicode', () => {
    expect(slugify('Notas de Reunião')).toBe('Notas de Reunião');
  });
  it('replaces forbidden chars with dashes', () => {
    expect(slugify('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
  });
  it('strips outer whitespace', () => {
    expect(slugify('  hello  ')).toBe('hello');
  });
  it('empty → untitled', () => {
    expect(slugify('')).toBe('untitled');
  });
});

describe('planPaths', () => {
  it('leaf page is a file', () => {
    const nodes = [node({ id: 'r', kind: 'page', title: 'Notas' })];
    const paths = planPaths(nodes, '/v');
    expect(paths.get('r')).toBe('/v/Notas.md');
  });

  it('page with children: folder + sibling .md', () => {
    const nodes = [
      node({ id: 'r', kind: 'page', title: 'Notas', childrenIds: ['c'] }),
      node({ id: 'c', kind: 'page', title: 'Sub', parentId: 'r' }),
    ];
    const paths = planPaths(nodes, '/v');
    expect(paths.get('r')).toBe('/v/Notas.md');
    expect(paths.get('c')).toBe('/v/Notas/Sub.md');
  });

  it('database is always folder + sibling index', () => {
    const nodes = [
      node({ id: 'db', kind: 'database', title: 'Tarefas', childrenIds: ['i1'] }),
      node({ id: 'i1', kind: 'db_item', title: 'Fazer X', parentId: 'db' }),
    ];
    const paths = planPaths(nodes, '/v');
    expect(paths.get('db')).toBe('/v/Tarefas.md');
    expect(paths.get('i1')).toBe('/v/Tarefas/Fazer X.md');
  });

  it('slug collisions get numeric suffix in id order', () => {
    const nodes = [
      node({ id: 'a', kind: 'page', title: 'Dup' }),
      node({ id: 'b', kind: 'page', title: 'Dup' }),
      node({ id: 'c', kind: 'page', title: 'Dup' }),
    ];
    const paths = planPaths(nodes, '/v');
    expect(paths.get('a')).toBe('/v/Dup.md');
    expect(paths.get('b')).toBe('/v/Dup (2).md');
    expect(paths.get('c')).toBe('/v/Dup (3).md');
  });

  it('deep nesting', () => {
    const nodes = [
      node({ id: 'A', kind: 'page', title: 'A', childrenIds: ['B'] }),
      node({ id: 'B', kind: 'page', title: 'B', parentId: 'A', childrenIds: ['C'] }),
      node({ id: 'C', kind: 'page', title: 'C', parentId: 'B' }),
    ];
    const paths = planPaths(nodes, '/v');
    expect(paths.get('A')).toBe('/v/A.md');
    expect(paths.get('B')).toBe('/v/A/B.md');
    expect(paths.get('C')).toBe('/v/A/B/C.md');
  });
});
