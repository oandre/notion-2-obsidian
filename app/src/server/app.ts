import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { PlannedNode } from '@shared/types';
import Fastify, { type FastifyInstance } from 'fastify';
import { type CachedTree, invalidateCache, loadCache, saveCache } from './cache.js';
import { loadSettings, writeSettings } from './config.js';
import { runExtraction } from './extract/pipeline.js';
import { NotionClient } from './notion/client.js';
import { discoverWorkspace, listSharedRoots } from './notion/discovery.js';
import { EventBus, eventToSse } from './progress.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface BuildAppOpts {
  cwd: string;
}

export async function buildApp(opts: BuildAppOpts): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  const jobs = new Map<string, EventBus>();
  let latestTree: PlannedNode[] | null = null;

  const staticDir = resolveStaticDir();
  if (staticDir) {
    await fastify.register(fastifyStatic, {
      root: staticDir,
      prefix: '/',
      index: ['index.html'],
    });
    fastify.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  fastify.get('/api/status', async () => {
    const settings = await loadSettings(opts.cwd);
    return {
      tokenConfigured: !!settings.notionToken,
      outputDir: settings.outputDir,
    };
  });

  fastify.post<{ Body: { notionToken: string; outputDir: string } }>(
    '/api/setup',
    async (req, reply) => {
      const { notionToken, outputDir } = req.body;
      if (!notionToken || !outputDir) {
        return reply.code(400).send({ error: 'notionToken and outputDir are required' });
      }
      await writeSettings(opts.cwd, { notionToken, outputDir });
      latestTree = null;
      return reply.code(204).send();
    },
  );

  fastify.get<{ Querystring: { refresh?: string } }>('/api/tree', async (req, reply) => {
    const settings = await loadSettings(opts.cwd);
    if (!settings.notionToken || !settings.outputDir) {
      return reply.code(412).send({ error: 'not configured' });
    }
    const refresh = req.query.refresh === 'true';
    const client = new NotionClient({ token: settings.notionToken });

    const roots = await listSharedRoots(client);
    const workspaceId = pickWorkspaceId(roots);

    if (!refresh) {
      const cached = await loadCache(settings.outputDir, workspaceId);
      if (cached) {
        latestTree = cached.nodes;
        return {
          nodes: cached.nodes,
          discoveredAt: cached.discoveredAt,
          cached: true,
        };
      }
    } else {
      await invalidateCache(settings.outputDir);
    }

    // Cache miss → background discovery + SSE job
    const bus = new EventBus();
    const jobId = randomUUID();
    jobs.set(jobId, bus);

    const outputDir = settings.outputDir;
    void (async () => {
      await bus.publish({ kind: 'discovery_started', data: {} });
      try {
        const nodes = await discoverWorkspace(client, bus);
        const discoveredAt = new Date().toISOString();
        const tree: CachedTree = {
          version: 1,
          workspaceId,
          discoveredAt,
          nodes,
        };
        try {
          await saveCache(outputDir, tree);
        } catch {
          // non-fatal
        }
        latestTree = nodes;
        await bus.publish({
          kind: 'tree_ready',
          data: { nodes, discoveredAt },
        });
      } catch (err) {
        await bus.publish({
          kind: 'error',
          data: { message: err instanceof Error ? err.message : String(err) },
        });
      }
    })();

    return { job_id: jobId, cached: false };
  });

  fastify.post<{ Body: { selectedIds: string[] } }>('/api/extract', async (req, reply) => {
    const settings = await loadSettings(opts.cwd);
    if (!settings.notionToken || !settings.outputDir) {
      return reply.code(412).send({ error: 'not configured' });
    }
    if (!latestTree) {
      return reply.code(412).send({ error: 'call /api/tree first' });
    }
    const { selectedIds } = req.body;
    if (!Array.isArray(selectedIds)) {
      return reply.code(400).send({ error: 'selectedIds[] required' });
    }

    const bus = new EventBus();
    const jobId = randomUUID();
    jobs.set(jobId, bus);
    void runExtraction({
      bus,
      outputDir: settings.outputDir,
      tree: latestTree,
      selectedIds,
    });
    return { job_id: jobId };
  });

  fastify.get<{ Querystring: { job?: string } }>('/api/events', async (req, reply) => {
    const job = req.query.job;
    const bus = job ? jobs.get(job) : undefined;
    reply.raw.setHeader('content-type', 'text/event-stream');
    reply.raw.setHeader('cache-control', 'no-cache');
    reply.raw.setHeader('connection', 'keep-alive');
    if (!bus) {
      reply.raw.end();
      return reply;
    }
    reply.hijack();
    for await (const event of bus.subscribe()) {
      reply.raw.write(eventToSse(event));
      if (event.kind === 'extraction_done' || event.kind === 'tree_ready' || event.kind === 'error')
        break;
    }
    reply.raw.end();
    return reply;
  });

  return fastify;
}

function pickWorkspaceId(roots: PlannedNode[]): string | null {
  // Notion's /search results don't reliably surface a workspace UUID,
  // so use a derived id from the sorted set of root ids. If the token
  // suddenly points to a different workspace (different set of shared
  // roots), this id changes and the cache invalidates.
  const ids = roots.map((r) => r.id).sort();
  if (ids.length === 0) return null;
  return ids.slice(0, 3).join('|');
}

function resolveStaticDir(): string | null {
  const candidates = [resolve(__dirname, '../../web'), resolve(__dirname, '../../dist/web')];
  return candidates.find((p) => existsSync(join(p, 'index.html'))) ?? null;
}
