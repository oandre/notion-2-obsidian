import type { PlannedNode } from '@shared/types';
import { useEffect, useMemo, useRef, useState } from 'react';

type RootStatus = 'waiting' | 'active' | 'done' | 'failed';

interface RootSummary {
  id: string;
  title: string;
  kind: string;
  status: RootStatus;
  pages: number;
  databases: number;
  dbItems: number;
  failureReason?: string;
}

interface Props {
  jobId: string;
  onTreeReady: (nodes: PlannedNode[], discoveredAt: string) => void;
}

export function DiscoveryProgress({ jobId, onTreeReady }: Props) {
  const [discovered, setDiscovered] = useState(0);
  const [totalRoots, setTotalRoots] = useState(0);
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
      setTotalRoots(data.count);
      setCurrentText(`Encontradas ${data.count} raízes`);
    });

    source.addEventListener('root_started', (e) => {
      // 'root_started' fires the moment Promise.all queues the walk —
      // including all the ones that are sitting in p-limit(3)'s queue
      // waiting for a slot. Mark them as 'waiting'; we promote to
      // 'active' the first time we see a 'discovery_progress' for them.
      const data = JSON.parse((e as MessageEvent).data) as {
        id: string;
        title: string;
        kind: string;
      };
      setRoots((prev) => [
        ...prev,
        { ...data, status: 'waiting', pages: 0, databases: 0, dbItems: 0 },
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
      if (data.currentRoot) {
        setRoots((prev) =>
          prev.map((r) =>
            r.id === data.currentRoot && r.status === 'waiting' ? { ...r, status: 'active' } : r,
          ),
        );
      }
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

    source.addEventListener('root_failed', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        id: string;
        title: string;
        reason: string;
      };
      setRoots((prev) =>
        prev.map((r) =>
          r.id === data.id ? { ...r, status: 'failed', failureReason: data.reason } : r,
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

  const { counts, completed, waiting, visible } = useMemo(() => {
    const c = { waiting: 0, active: 0, done: 0, failed: 0 };
    for (const r of roots) c[r.status]++;
    return {
      counts: c,
      completed: c.done + c.failed,
      waiting: roots.filter((r) => r.status === 'waiting'),
      visible: roots.filter((r) => r.status !== 'waiting'),
    };
  }, [roots]);

  const barProps =
    totalRoots > 0 ? { value: completed, max: totalRoots } : ({} as Record<string, never>);

  return (
    <div className="discovery-progress">
      <h2>Mapeando o workspace…</h2>
      <p className="counter">{discovered} nós encontrados</p>
      <p className="current">{currentText}</p>
      <progress {...barProps} />
      {totalRoots > 0 && (
        <p className="meta">
          {completed}/{totalRoots} raízes · {counts.active} ativas · {counts.waiting} aguardando
        </p>
      )}
      <ul className="roots-list">
        {visible.map((r) => {
          if (r.status === 'failed') {
            return (
              <li key={r.id} className="failed">
                ✗ {r.title} — pulada
                {r.failureReason ? `: ${r.failureReason}` : ''}
              </li>
            );
          }
          if (r.status === 'active') {
            return (
              <li key={r.id} className="active">
                ⟳ {r.title} (em progresso)
              </li>
            );
          }
          // done
          const summary = ` (${r.pages} pages${r.databases ? `, ${r.databases} db` : ''}${r.dbItems ? `, ${r.dbItems} items` : ''})`;
          return (
            <li key={r.id} className="done">
              ✓ {r.title}
              {summary}
            </li>
          );
        })}
        {waiting.length > 0 && (
          <li className="waiting-summary">
            … {waiting.length} aguardando (
            {waiting
              .slice(0, 5)
              .map((r) => r.title)
              .join(', ')}
            {waiting.length > 5 ? ', …' : ''})
          </li>
        )}
      </ul>
      {error && <p className="err">{error}</p>}
    </div>
  );
}
