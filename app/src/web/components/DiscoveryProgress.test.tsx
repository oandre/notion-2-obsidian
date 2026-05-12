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
  // Helper: match against the concatenated textContent of any element,
  // since our DOM splits "X aguardando" across multiple text nodes.
  function bodyContains(needle: string): () => boolean {
    return () => document.body.textContent?.includes(needle) ?? false;
  }

  it('shows counter, promotes waiting → active, and calls onTreeReady when tree_ready arrives', async () => {
    const onTreeReady = vi.fn();
    render(<DiscoveryProgress jobId="job-1" onTreeReady={onTreeReady} />);
    const es = FakeEventSource.instances[0]!;

    es.emit('roots_listed', { count: 2 });
    await waitFor(() => expect(bodyContains('Encontradas 2 raízes')()).toBe(true));

    // Both roots are queued. They appear collapsed under "aguardando".
    es.emit('root_started', { id: 'p1', title: 'Notas', kind: 'page' });
    es.emit('root_started', { id: 'p2', title: 'Outra', kind: 'page' });
    await waitFor(() => expect(bodyContains('2 aguardando')()).toBe(true));
    // Individually NOT shown while waiting
    expect(screen.queryByText(/Notas \(em progresso\)/)).toBeNull();

    // First discovery_progress promotes p1 to active and bumps the counter.
    es.emit('discovery_progress', {
      discovered: 5,
      currentRoot: 'p1',
      title: 'Um filho',
    });
    await waitFor(() => expect(bodyContains('5 nós encontrados')()).toBe(true));
    expect(await screen.findByText(/Notas \(em progresso\)/)).toBeTruthy();
    expect(await screen.findByText(/Mapeando "Um filho"/)).toBeTruthy();

    es.emit('root_done', { id: 'p1', title: 'Notas', pages: 3, databases: 0, dbItems: 0 });
    await waitFor(() => expect(bodyContains('Notas')()).toBe(true));
    await waitFor(() => expect(bodyContains('(3 pages)')()).toBe(true));

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
