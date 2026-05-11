import { describe, expect, it } from 'vitest';
import { richTextToMd } from './inline.js';

function seg(
  text: string,
  opts: Partial<{
    bold: boolean;
    italic: boolean;
    code: boolean;
    strikethrough: boolean;
    underline: boolean;
    href: string | null;
  }> = {},
) {
  return {
    type: 'text',
    text: { content: text, link: opts.href ? { url: opts.href } : null },
    plain_text: text,
    href: opts.href ?? null,
    annotations: {
      bold: !!opts.bold,
      italic: !!opts.italic,
      strikethrough: !!opts.strikethrough,
      underline: !!opts.underline,
      code: !!opts.code,
      color: 'default',
    },
  };
}

describe('richTextToMd', () => {
  it('plain text', () => expect(richTextToMd([seg('hello')])).toBe('hello'));
  it('bold', () => expect(richTextToMd([seg('hi', { bold: true })])).toBe('**hi**'));
  it('italic', () => expect(richTextToMd([seg('hi', { italic: true })])).toBe('*hi*'));
  it('bold + italic', () =>
    expect(richTextToMd([seg('hi', { bold: true, italic: true })])).toBe('***hi***'));
  it('strikethrough', () =>
    expect(richTextToMd([seg('hi', { strikethrough: true })])).toBe('~~hi~~'));
  it('underline uses <u>', () =>
    expect(richTextToMd([seg('hi', { underline: true })])).toBe('<u>hi</u>'));
  it('inline code', () => expect(richTextToMd([seg('x', { code: true })])).toBe('`x`'));
  it('link', () =>
    expect(richTextToMd([seg('docs', { href: 'https://x.dev' })])).toBe('[docs](https://x.dev)'));
  it('link with bold', () =>
    expect(richTextToMd([seg('docs', { bold: true, href: 'https://x.dev' })])).toBe(
      '[**docs**](https://x.dev)',
    ));
  it('concatenates segments', () =>
    expect(richTextToMd([seg('hello '), seg('world', { bold: true })])).toBe('hello **world**'));
  it('empty', () => expect(richTextToMd([])).toBe(''));

  it('mention page emits placeholder', () => {
    const mention = {
      type: 'mention',
      mention: { type: 'page', page: { id: 'abc-123' } },
      plain_text: 'Some Page',
      href: 'https://www.notion.so/abc123',
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: 'default',
      },
    };
    expect(richTextToMd([mention])).toBe('{{notion-link:abc-123|Some Page}}');
  });

  it('mention date prints plain text', () => {
    const mention = {
      type: 'mention',
      mention: { type: 'date', date: { start: '2026-05-11' } },
      plain_text: '2026-05-11',
      href: null,
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: 'default',
      },
    };
    expect(richTextToMd([mention])).toBe('2026-05-11');
  });

  it('inline equation', () => {
    const eq = {
      type: 'equation',
      equation: { expression: 'x^2' },
      plain_text: 'x^2',
      href: null,
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: 'default',
      },
    };
    expect(richTextToMd([eq])).toBe('$x^2$');
  });
});
