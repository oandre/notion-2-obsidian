import { describe, expect, it } from 'vitest';
import { blocksToMd } from './blocks.js';

function rich(content: string) {
  return [
    {
      type: 'text',
      text: { content, link: null },
      plain_text: content,
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
  ];
}

// biome-ignore lint/suspicious/noExplicitAny: test fixtures intentionally loose
function block(type: string, payload: Record<string, unknown>, children: any[] = []) {
  return { type, [type]: payload, has_children: children.length > 0, children };
}

describe('blocks_to_md — basic', () => {
  it('paragraph', () => {
    expect(blocksToMd([block('paragraph', { rich_text: rich('hello') })])).toBe('hello\n');
  });

  it('headings 1/2/3', () => {
    const blocks = [
      block('heading_1', { rich_text: rich('A') }),
      block('heading_2', { rich_text: rich('B') }),
      block('heading_3', { rich_text: rich('C') }),
    ];
    expect(blocksToMd(blocks)).toBe('# A\n\n## B\n\n### C\n');
  });

  it('bulleted list', () => {
    const blocks = [
      block('bulleted_list_item', { rich_text: rich('one') }),
      block('bulleted_list_item', { rich_text: rich('two') }),
    ];
    expect(blocksToMd(blocks)).toBe('- one\n- two\n');
  });

  it('numbered list', () => {
    const blocks = [
      block('numbered_list_item', { rich_text: rich('one') }),
      block('numbered_list_item', { rich_text: rich('two') }),
    ];
    expect(blocksToMd(blocks)).toBe('1. one\n2. two\n');
  });

  it('numbered list resets after paragraph', () => {
    const blocks = [
      block('numbered_list_item', { rich_text: rich('one') }),
      block('paragraph', { rich_text: rich('p') }),
      block('numbered_list_item', { rich_text: rich('two') }),
    ];
    expect(blocksToMd(blocks)).toBe('1. one\n\np\n\n1. two\n');
  });

  it('to_do checked and unchecked', () => {
    const blocks = [
      block('to_do', { rich_text: rich('do it'), checked: false }),
      block('to_do', { rich_text: rich('done'), checked: true }),
    ];
    expect(blocksToMd(blocks)).toBe('- [ ] do it\n- [x] done\n');
  });

  it('quote', () => {
    expect(blocksToMd([block('quote', { rich_text: rich('wise words') })])).toBe('> wise words\n');
  });

  it('divider', () => {
    expect(blocksToMd([block('divider', {})])).toBe('---\n');
  });

  it('code block with language', () => {
    expect(blocksToMd([block('code', { rich_text: rich('print(1)'), language: 'python' })])).toBe(
      '```python\nprint(1)\n```\n',
    );
  });

  it('code block plain text strips language fence', () => {
    expect(blocksToMd([block('code', { rich_text: rich('x'), language: 'plain text' })])).toBe(
      '```\nx\n```\n',
    );
  });

  it('nested bulleted children are indented two spaces', () => {
    const child = block('bulleted_list_item', { rich_text: rich('child') });
    const parent = block('bulleted_list_item', { rich_text: rich('parent') }, [child]);
    expect(blocksToMd([parent])).toBe('- parent\n  - child\n');
  });
});
