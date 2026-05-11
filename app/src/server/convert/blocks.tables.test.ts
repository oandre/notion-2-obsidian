import { describe, expect, it } from 'vitest';
import { blocksToMd } from './blocks.js';

function cell(text: string) {
  return [
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
  ];
}

function row(cells: ReturnType<typeof cell>[]) {
  return {
    type: 'table_row',
    table_row: { cells },
    has_children: false,
    children: [],
  };
}

describe('table block', () => {
  it('table with column header', () => {
    const rows = [
      row([cell('Name'), cell('Age')]),
      row([cell('Ana'), cell('30')]),
      row([cell('Bia'), cell('25')]),
    ];
    const table = {
      type: 'table',
      table: { table_width: 2, has_column_header: true, has_row_header: false },
      has_children: true,
      children: rows,
    };
    expect(blocksToMd([table])).toBe('| Name | Age |\n| --- | --- |\n| Ana | 30 |\n| Bia | 25 |\n');
  });

  it('table without header synthesizes a blank header row', () => {
    const rows = [row([cell('a'), cell('b')]), row([cell('c'), cell('d')])];
    const table = {
      type: 'table',
      table: { table_width: 2, has_column_header: false, has_row_header: false },
      has_children: true,
      children: rows,
    };
    expect(blocksToMd([table])).toBe('|  |  |\n| --- | --- |\n| a | b |\n| c | d |\n');
  });
});
