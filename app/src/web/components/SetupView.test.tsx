import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupView } from './SetupView.js';

afterEach(() => cleanup());

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
});

describe('SetupView', () => {
  it('disables submit until both fields are filled', () => {
    render(<SetupView onDone={vi.fn()} />);
    const button = screen.getByRole('button', { name: /salvar/i });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Notion token/i), {
      target: { value: 'secret_x' },
    });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Pasta de sa/i), { target: { value: '/v' } });
    expect(button).not.toBeDisabled();
  });

  it('calls onDone after successful save', async () => {
    const onDone = vi.fn();
    render(<SetupView onDone={onDone} />);
    fireEvent.change(screen.getByLabelText(/Notion token/i), {
      target: { value: 'secret_x' },
    });
    fireEvent.change(screen.getByLabelText(/Pasta de sa/i), { target: { value: '/v' } });
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
