import type { PlannedNode } from '@shared/types';
import { useEffect, useRef, useState } from 'react';

interface RootSummary {
  id: string;
  title: string;
  kind: string;
  status: 'pending' | 'active' | 'done';
  pages: number;
  databases: number;
  dbItems: number;
}

interface Props {
  jobId: string;
  onTreeReady: (nodes: PlannedNode[], discoveredAt: string) => void;
}

export function DiscoveryProgress({ jobId, onTreeReady }: Props) {
  const [discovered, setDiscovered] = useState(0);
  const [currentText, setCurrentText] = useState('');
  const [roots, setRoots] = useState<RootSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const onTreeReadyRef = useRef(onTreeReady);
  onTreeReadyRef.current = onTreeReady;

  useEffect(() => {
    const source = new EventSource(`/api/events?job=${encodeURIComponent(jobId)}`);

    source.addEventListener('discovery_started', () => {
      setCurrentText('Procurando workspace…');
    });

    source.addEventListener('roots_listing', () => {
      setCurrentText('Procurando workspace…');
    });

    source.addEventListener('roots_listed', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { count: number };
      setCurrentText(`Encontradas ${data.count} raízes`);
    });

    source.addEventListener('root_started', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        id: string;
        title: string;
        kind: string;
      };
      setCurrentText(`Mapeando "${data.title}"`);
      setRoots((prev) => [
        ...prev,
        { ...data, status: 'active', pages: 0, databases: 0, dbItems: 0 },
      ]);
    });

    source.addEventListener('discovery_progress', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        discovered: number;
        currentRoot?: string;
        title?: string;
      };
      setDiscovered(data.discovered);
      if (data.title) setCurrentText(`Mapeando "${data.title}"`);
    });

    source.addEventListener('root_done', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        id: string;
        title: string;
        pages: number;
        databases: number;
        dbItems: number;
      };
      setRoots((prev) =>
        prev.map((r) =>
          r.id === data.id
            ? {
                ...r,
                status: 'done',
                pages: data.pages,
                databases: data.databases,
                dbItems: data.dbItems,
              }
            : r,
        ),
      );
    });

    source.addEventListener('tree_ready', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        nodes: PlannedNode[];
        discoveredAt: string;
      };
      onTreeReadyRef.current(data.nodes, data.discoveredAt);
      source.close();
    });

    source.addEventListener('error', (e) => {
      const evt = e as MessageEvent;
      const msg = evt.data
        ? ((JSON.parse(evt.data) as { message?: string }).message ?? 'Discovery failed')
        : 'Connection lost';
      setError(msg);
      source.close();
    });

    return () => source.close();
  }, [jobId]);

  return (
    <div className="discovery-progress">
      <h2>Mapeando o workspace…</h2>
      <p className="counter">{discovered} nós encontrados</p>
      <p className="current">{currentText}</p>
      <progress />
      <ul className="roots-list">
        {roots.map((r) => {
          const summary =
            r.status === 'done'
              ? ` (${r.pages} pages${r.databases ? `, ${r.databases} db` : ''}${r.dbItems ? `, ${r.dbItems} items` : ''})`
              : r.status === 'active'
                ? ' (em progresso)'
                : '';
          const marker = r.status === 'done' ? '✓' : r.status === 'active' ? '⟳' : '·';
          return (
            <li key={r.id} className={r.status}>
              {marker} {r.title}
              {summary}
            </li>
          );
        })}
      </ul>
      {error && <p className="err">{error}</p>}
    </div>
  );
}
