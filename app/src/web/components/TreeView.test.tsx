import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TreeView } from './TreeView.js';

afterEach(() => cleanup());

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    if (url.endsWith('/api/roots')) {
      return new Response(
        JSON.stringify([
          { id: 'p1', kind: 'page', title: 'Notas' },
          { id: 'd1', kind: 'database', title: 'Tarefas' },
        ]),
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

describe('TreeView', () => {
  it('lists roots and disables submit when nothing selected', async () => {
    render(<TreeView onStart={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Notas/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /extrair/i })).toBeDisabled();
  });

  it('enables submit when at least one root is checked', async () => {
    render(<TreeView onStart={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Notas/)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/Notas/));
    expect(screen.getByRole('button', { name: /extrair/i })).not.toBeDisabled();
  });

  it('starts extraction and reports the job id', async () => {
    const onStart = vi.fn();
    render(<TreeView onStart={onStart} />);
    await waitFor(() => expect(screen.getByText(/Notas/)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/Notas/));
    fireEvent.click(screen.getByRole('button', { name: /extrair/i }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith('job-1'));
  });
});
