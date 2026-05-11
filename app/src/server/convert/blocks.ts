import { URL as NodeURL } from 'node:url';
import { richTextToMd } from './inline.js';

// biome-ignore lint/suspicious/noExplicitAny: blocks come from Notion JSON with dynamic schemas
type Block = Record<string, any>;
type Ctx = { indent: number };
type Handler = (block: Block, ctx: Ctx) => string;

const CALLOUT_EMOJI_MAP: Record<string, string> = {
  '💡': 'tip',
  '⚠️': 'warning',
  '❌': 'danger',
  '🚫': 'danger',
  ℹ️: 'info',
  '✅': 'success',
  '❓': 'question',
};

export function blocksToMd(blocks: Block[]): string {
  return renderBlocks(blocks, { indent: 0 });
}

function renderBlocks(blocks: Block[], ctx: Ctx): string {
  const out: string[] = [];
  let prevType: string | null = null;
  let counter = 0;

  for (const block of blocks) {
    const t: string = block.type ?? '';
    let line: string;

    if (t === 'numbered_list_item') {
      if (prevType !== 'numbered_list_item') counter = 0;
      counter++;
      line = renderNumbered(block, counter, ctx);
    } else {
      counter = 0;
      line = renderBlock(block, ctx);
    }

    if (line) {
      const sep = separator(prevType, t);
      if (sep && out.length) out.push(sep);
      out.push(line);
    }
    prevType = t;
  }
  return out.join('');
}

function separator(prev: string | null, current: string): string {
  const listTypes = new Set(['bulleted_list_item', 'numbered_list_item', 'to_do']);
  if (prev && listTypes.has(prev) && listTypes.has(current) && prev === current) return '';
  if (prev === null) return '';
  return '\n';
}

function renderBlock(block: Block, ctx: Ctx): string {
  const handler = HANDLERS[block.type];
  if (!handler) return `<!-- unsupported block: ${block.type} -->\n`;
  return handler(block, ctx);
}

function indentStr(ctx: Ctx) {
  return '  '.repeat(ctx.indent);
}

function renderChildren(block: Block, ctx: Ctx): string {
  const children = block.children ?? [];
  if (!children.length) return '';
  return renderBlocks(children, { indent: ctx.indent + 1 });
}

const paragraph: Handler = (block, ctx) => {
  const text = richTextToMd(block.paragraph.rich_text);
  return `${indentStr(ctx)}${text}\n${renderChildren(block, ctx)}`;
};

const heading =
  (level: 1 | 2 | 3): Handler =>
  (block, ctx) => {
    const key = `heading_${level}` as const;
    const text = richTextToMd(block[key].rich_text);
    return `${'#'.repeat(level)} ${text}\n${renderChildren(block, ctx)}`;
  };

const bulleted: Handler = (block, ctx) => {
  const text = richTextToMd(block.bulleted_list_item.rich_text);
  return `${indentStr(ctx)}- ${text}\n${renderChildren(block, ctx)}`;
};

function renderNumbered(block: Block, n: number, ctx: Ctx): string {
  const text = richTextToMd(block.numbered_list_item.rich_text);
  return `${indentStr(ctx)}${n}. ${text}\n${renderChildren(block, ctx)}`;
}

const todo: Handler = (block, ctx) => {
  const p = block.to_do;
  const text = richTextToMd(p.rich_text);
  const mark = p.checked ? 'x' : ' ';
  return `${indentStr(ctx)}- [${mark}] ${text}\n${renderChildren(block, ctx)}`;
};

const quote: Handler = (block, ctx) => {
  const text = richTextToMd(block.quote.rich_text);
  return `> ${text}\n${renderChildren(block, ctx)}`;
};

const divider: Handler = () => '---\n';

const code: Handler = (block) => {
  const p = block.code;
  const lang = p.language === 'plain text' ? '' : (p.language ?? '');
  const text = richTextToMd(p.rich_text);
  return `\`\`\`${lang}\n${text}\n\`\`\`\n`;
};

const callout: Handler = (block) => {
  const p = block.callout;
  const text = richTextToMd(p.rich_text);
  const icon = p.icon ?? {};
  const emoji = icon.type === 'emoji' ? icon.emoji : '';
  const type = CALLOUT_EMOJI_MAP[emoji] ?? 'note';
  const lines = [`> [!${type}]`, `> ${text}`];
  const children = block.children ?? [];
  if (children.length) {
    const childMd = renderBlocks(children, { indent: 0 }).replace(/\n+$/, '');
    lines.push('>');
    for (const line of childMd.split('\n')) {
      lines.push(line ? `> ${line}` : '>');
    }
  }
  return `${lines.join('\n')}\n`;
};

const toggle: Handler = (block, ctx) => {
  const summary = richTextToMd(block.toggle.rich_text);
  const childMd = renderChildren(block, ctx).replace(/^\s+|\s+$/g, '');
  const inner = childMd ? `\n${childMd}\n` : '';
  return `<details>\n<summary>${summary}</summary>\n${inner}\n</details>\n`;
};

// Tables
const tableBlock: Handler = (block) => {
  const table = block.table;
  const width: number = table.table_width ?? 0;
  const hasHeader: boolean = !!table.has_column_header;
  const rows: Block[] = block.children ?? [];
  const renderRow = (cells: unknown[]): string => {
    // biome-ignore lint/suspicious/noExplicitAny: cells come from Notion JSON
    const rendered = cells.map((c: any) => richTextToMd(c));
    const padded = [...rendered, ...Array(Math.max(0, width - rendered.length)).fill('')];
    return `| ${padded.join(' | ')} |\n`;
  };
  const out: string[] = [];
  let body: Block[] = rows;
  if (hasHeader && rows.length) {
    out.push(renderRow(rows[0]!.table_row.cells));
    out.push(`| ${Array(width).fill('---').join(' | ')} |\n`);
    body = rows.slice(1);
  } else {
    out.push(`| ${Array(width).fill('').join(' | ')} |\n`);
    out.push(`| ${Array(width).fill('---').join(' | ')} |\n`);
  }
  for (const r of body) out.push(renderRow(r.table_row.cells));
  return out.join('');
};

// Equation (block)
const equationBlock: Handler = (block) => `$$\n${block.equation.expression}\n$$\n`;

// Media helpers
function mediaUrlAndExternal(payload: Block): { url: string; external: boolean } {
  const kind = payload.type ?? 'file';
  const inner = payload[kind] ?? {};
  return { url: inner.url ?? '', external: kind === 'external' };
}

function assetTarget(url: string, external: boolean) {
  return external ? url : `{{notion-asset:${url}}}`;
}

function basename(url: string): string {
  try {
    const u = new NodeURL(url);
    const last = u.pathname.split('/').pop();
    return last || 'file';
  } catch {
    return url.split('/').pop() || 'file';
  }
}

const image: Handler = (block) => {
  const p = block.image;
  const { url, external } = mediaUrlAndExternal(p);
  const caption = richTextToMd(p.caption ?? []);
  return `![${caption}](${assetTarget(url, external)})\n`;
};

const fileLike =
  (field: string): Handler =>
  (block) => {
    const p = block[field];
    const { url, external } = mediaUrlAndExternal(p);
    const caption = richTextToMd(p.caption ?? []) || basename(url);
    return `[${caption}](${assetTarget(url, external)})\n`;
  };

// Embeds
const OBSIDIAN_EMBED_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'youtu.be',
  'twitter.com',
  'x.com',
  'vimeo.com',
  'loom.com',
  'www.loom.com',
  'figma.com',
  'www.figma.com',
]);

function isEmbeddable(url: string): boolean {
  try {
    return OBSIDIAN_EMBED_HOSTS.has(new NodeURL(url).hostname);
  } catch {
    return false;
  }
}

function displayUrl(url: string): string {
  try {
    const u = new NodeURL(url);
    if (u.pathname && u.pathname !== '/') return `${u.hostname}${u.pathname}`;
    return u.hostname || url;
  } catch {
    return url;
  }
}

const embedBlock =
  (field: string): Handler =>
  (block) => {
    const p = block[field];
    const url: string = p.url ?? '';
    const caption = richTextToMd(p.caption ?? []);
    if (isEmbeddable(url)) return `![${caption}](${url})\n`;
    const display = caption || displayUrl(url);
    return `[${display}](${url})\n`;
  };

// Links
const childPage: Handler = (block) => {
  const id = block.id ?? '';
  const title = block.child_page?.title ?? '';
  return `{{notion-link:${id}|${title}}}\n`;
};

const childDatabase: Handler = (block) => {
  const id = block.id ?? '';
  const title = block.child_database?.title ?? '';
  return `{{notion-link:${id}|${title}}}\n`;
};

const linkToPage: Handler = (block) => {
  const p = block.link_to_page;
  if (p.type === 'page_id') return `{{notion-link:${p.page_id}}}\n`;
  if (p.type === 'database_id') return `{{notion-link:${p.database_id}}}\n`;
  return '';
};

const HANDLERS: Record<string, Handler> = {
  paragraph,
  heading_1: heading(1),
  heading_2: heading(2),
  heading_3: heading(3),
  bulleted_list_item: bulleted,
  to_do: todo,
  quote,
  divider,
  code,
  callout,
  toggle,
  table: tableBlock,
  equation: equationBlock,
  image,
  pdf: fileLike('pdf'),
  file: fileLike('file'),
  video: fileLike('video'),
  audio: fileLike('audio'),
  bookmark: embedBlock('bookmark'),
  embed: embedBlock('embed'),
  link_preview: embedBlock('link_preview'),
  child_page: childPage,
  child_database: childDatabase,
  link_to_page: linkToPage,
};
