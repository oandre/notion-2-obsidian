import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSettings, writeSettings } from './config.js';

async function tmp() {
  return mkdtemp(join(tmpdir(), 'cfg-'));
}

describe('settings', () => {
  it('writes and reads back .env values', async () => {
    const dir = await tmp();
    await writeSettings(dir, { notionToken: 'secret_abc', outputDir: '/v' });
    const loaded = await loadSettings(dir);
    expect(loaded.notionToken).toBe('secret_abc');
    expect(loaded.outputDir).toBe('/v');
  });

  it('returns null for missing fields when .env is empty', async () => {
    const dir = await tmp();
    await writeFile(join(dir, '.env'), '', 'utf8');
    const loaded = await loadSettings(dir);
    expect(loaded.notionToken).toBeNull();
    expect(loaded.outputDir).toBeNull();
  });
});
