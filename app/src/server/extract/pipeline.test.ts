import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlannedNode } from '@shared/types';
import { type Dispatcher, MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../progress.js';
import { runExtraction } from './pipeline.js';

let mock: MockAgent;
let previous: Dispatcher;
beforeEach(() => {
  previous = getGlobalDispatcher();
  mock = new MockAgent();
  mock.disableNetConnect();
  setGlobalDispatcher(mock);
});
afterEach(async () => {
  await mock.close();
  setGlobalDispatcher(previous);
});

async function tmp() {
  return mkdtemp(join(tmpdir(), 'pipe-'));
}

function makeNode(over: Partial<PlannedNode>): PlannedNode {
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

function paragraph(id: string, text: string) {
  return {
    id,
    type: 'paragraph',
    has_children: false,
    children: [],
    paragraph: {
      rich_text: [
        {
          type: 'text',
          text: { content: text, link: null },
          plain_text: text,
          href: null,
          annotations: {
            bold: false,
            italic: false,
            strikethrough: false,
            underline: false,
            code: false,
            color: 'default',
          },
        },
      ],
    },
  };
}

describe('runExtraction (tree-driven)', () => {
  it('writes md for a single selected page', async () => {
    const dir = await tmp();
    const tree: PlannedNode[] = [
      makeNode({
        id: 'p1',
        kind: 'page',
        title: 'Hello',
        blocks: [paragraph('b1', 'world')],
      }),
    ];

    const bus = new EventBus();
    const result = await runExtraction({
      bus,
      outputDir: dir,
      tree,
      selectedIds: ['p1'],
    });

    const md = await readFile(join(dir, 'Hello.md'), 'utf8');
    expect(md).toContain('world');
    expect(result.pagesExtracted).toBe(1);
  });

  it('selecting a parent pulls descendants in automatically', async () => {
    const dir = await tmp();
    const tree: PlannedNode[] = [
      makeNode({
        id: 'p1',
        kind: 'page',
        title: 'Alpha',
        childrenIds: ['cp'],
        blocks: [
          {
            id: 'cp',
            type: 'child_page',
            has_children: false,
            children: [],
            child_page: { title: 'Beta' },
          },
        ],
      }),
      makeNode({ id: 'cp', kind: 'page', title: 'Beta', parentId: 'p1' }),
    ];

    const bus = new EventBus();
    await runExtraction({
      bus,
      outputDir: dir,
      tree,
      selectedIds: ['p1'], // selecting Alpha implies Beta (cp)
    });

    const alpha = await readFile(join(dir, 'Alpha.md'), 'utf8');
    expect(alpha).toContain('[[Beta]]');
    const beta = await readFile(join(dir, 'Alpha', 'Beta.md'), 'utf8');
    expect(beta).toBeDefined();
  });

  it('selecting a leaf does NOT write the ancestor md (but folder exists)', async () => {
    const dir = await tmp();
    const tree: PlannedNode[] = [
      makeNode({ id: 'p1', kind: 'page', title: 'Alpha', childrenIds: ['p2'] }),
      makeNode({
        id: 'p2',
        kind: 'page',
        title: 'Beta',
        parentId: 'p1',
        blocks: [paragraph('b', 'deep content')],
      }),
    ];

    const bus = new EventBus();
    await runExtraction({
      bus,
      outputDir: dir,
      tree,
      selectedIds: ['p2'],
    });

    const beta = await readFile(join(dir, 'Alpha', 'Beta.md'), 'utf8');
    expect(beta).toContain('deep content');
    await expect(readFile(join(dir, 'Alpha.md'), 'utf8')).rejects.toThrow();
  });
});
