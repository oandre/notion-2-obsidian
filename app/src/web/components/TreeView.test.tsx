import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TreeView } from './TreeView.js';

afterEach(() => cleanup());

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    if (url.includes('/api/tree')) {
      return new Response(
        JSON.stringify({
          discoveredAt: '2026-05-11T17:00:00.000Z',
          cached: true,
          nodes: [
            {
              id: 'r1',
              kind: 'page',
              title: 'Notas',
              parentId: null,
              childrenIds: ['c1'],
              blocks: [],
              pageData: {},
            },
            {
              id: 'c1',
              kind: 'page',
              title: 'Sub',
              parentId: 'r1',
              childrenIds: [],
              blocks: [],
              pageData: {},
            },
            {
              id: 'd1',
              kind: 'database',
              title: 'Tarefas',
              parentId: null,
              childrenIds: [],
              blocks: [],
              pageData: {},
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.endsWith('/api/extract')) {
      return new Response(JSON.stringify({ job_id: 'job-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(null, { status: 404 });
  });
});

describe('TreeView (recursive)', () => {
  it('renders top-level nodes and disables submit when nothing is selected', async () => {
    render(<TreeView onStart={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Notas/)).toBeTruthy());
    expect(screen.getByText(/Tarefas/)).toBeTruthy();
    // child not visible while collapsed
    expect(screen.queryByText(/Sub/)).toBeNull();
    expect(screen.getByRole('button', { name: /extrair/i })).toBeDisabled();
  });

  it('expanding shows children', async () => {
    render(<TreeView onStart={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Notas/)).toBeTruthy());
    const chevs = screen.getAllByText(/[▸▾]/);
    fireEvent.click(chevs[0]!);
    expect(screen.getByText(/Sub/)).toBeTruthy();
  });

  it('selecting parent and submitting passes the parent id', async () => {
    const onStart = vi.fn();
    render(<TreeView onStart={onStart} />);
    await waitFor(() => expect(screen.getByText(/Notas/)).toBeTruthy());

    const checkboxes = screen.getAllByRole('checkbox');
    // First checkbox is the first top-level node (Notas)
    fireEvent.click(checkboxes[0]!);

    fireEvent.click(screen.getByRole('button', { name: /extrair/i }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith('job-1'));

    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls.at(-1);
    const body = JSON.parse((lastCall?.[1] as RequestInit).body as string);
    expect(body).toEqual({ selectedIds: ['r1'] });
  });
});
