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

describe('callouts and toggles', () => {
  it('callout default note when emoji is unknown', () => {
    expect(
      blocksToMd([
        block('callout', {
          rich_text: rich('heads up'),
          icon: { type: 'emoji', emoji: '🗒️' },
        }),
      ]),
    ).toBe('> [!note]\n> heads up\n');
  });

  it('callout tip from 💡', () => {
    expect(
      blocksToMd([
        block('callout', { rich_text: rich('nice'), icon: { type: 'emoji', emoji: '💡' } }),
      ]),
    ).toBe('> [!tip]\n> nice\n');
  });

  it('callout warning from ⚠️', () => {
    expect(
      blocksToMd([
        block('callout', { rich_text: rich('careful'), icon: { type: 'emoji', emoji: '⚠️' } }),
      ]),
    ).toBe('> [!warning]\n> careful\n');
  });

  it('callout danger from ❌', () => {
    expect(
      blocksToMd([
        block('callout', { rich_text: rich('nope'), icon: { type: 'emoji', emoji: '❌' } }),
      ]),
    ).toBe('> [!danger]\n> nope\n');
  });

  it('callout info from ℹ️', () => {
    expect(
      blocksToMd([
        block('callout', { rich_text: rich('fyi'), icon: { type: 'emoji', emoji: 'ℹ️' } }),
      ]),
    ).toBe('> [!info]\n> fyi\n');
  });

  it('callout with multi-line children', () => {
    const child = block('paragraph', { rich_text: rich('extra') });
    const b = block('callout', { rich_text: rich('main'), icon: { type: 'emoji', emoji: '💡' } }, [
      child,
    ]);
    expect(blocksToMd([b])).toBe('> [!tip]\n> main\n>\n> extra\n');
  });

  it('toggle collapsible with content', () => {
    const child = block('paragraph', { rich_text: rich('hidden') });
    const b = block('toggle', { rich_text: rich('Click me') }, [child]);
    expect(blocksToMd([b])).toBe(
      '<details>\n<summary>Click me</summary>\n\nhidden\n\n</details>\n',
    );
  });

  it('toggle empty', () => {
    const b = block('toggle', { rich_text: rich('Click me') });
    expect(blocksToMd([b])).toBe('<details>\n<summary>Click me</summary>\n\n</details>\n');
  });
});
