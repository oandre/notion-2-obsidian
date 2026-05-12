import type { PlannedNode } from '@shared/types';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscoveryProgress } from './DiscoveryProgress.js';

class FakeEventSource {
  url: string;
  listeners: Map<string, Array<(e: MessageEvent) => void>> = new Map();
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, fn: (e: MessageEvent) => void) {
    const list = this.listeners.get(name) ?? [];
    list.push(fn);
    this.listeners.set(name, list);
  }

  emit(name: string, data: unknown) {
    const list = this.listeners.get(name) ?? [];
    const event = new MessageEvent(name, { data: JSON.stringify(data) });
    for (const fn of list) fn(event);
  }

  close() {
    this.closed = true;
  }

  static instances: FakeEventSource[] = [];
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DiscoveryProgress', () => {
  it('shows counter, current root, and calls onTreeReady when tree_ready arrives', async () => {
    const onTreeReady = vi.fn();
    render(<DiscoveryProgress jobId="job-1" onTreeReady={onTreeReady} />);
    const es = FakeEventSource.instances[0]!;

    es.emit('roots_listed', { count: 1 });
    expect(await screen.findByText(/Encontradas 1 ra/i)).toBeTruthy();

    es.emit('root_started', { id: 'p1', title: 'Notas', kind: 'page' });
    expect(await screen.findByText(/Mapeando "Notas"/)).toBeTruthy();

    es.emit('discovery_progress', { discovered: 5, currentRoot: 'p1' });
    expect(await screen.findByText(/5 nós encontrados/)).toBeTruthy();

    es.emit('root_done', { id: 'p1', title: 'Notas', pages: 3, databases: 0, dbItems: 0 });

    const nodes: PlannedNode[] = [
      {
        id: 'p1',
        kind: 'page',
        title: 'Notas',
        parentId: null,
        childrenIds: [],
        blocks: [],
        pageData: {},
      },
    ];
    es.emit('tree_ready', { nodes, discoveredAt: '2026-05-11T18:00:00Z' });

    await waitFor(() => expect(onTreeReady).toHaveBeenCalledWith(nodes, '2026-05-11T18:00:00Z'));
    expect(es.closed).toBe(true);
  });
});
