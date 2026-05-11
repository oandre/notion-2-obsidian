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
};
