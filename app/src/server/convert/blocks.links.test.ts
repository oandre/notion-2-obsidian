import { describe, expect, it } from 'vitest';
import { blocksToMd } from './blocks.js';

describe('link blocks', () => {
  it('child_page emits notion-link placeholder with title', () => {
    const block = {
      type: 'child_page',
      id: 'abc-123',
      child_page: { title: 'Some Page' },
      has_children: false,
      children: [],
    };
    expect(blocksToMd([block])).toBe('{{notion-link:abc-123|Some Page}}\n');
  });

  it('child_database emits notion-link placeholder with title', () => {
    const block = {
      type: 'child_database',
      id: 'db-456',
      child_database: { title: 'Tasks' },
      has_children: false,
      children: [],
    };
    expect(blocksToMd([block])).toBe('{{notion-link:db-456|Tasks}}\n');
  });

  it('link_to_page (page_id) emits notion-link placeholder', () => {
    const block = {
      type: 'link_to_page',
      link_to_page: { type: 'page_id', page_id: 'p-1' },
      has_children: false,
      children: [],
    };
    expect(blocksToMd([block])).toBe('{{notion-link:p-1}}\n');
  });

  it('link_to_page (database_id) emits notion-link placeholder', () => {
    const block = {
      type: 'link_to_page',
      link_to_page: { type: 'database_id', database_id: 'd-1' },
      has_children: false,
      children: [],
    };
    expect(blocksToMd([block])).toBe('{{notion-link:d-1}}\n');
  });
});
