import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface Settings {
  notionToken: string | null;
  outputDir: string | null;
  host: string;
  port: number;
}

export async function loadSettings(cwd: string): Promise<Settings> {
  let content = '';
  try {
    content = await readFile(join(cwd, '.env'), 'utf8');
  } catch {
    // .env may not exist yet
  }
  const env = parseEnv(content);
  return {
    notionToken: env.NOTION_TOKEN || null,
    outputDir: env.OUTPUT_DIR || null,
    host: env.HOST || '127.0.0.1',
    port: Number.parseInt(env.PORT ?? '8765', 10),
  };
}

export async function writeSettings(
  cwd: string,
  updates: { notionToken?: string; outputDir?: string },
): Promise<void> {
  const current = await loadSettings(cwd);
  const merged = {
    NOTION_TOKEN: updates.notionToken ?? current.notionToken ?? '',
    OUTPUT_DIR: updates.outputDir ?? current.outputDir ?? '',
    HOST: current.host,
    PORT: String(current.port),
  };
  const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
  await writeFile(join(cwd, '.env'), `${lines.join('\n')}\n`, 'utf8');
}

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}
