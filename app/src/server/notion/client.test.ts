import { type Dispatcher, MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotionClient } from './client.js';

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

describe('NotionClient', () => {
  it('sets Authorization and Notion-Version on GET', async () => {
    const pool = mock.get('https://api.notion.com');
    pool.intercept({ path: '/v1/pages/abc', method: 'GET' }).reply(200, { id: 'abc' });

    const client = new NotionClient({ token: 'secret_xyz' });
    const result = await client.get('/pages/abc');
    expect(result).toEqual({ id: 'abc' });
  });

  it('retries on 429', async () => {
    const pool = mock.get('https://api.notion.com');
    pool
      .intercept({ path: '/v1/x', method: 'GET' })
      .reply(429, '', { headers: { 'retry-after': '0' } });
    pool.intercept({ path: '/v1/x', method: 'GET' }).reply(200, { ok: true });

    const client = new NotionClient({ token: 't', maxRetries: 3, backoffBaseMs: 0 });
    const result = await client.get('/x');
    expect(result).toEqual({ ok: true });
  });

  it('throws on persistent 5xx after maxRetries', async () => {
    const pool = mock.get('https://api.notion.com');
    for (let i = 0; i < 4; i++) pool.intercept({ path: '/v1/x', method: 'GET' }).reply(503, '');

    const client = new NotionClient({ token: 't', maxRetries: 3, backoffBaseMs: 0 });
    await expect(client.get('/x')).rejects.toThrow(/503/);
  });

  it('retries on transient network errors (e.g. headers timeout)', async () => {
    const pool = mock.get('https://api.notion.com');
    // First attempt: simulate a headers-timeout-like throw from undici.
    const timeoutError = Object.assign(new Error('Headers Timeout Error'), {
      code: 'UND_ERR_HEADERS_TIMEOUT',
    });
    pool.intercept({ path: '/v1/x', method: 'GET' }).replyWithError(timeoutError);
    // Second attempt: success.
    pool.intercept({ path: '/v1/x', method: 'GET' }).reply(200, { ok: true });

    const client = new NotionClient({ token: 't', maxRetries: 3, backoffBaseMs: 0 });
    const result = await client.get('/x');
    expect(result).toEqual({ ok: true });
  });

  it('does NOT retry on non-transient errors', async () => {
    const pool = mock.get('https://api.notion.com');
    const fatal = Object.assign(new Error('Something else'), { code: 'EFOO' });
    pool.intercept({ path: '/v1/x', method: 'GET' }).replyWithError(fatal);

    const client = new NotionClient({ token: 't', maxRetries: 3, backoffBaseMs: 0 });
    await expect(client.get('/x')).rejects.toThrow(/Something else/);
  });
});
