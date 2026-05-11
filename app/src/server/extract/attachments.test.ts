import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Dispatcher, MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AttachmentDownloader } from './attachments.js';

let mock: MockAgent;
let previous: Dispatcher;

beforeEach(() => {
  previous = getGlobalDispatcher();
  mock = new MockAgent();
  mock.disableNetConnect();
  setGlobalDispatcher(mock);
});

afterEach(async () => {
  await mock.close();
  setGlobalDispatcher(previous);
});

async function tmp() {
  return mkdtemp(join(tmpdir(), 'attach-'));
}

describe('AttachmentDownloader', () => {
  it('writes file with hashed name', async () => {
    const dir = await tmp();
    const pool = mock.get('https://prod-files.s3.amazonaws.com');
    pool.intercept({ path: '/folder/image.png', method: 'GET' }).reply(200, Buffer.from('PNGDATA'));

    const dl = new AttachmentDownloader(join(dir, 'assets'));
    try {
      const local = await dl.download('https://prod-files.s3.amazonaws.com/folder/image.png');
      expect(local).toMatch(/-image\.png$/);
      expect(await readFile(local)).toEqual(Buffer.from('PNGDATA'));
    } finally {
      await dl.close();
    }
  });

  it('deduplicates same url across two downloads', async () => {
    const dir = await tmp();
    const pool = mock.get('https://prod-files.s3.amazonaws.com');
    pool.intercept({ path: '/x.png', method: 'GET' }).reply(200, Buffer.from('DATA'));

    const dl = new AttachmentDownloader(join(dir, 'assets'));
    try {
      const a = await dl.download('https://prod-files.s3.amazonaws.com/x.png');
      const b = await dl.download('https://prod-files.s3.amazonaws.com/x.png');
      expect(a).toBe(b);
      const files = await readdir(join(dir, 'assets'));
      expect(files).toHaveLength(1);
    } finally {
      await dl.close();
    }
  });

  it('uses basename from path, not query string', async () => {
    const dir = await tmp();
    const pool = mock.get('https://prod-files.s3.amazonaws.com');
    pool.intercept({ path: '/x.png?sig=abc', method: 'GET' }).reply(200, Buffer.from('D'));

    const dl = new AttachmentDownloader(join(dir, 'assets'));
    try {
      const local = await dl.download('https://prod-files.s3.amazonaws.com/x.png?sig=abc');
      expect(local.endsWith('-x.png')).toBe(true);
    } finally {
      await dl.close();
    }
  });
});
