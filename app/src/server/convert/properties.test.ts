import { describe, expect, it } from 'vitest';
import { propertiesToFrontmatter } from './properties.js';

function richTitle(text: string) {
  return {
    type: 'title',
    title: [
      {
        type: 'text',
        plain_text: text,
        text: { content: text, link: null },
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
  };
}

function richText(text: string) {
  return {
    type: 'rich_text',
    rich_text: [
      {
        type: 'text',
        plain_text: text,
        text: { content: text, link: null },
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
  };
}

describe('propertiesToFrontmatter', () => {
  it('title', () => {
    expect(propertiesToFrontmatter({ Name: richTitle('Fazer X') })).toEqual({ Name: 'Fazer X' });
  });

  it('rich_text', () => {
    expect(propertiesToFrontmatter({ Notes: richText('some note') })).toEqual({
      Notes: 'some note',
    });
  });

  it('number', () => {
    expect(propertiesToFrontmatter({ Score: { type: 'number', number: 42 } })).toEqual({
      Score: 42,
    });
  });

  it('select with value', () => {
    expect(
      propertiesToFrontmatter({
        Status: { type: 'select', select: { name: 'Done', color: 'green', id: 'x' } },
      }),
    ).toEqual({ Status: 'Done' });
  });

  it('select empty', () => {
    expect(propertiesToFrontmatter({ Status: { type: 'select', select: null } })).toEqual({
      Status: null,
    });
  });

  it('multi_select', () => {
    expect(
      propertiesToFrontmatter({
        Tags: {
          type: 'multi_select',
          multi_select: [
            { name: 'a', color: 'blue', id: '1' },
            { name: 'b', color: 'red', id: '2' },
          ],
        },
      }),
    ).toEqual({ Tags: ['a', 'b'] });
  });

  it('status', () => {
    expect(
      propertiesToFrontmatter({
        State: { type: 'status', status: { name: 'Doing', color: 'blue', id: 'x' } },
      }),
    ).toEqual({ State: 'Doing' });
  });

  it('date simple', () => {
    expect(
      propertiesToFrontmatter({
        Due: { type: 'date', date: { start: '2026-05-20', end: null, time_zone: null } },
      }),
    ).toEqual({ Due: '2026-05-20' });
  });

  it('date range with end', () => {
    expect(
      propertiesToFrontmatter({
        Due: {
          type: 'date',
          date: { start: '2026-05-20', end: '2026-05-21', time_zone: null },
        },
      }),
    ).toEqual({ Due: '2026-05-20/2026-05-21' });
  });

  it('checkbox', () => {
    expect(propertiesToFrontmatter({ Done: { type: 'checkbox', checkbox: true } })).toEqual({
      Done: true,
    });
  });

  it('url', () => {
    expect(propertiesToFrontmatter({ Site: { type: 'url', url: 'https://x.dev' } })).toEqual({
      Site: 'https://x.dev',
    });
  });

  it('email + phone_number', () => {
    expect(
      propertiesToFrontmatter({
        Email: { type: 'email', email: 'a@b.c' },
        Phone: { type: 'phone_number', phone_number: '+55' },
      }),
    ).toEqual({ Email: 'a@b.c', Phone: '+55' });
  });

  it('people uses names, drops anonymous', () => {
    expect(
      propertiesToFrontmatter({
        Owner: {
          type: 'people',
          people: [
            { name: 'Ana', id: 'u1', object: 'user' },
            { name: 'Bia', id: 'u2', object: 'user' },
          ],
        },
      }),
    ).toEqual({ Owner: ['Ana', 'Bia'] });
  });

  it('files mix of internal and external', () => {
    expect(
      propertiesToFrontmatter({
        Files: {
          type: 'files',
          files: [
            { name: 'x.pdf', type: 'file', file: { url: 'https://s3/x.pdf' } },
            { name: 'y.png', type: 'external', external: { url: 'https://ex/y.png' } },
          ],
        },
      }),
    ).toEqual({ Files: ['{{notion-asset:https://s3/x.pdf}}', 'https://ex/y.png'] });
  });

  it('relation emits notion-link placeholders', () => {
    expect(
      propertiesToFrontmatter({
        Rel: { type: 'relation', relation: [{ id: 'abc' }, { id: 'def' }] },
      }),
    ).toEqual({ Rel: ['{{notion-link:abc}}', '{{notion-link:def}}'] });
  });

  it('formula number', () => {
    expect(
      propertiesToFrontmatter({
        X: { type: 'formula', formula: { type: 'number', number: 3.14 } },
      }),
    ).toEqual({ X: 3.14 });
  });

  it('formula string', () => {
    expect(
      propertiesToFrontmatter({
        X: { type: 'formula', formula: { type: 'string', string: 'hi' } },
      }),
    ).toEqual({ X: 'hi' });
  });

  it('created_time pass-through', () => {
    expect(
      propertiesToFrontmatter({
        Created: { type: 'created_time', created_time: '2026-01-01T00:00:00.000Z' },
      }),
    ).toEqual({ Created: '2026-01-01T00:00:00.000Z' });
  });
});
