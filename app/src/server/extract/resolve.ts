import { posix as path } from 'node:path';

const LINK_RE = /\{\{notion-link:([^|}]+)(?:\|([^}]+))?\}\}/g;
const ASSET_RE = /\{\{notion-asset:([^}]+)\}\}/g;

export interface BrokenLink {
  id: string;
  label: string | null;
  fromFile: string;
}

export interface LinkContext {
  fromFile: string;
  idToPath: Map<string, string>;
  urlToLocal: Map<string, string>;
  vaultRoot: string;
}

export function resolvePlaceholders(
  md: string,
  ctx: LinkContext,
): { md: string; broken: BrokenLink[] } {
  const broken: BrokenLink[] = [];
  let out = md.replace(LINK_RE, (_match, id: string, label: string | undefined) => {
    const targetPath = ctx.idToPath.get(id);
    if (targetPath !== undefined) {
      const pageName = path.basename(targetPath, '.md');
      return `[[${pageName}]]`;
    }
    broken.push({ id, label: label ?? null, fromFile: ctx.fromFile });
    return label ?? '(link removed)';
  });
  out = out.replace(ASSET_RE, (_match, url: string) => {
    const local = ctx.urlToLocal.get(url);
    if (!local) return url;
    const rel = path.relative(path.dirname(ctx.fromFile), local);
    return rel;
  });
  return { md: out, broken };
}

export interface ReportInput {
  vaultRoot: string;
  pagesExtracted: number;
  itemsExtracted: number;
  attachmentsDownloaded: number;
  totalBytes: number;
  durationS: number;
  brokenLinks: BrokenLink[];
  failures: Array<{ id: string; reason: string }>;
  warnings: string[];
}

export function renderReport(input: ReportInput): string {
  const mb = input.totalBytes / (1024 * 1024);
  const lines: string[] = [
    '# Relatório de extração',
    '',
    `- Páginas extraídas: ${input.pagesExtracted}`,
    `- Itens de database extraídos: ${input.itemsExtracted}`,
    `- Anexos baixados: ${input.attachmentsDownloaded} (${mb.toFixed(1)} MB)`,
    `- Duração: ${input.durationS.toFixed(1)}s`,
    '',
  ];
  if (input.brokenLinks.length) {
    lines.push(`## Links para fora da seleção (${input.brokenLinks.length})`);
    for (const b of input.brokenLinks) {
      const rel = path.relative(input.vaultRoot, b.fromFile);
      const labelPart = b.label ? ` — ${b.label}` : '';
      lines.push(`- \`${b.id}\`${labelPart} (em [${rel}](${rel}))`);
    }
    lines.push('');
  }
  if (input.failures.length) {
    lines.push(`## Falhas (${input.failures.length})`);
    for (const f of input.failures) lines.push(`- \`${f.id}\`: ${f.reason}`);
    lines.push('');
  }
  if (input.warnings.length) {
    lines.push(`## Avisos (${input.warnings.length})`);
    for (const w of input.warnings) lines.push(`- ${w}`);
    lines.push('');
  }
  return lines.join('\n');
}
