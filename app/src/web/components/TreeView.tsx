import type { LightNode } from '@shared/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getTree, refreshTree, startExtract } from '../api.js';
import { TreeNode } from './TreeNode.js';

type DiscoveryStatus = 'loading' | 'cached' | 'discovering' | 'done' | 'error';
type RootStatus = 'waiting' | 'active' | 'done' | 'failed';

interface RootMeta {
  id: string;
  title: string;
  kind: string;
  status: RootStatus;
  pages?: number;
  databases?: number;
  dbItems?: number;
  failureReason?: string;
}

interface Props {
  onStart: (jobId: string) => void;
}

export function TreeView({ onStart }: Props) {
  const [status, setStatus] = useState<DiscoveryStatus>('loading');
  const [nodes, setNodes] = useState<LightNode[]>([]);
  const [rootMeta, setRootMeta] = useState<Map<string, RootMeta>>(new Map());
  const [totalRoots, setTotalRoots] = useState(0);
  const [currentText, setCurrentText] = useState('');
  const [discoveredAt, setDiscoveredAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const sourceRef = useRef<EventSource | null>(null);

  function resetForNewDiscovery() {
    setNodes([]);
    setRootMeta(new Map());
    setTotalRoots(0);
    setCurrentText('');
    setDiscoveredAt(null);
    setSelected(new Set());
    setExpanded(new Set());
  }

  function subscribe(jobId: string) {
    sourceRef.current?.close();
    const source = new EventSource(`/api/events?job=${encodeURIComponent(jobId)}`);
    sourceRef.current = source;

    source.addEventListener('roots_listing', () => {
      setCurrentText('Procurando workspace…');
    });

    source.addEventListener('roots_listed', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { count: number };
      setTotalRoots(data.count);
      setCurrentText(`Encontradas ${data.count} raízes`);
    });

    source.addEventListener('root_started', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        id: string;
        title: string;
        kind: string;
      };
      setRootMeta((prev) => {
        const next = new Map(prev);
        next.set(data.id, { ...data, status: 'waiting' });
        return next;
      });
    });

    source.addEventListener('discovery_progress', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        discovered: number;
        currentRoot?: string;
        title?: string;
      };
      if (data.title) setCurrentText(`Mapeando "${data.title}"`);
      if (data.currentRoot) {
        setRootMeta((prev) => {
          const r = prev.get(data.currentRoot ?? '');
          if (!r || r.status !== 'waiting') return prev;
          const next = new Map(prev);
          next.set(r.id, { ...r, status: 'active' });
          return next;
        });
      }
    });

    source.addEventListener('root_completed', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        id: string;
        title: string;
        pages: number;
        databases: number;
        dbItems: number;
        subtree: LightNode[];
      };
      setNodes((prev) => [...prev, ...data.subtree]);
      setRootMeta((prev) => {
        const next = new Map(prev);
        const existing = next.get(data.id);
        next.set(data.id, {
          id: data.id,
          title: data.title,
          kind: existing?.kind ?? 'page',
          status: 'done',
          pages: data.pages,
          databases: data.databases,
          dbItems: data.dbItems,
        });
        return next;
      });
    });

    source.addEventListener('root_failed', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        id: string;
        title: string;
        reason: string;
      };
      setRootMeta((prev) => {
        const next = new Map(prev);
        const existing = next.get(data.id);
        next.set(data.id, {
          id: data.id,
          title: data.title,
          kind: existing?.kind ?? 'page',
          status: 'failed',
          failureReason: data.reason,
        });
        return next;
      });
    });

    source.addEventListener('tree_ready', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { discoveredAt: string };
      setDiscoveredAt(data.discoveredAt);
      setStatus('done');
      source.close();
    });

    source.addEventListener('error', (e) => {
      const evt = e as MessageEvent;
      const msg = evt.data
        ? ((JSON.parse(evt.data) as { message?: string }).message ?? 'Discovery failed')
        : 'Connection lost';
      setError(msg);
      setStatus('error');
      source.close();
    });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only; subscribe is intentionally not a dep
  useEffect(() => {
    getTree()
      .then((r) => {
        if (r.cached) {
          setNodes(r.nodes);
          setDiscoveredAt(r.discoveredAt);
          setStatus('cached');
        } else {
          setStatus('discovering');
          subscribe(r.job_id);
        }
      })
      .catch((e) => {
        setError(String(e));
        setStatus('error');
      });
    return () => {
      sourceRef.current?.close();
    };
  }, []);

  const { topLevel, childrenOf } = useMemo(() => {
    // Build parent → children index. Dedup by id (a single root could be
    // re-emitted on refresh; we keep the last one).
    const byId = new Map<string, LightNode>();
    for (const n of nodes) byId.set(n.id, n);
    const list = Array.from(byId.values());
    const byParent = new Map<string | null, LightNode[]>();
    for (const n of list) {
      const arr = byParent.get(n.parentId) ?? [];
      arr.push(n);
      byParent.set(n.parentId, arr);
    }
    const childMap = new Map<string, LightNode[]>();
    for (const [parent, kids] of byParent) {
      if (parent !== null) childMap.set(parent, kids);
    }
    return { topLevel: byParent.get(null) ?? [], childrenOf: childMap };
  }, [nodes]);

  const rootCounts = useMemo(() => {
    const c = { waiting: 0, active: 0, done: 0, failed: 0 };
    for (const r of rootMeta.values()) c[r.status]++;
    return c;
  }, [rootMeta]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setExpanded(new Set(nodes.map((n) => n.id)));
  }
  function collapseAll() {
    setExpanded(new Set());
  }
  function clearSelection() {
    setSelected(new Set());
  }

  async function doRefresh() {
    setRefreshing(true);
    setError(null);
    resetForNewDiscovery();
    setStatus('loading');
    try {
      const r = await refreshTree();
      if (r.cached) {
        setNodes(r.nodes);
        setDiscoveredAt(r.discoveredAt);
        setStatus('cached');
      } else {
        setStatus('discovering');
        subscribe(r.job_id);
      }
    } catch (e) {
      setError(String(e));
      setStatus('error');
    } finally {
      setRefreshing(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const jobId = await startExtract([...selected]);
      onStart(jobId);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  if (error && status === 'error') {
    return (
      <section>
        <p style={{ color: 'crimson' }}>{error}</p>
        <button type="button" onClick={doRefresh} disabled={refreshing}>
          Tentar novamente
        </button>
      </section>
    );
  }

  const discovering = status === 'discovering';

  // Order top-level nodes by completed-first, then by completion order.
  // For waiting/active/failed roots (no subtree yet), we still render
  // a row using rootMeta info.
  const completedTopLevelIds = new Set(topLevel.map((n) => n.id));
  const pendingRootRows = Array.from(rootMeta.values()).filter(
    (r) => !completedTopLevelIds.has(r.id) && r.status !== 'done',
  );

  return (
    <section>
      <div className="tree-header">
        <h2>O que migrar?</h2>
        <div className="meta">
          {discoveredAt && status !== 'discovering' && (
            <>Última atualização: {new Date(discoveredAt).toLocaleString('pt-BR')} </>
          )}
          {(status === 'cached' || status === 'done' || status === 'discovering') && (
            <button
              type="button"
              onClick={doRefresh}
              disabled={refreshing || discovering}
              aria-label="Refresh tree"
            >
              {refreshing ? '↻…' : '↻ Refresh'}
            </button>
          )}
        </div>
      </div>

      {discovering && (
        <div className="discovery-status">
          <p className="current">{currentText}</p>
          <progress
            value={rootCounts.done + rootCounts.failed}
            max={totalRoots > 0 ? totalRoots : 1}
          />
          {totalRoots > 0 && (
            <p className="meta">
              {rootCounts.done + rootCounts.failed}/{totalRoots} raízes · {rootCounts.active} ativas
              · {rootCounts.waiting} aguardando · {nodes.length} nós
            </p>
          )}
        </div>
      )}

      {status === 'loading' && <p>Carregando…</p>}

      {(status === 'cached' || status === 'discovering' || status === 'done') && (
        <>
          <div className="tree-toolbar">
            <button type="button" onClick={expandAll}>
              Expandir tudo
            </button>
            <button type="button" onClick={collapseAll}>
              Recolher tudo
            </button>
            <button type="button" onClick={clearSelection}>
              Limpar seleção
            </button>
          </div>

          <div>
            {topLevel.length === 0 && status !== 'discovering' && (
              <p>Nenhuma página/database compartilhada com a integração ainda.</p>
            )}
            {topLevel.map((r) => (
              <TreeNode
                key={r.id}
                node={r}
                childrenOf={childrenOf}
                selected={selected}
                expanded={expanded}
                onToggleSelect={toggleSelect}
                onToggleExpand={toggleExpand}
              />
            ))}
            {pendingRootRows.map((r) => (
              <PendingRootRow key={r.id} root={r} />
            ))}
          </div>

          <button
            type="button"
            disabled={selected.size === 0 || busy}
            onClick={submit}
            style={{ marginTop: '1rem' }}
          >
            {busy ? 'Iniciando…' : `Extrair selecionados (${selected.size})`}
          </button>
        </>
      )}
    </section>
  );
}

function PendingRootRow({ root }: { root: RootMeta }) {
  if (root.status === 'failed') {
    return (
      <div className="tree-node pending failed">
        <div className="row">
          <span className="chev placeholder">•</span>
          <span>
            ✗ {root.title} — pulada{root.failureReason ? `: ${root.failureReason}` : ''}
          </span>
        </div>
      </div>
    );
  }
  if (root.status === 'active') {
    return (
      <div className="tree-node pending active">
        <div className="row">
          <span className="chev placeholder">•</span>
          <span>⟳ {root.title} (em descoberta…)</span>
        </div>
      </div>
    );
  }
  // waiting
  return (
    <div className="tree-node pending waiting">
      <div className="row">
        <span className="chev placeholder">•</span>
        <span>⋯ {root.title} (aguardando…)</span>
      </div>
    </div>
  );
}
