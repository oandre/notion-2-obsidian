import type { RootDTO } from '@shared/types';
import { useEffect, useState } from 'react';
import { getRoots, startExtract } from '../api.js';

const ICON: Record<string, string> = { page: '📄', database: '🗃️' };

interface Props {
  onStart: (jobId: string) => void;
}

export function TreeView({ onStart }: Props) {
  const [roots, setRoots] = useState<RootDTO[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getRoots()
      .then(setRoots)
      .catch((e) => setError(String(e)));
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!roots) return;
    setBusy(true);
    setError(null);
    try {
      const selection = roots
        .filter((r) => selected.has(r.id))
        .map((r) => ({ id: r.id, kind: r.kind }));
      const jobId = await startExtract(selection);
      onStart(jobId);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  if (error) return <p style={{ color: 'crimson' }}>{error}</p>;
  if (!roots) return <p>Carregando árvore…</p>;
  if (!roots.length) return <p>Nenhuma página/database compartilhada com a integração ainda.</p>;

  return (
    <section>
      <h2>O que migrar?</h2>
      <ul className="tree">
        {roots.map((r) => (
          <li key={r.id}>
            <label>
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
              {` ${ICON[r.kind] ?? '•'} ${r.title}`}
            </label>
          </li>
        ))}
      </ul>
      <button type="button" disabled={selected.size === 0 || busy} onClick={submit}>
        {busy ? 'Iniciando…' : 'Extrair selecionados'}
      </button>
    </section>
  );
}
