type Annotations = {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
};

interface Segment {
  type?: string;
  plain_text?: string;
  href?: string | null;
  annotations?: Annotations;
  equation?: { expression: string };
  mention?: { type: string; page?: { id: string }; database?: { id: string } };
}

export function richTextToMd(segments: Segment[]): string {
  return segments.map(segmentToMd).join('');
}

function segmentToMd(seg: Segment): string {
  if (seg.type === 'equation' && seg.equation) return `$${seg.equation.expression}$`;
  if (seg.type === 'mention') return mentionToMd(seg);
  return textToMd(seg);
}

function textToMd(seg: Segment): string {
  const text = seg.plain_text ?? '';
  if (!text) return '';
  const a = seg.annotations ?? {};
  let out = text;
  if (a.code) out = `\`${out}\``;
  if (a.bold && a.italic) out = `***${out}***`;
  else if (a.bold) out = `**${out}**`;
  else if (a.italic) out = `*${out}*`;
  if (a.strikethrough) out = `~~${out}~~`;
  if (a.underline) out = `<u>${out}</u>`;
  if (seg.href) out = `[${out}](${seg.href})`;
  return out;
}

function mentionToMd(seg: Segment): string {
  const m = seg.mention;
  const plain = seg.plain_text ?? '';
  if (!m) return plain;
  if (m.type === 'page' && m.page) return `{{notion-link:${m.page.id}|${plain}}}`;
  if (m.type === 'database' && m.database) return `{{notion-link:${m.database.id}|${plain}}}`;
  return plain;
}
