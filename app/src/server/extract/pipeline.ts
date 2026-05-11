import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PlannedNode } from '@shared/types';
import { stringify as yamlStringify } from 'yaml';
import { blocksToMd } from '../convert/blocks.js';
import { propertiesToFrontmatter } from '../convert/properties.js';
import type { NotionClient } from '../notion/client.js';
import type { EventBus } from '../progress.js';
import { AttachmentDownloader } from './attachments.js';
import { planPaths } from './plan.js';
import { type BrokenLink, type LinkContext, renderReport, resolvePlaceholders } from './resolve.js';
import { expandSelectionToDescendants } from './selection.js';

const ASSET_PLACEHOLDER = /\{\{notion-asset:([^}]+)\}\}/g;

export interface ExtractionResult {
  pagesExtracted: number;
  itemsExtracted: number;
  attachmentsDownloaded: number;
  totalBytes: number;
  durationS: number;
  brokenLinks: BrokenLink[];
  failures: Array<{ id: string; reason: string }>;
  warnings: string[];
}

export interface RunExtractionOpts {
  client: NotionClient;
  bus: EventBus;
  outputDir: string;
  tree: PlannedNode[];
  selectedIds: string[];
}

export async function runExtraction(opts: RunExtractionOpts): Promise<ExtractionResult> {
  const { client, bus, outputDir, tree, selectedIds } = opts;
  void client; // reserved for future asset auth needs
  const startedAt = Date.now();
  await mkdir(outputDir, { recursive: true });
  const downloader = new AttachmentDownloader(join(outputDir, 'assets'));
  const result: ExtractionResult = {
    pagesExtracted: 0,
    itemsExtracted: 0,
    attachmentsDownloaded: 0,
    totalBytes: 0,
    durationS: 0,
    brokenLinks: [],
    failures: [],
    warnings: [],
  };

  const effective = expandSelectionToDescendants(new Set(selectedIds), tree);
  const idToNode = new Map(tree.map((n) => [n.id, n]));
  const paths = planPaths(tree, outputDir);

  try {
    const rendered = new Map<string, string>();
    for (const node of tree) {
      if (!effective.has(node.id)) continue;
      await bus.publish({
        kind: 'node_started',
        data: { id: node.id, title: node.title },
      });
      try {
        rendered.set(node.id, await renderNode(node, idToNode));
        if (node.kind === 'page') result.pagesExtracted++;
        else if (node.kind === 'db_item') result.itemsExtracted++;
        await bus.publish({ kind: 'node_done', data: { id: node.id } });
      } catch (exc) {
        const reason = exc instanceof Error ? exc.message : String(exc);
        result.failures.push({ id: node.id, reason });
        await bus.publish({
          kind: 'node_failed',
          data: { id: node.id, reason },
        });
      }
    }

    for (const node of tree) {
      const md = rendered.get(node.id);
      if (md === undefined) continue;
      const urlToLocal = await downloadAssets(md, downloader, bus);
      result.attachmentsDownloaded += urlToLocal.size;
      for (const local of urlToLocal.values()) {
        try {
          result.totalBytes += (await stat(local)).size;
        } catch {
          // stat errors are non-fatal
        }
      }
      const fromFile = paths.get(node.id);
      if (!fromFile) continue;
      const ctx: LinkContext = {
        fromFile,
        idToPath: paths,
        urlToLocal,
        vaultRoot: outputDir,
      };
      const { md: resolved, broken } = resolvePlaceholders(md, ctx);
      result.brokenLinks.push(...broken);
      await mkdir(dirname(fromFile), { recursive: true });
      await writeFile(fromFile, resolved, 'utf8');
    }

    result.durationS = (Date.now() - startedAt) / 1000;
    const report = renderReport({
      vaultRoot: outputDir,
      pagesExtracted: result.pagesExtracted,
      itemsExtracted: result.itemsExtracted,
      attachmentsDownloaded: result.attachmentsDownloaded,
      totalBytes: result.totalBytes,
      durationS: result.durationS,
      brokenLinks: result.brokenLinks,
      failures: result.failures,
      warnings: result.warnings,
    });
    await writeFile(join(outputDir, '_report.md'), report, 'utf8');
    await bus.publish({
      kind: 'extraction_done',
      data: {
        pages: result.pagesExtracted,
        items: result.itemsExtracted,
        attachments: result.attachmentsDownloaded,
      },
    });
    return result;
  } finally {
    await downloader.close();
  }
}

async function renderNode(node: PlannedNode, idToNode: Map<string, PlannedNode>): Promise<string> {
  if (node.kind === 'page') return blocksToMd(node.blocks);
  if (node.kind === 'db_item') {
    const page = node.pageData as Record<string, unknown> & {
      properties?: Record<string, unknown>;
      url?: string;
      created_time?: string;
      last_edited_time?: string;
    };
    const fm: Record<string, unknown> = propertiesToFrontmatter(
      (page.properties ?? {}) as Record<string, Record<string, unknown>>,
    );
    fm.notion_id = node.id;
    fm.notion_url = page.url ?? '';
    fm.created_time = page.created_time ?? '';
    fm.last_edited_time = page.last_edited_time ?? '';
    const body = blocksToMd(node.blocks);
    return `---\n${yamlStringify(fm).trimEnd()}\n---\n\n${body}`;
  }
  if (node.kind === 'database') return renderDatabaseIndex(node, idToNode);
  return '';
}

function renderDatabaseIndex(node: PlannedNode, idToNode: Map<string, PlannedNode>): string {
  const rows = node.childrenIds.map((id) => idToNode.get(id)).filter((n): n is PlannedNode => !!n);
  if (!rows.length) return `# ${node.title}\n`;
  const lines = [`# ${node.title}`, '', '| Item |', '| --- |'];
  for (const row of rows) {
    lines.push(`| {{notion-link:${row.id}|${row.title}}} |`);
  }
  return `${lines.join('\n')}\n`;
}

async function downloadAssets(
  md: string,
  dl: AttachmentDownloader,
  bus: EventBus,
): Promise<Map<string, string>> {
  const urls = new Set<string>();
  for (const m of md.matchAll(ASSET_PLACEHOLDER)) {
    if (m[1]) urls.add(m[1]);
  }
  const urlToLocal = new Map<string, string>();
  for (const url of urls) {
    try {
      const local = await dl.download(url);
      urlToLocal.set(url, local);
      await bus.publish({
        kind: 'attachment_downloaded',
        data: { url, path: local },
      });
    } catch {
      // swallow per-asset failures
    }
  }
  return urlToLocal;
}
