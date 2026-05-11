import { describe, expect, it } from 'vitest';
import { EventBus, eventToSse } from './progress.js';

describe('EventBus', () => {
  it('publish then subscribe receives events', async () => {
    const bus = new EventBus();
    const received: string[] = [];
    const iter = bus.subscribe();
    const consumer = (async () => {
      for await (const event of iter) {
        received.push(event.kind);
        if (event.kind === 'extraction_done') break;
      }
    })();
    // give the subscriber a microtask to register
    await new Promise((r) => setTimeout(r, 0));
    await bus.publish({ kind: 'discovery_started', data: {} });
    await bus.publish({ kind: 'extraction_done', data: { ok: true } });
    await consumer;
    expect(received).toEqual(['discovery_started', 'extraction_done']);
  });

  it('eventToSse format', () => {
    const sse = eventToSse({ kind: 'node_done', data: { id: 'p1', title: 'X' } });
    expect(sse.startsWith('event: node_done\n')).toBe(true);
    expect(sse).toContain('"id":"p1"');
    expect(sse.endsWith('\n\n')).toBe(true);
  });
});
