import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { NodeKind } from '@shared/types';
import Fastify, { type FastifyInstance } from 'fastify';
import { loadSettings, writeSettings } from './config.js';
import { runExtraction } from './extract/pipeline.js';
import { NotionClient } from './notion/client.js';
import { listSharedRoots } from './notion/discovery.js';
import { EventBus, eventToSse } from './progress.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface BuildAppOpts {
  cwd: string;
}

export async function buildApp(opts: BuildAppOpts): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  const jobs = new Map<string, EventBus>();

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
      return reply.code(204).send();
    },
  );

  fastify.get('/api/roots', async (_req, reply) => {
    const settings = await loadSettings(opts.cwd);
    if (!settings.notionToken) {
      return reply.code(412).send({ error: 'token not configured' });
    }
    const client = new NotionClient({ token: settings.notionToken });
    const roots = await listSharedRoots(client);
    return roots.map((r) => ({ id: r.id, kind: r.kind, title: r.title }));
  });

  fastify.post<{ Body: { selection: Array<{ id: string; kind: NodeKind }> } }>(
    '/api/extract',
    async (req, reply) => {
      const settings = await loadSettings(opts.cwd);
      if (!settings.notionToken || !settings.outputDir) {
        return reply.code(412).send({ error: 'not configured' });
      }
      const bus = new EventBus();
      const jobId = randomUUID();
      jobs.set(jobId, bus);
      const client = new NotionClient({ token: settings.notionToken });
      void runExtraction({
        client,
        bus,
        outputDir: settings.outputDir,
        rootSelection: req.body.selection,
      });
      return { job_id: jobId };
    },
  );

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
      if (event.kind === 'extraction_done' || event.kind === 'error') break;
    }
    reply.raw.end();
    return reply;
  });

  return fastify;
}

function resolveStaticDir(): string | null {
  // app.js lives at dist/src/server/ when built (rootDir='.') or at src/server/
  // when running via tsx. dist/web/ holds the built web assets in both cases.
  const candidates = [
    resolve(__dirname, '../../web'), // built: dist/src/server → dist/web
    resolve(__dirname, '../../dist/web'), // dev: src/server → dist/web
  ];
  return candidates.find((p) => existsSync(join(p, 'index.html'))) ?? null;
}
