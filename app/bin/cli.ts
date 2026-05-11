#!/usr/bin/env node
import open from 'open';
import { buildApp } from '../src/server/app.js';

async function main() {
  const cwd = process.cwd();
  const app = await buildApp({ cwd });

  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number.parseInt(process.env.PORT ?? '8765', 10);
  await app.listen({ host, port });
  const url = `http://${host}:${port}/`;
  console.log(`notion-2-obsidian running on ${url}`);

  if (!process.env.NO_OPEN) {
    try {
      await open(url);
    } catch {
      // best-effort: ignore if `open` can't launch a browser
    }
  }

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
