import type { PlannedNode } from '@shared/types';
import { useEffect, useMemo, useState } from 'react';
import { getTree, refreshTree, startExtract } from '../api.js';
import { DiscoveryProgress } from './DiscoveryProgress.js';
import { TreeNode } from './TreeNode.js';

interface Props {
  onStart: (jobId: string) => void;
}

export function TreeView({ onStart }: Props) {
  const [nodes, setNodes] = useState<PlannedNode[] | null>(null);
  const [discoveredAt, setDiscoveredAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [discoveryJobId, setDiscoveryJobId] = useState<string | null>(null);

  useEffect(() => {
    getTree()
      .then((r) => {
        if (r.cached) {
          setNodes(r.nodes);
          setDiscoveredAt(r.discoveredAt);
        } else {
          setDiscoveryJobId(r.job_id);
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  function handleTreeReady(newNodes: PlannedNode[], newDiscoveredAt: string) {
    setNodes(newNodes);
    setDiscoveredAt(newDiscoveredAt);
    setDiscoveryJobId(null);
  }

  const { roots, childrenOf } = useMemo(() => {
    const all = nodes ?? [];
    const byParent = new Map<string | null, PlannedNode[]>();
    for (const n of all) {
      const list = byParent.get(n.parentId) ?? [];
      list.push(n);
      byParent.set(n.parentId, list);
    }
    const childMap = new Map<string, PlannedNode[]>();
    for (const [parent, kids] of byParent) {
      if (parent !== null) childMap.set(parent, kids);
    }
    return {
      roots: byParent.get(null) ?? [],
      childrenOf: childMap,
    };
  }, [nodes]);

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
    const all = nodes ?? [];
    setExpanded(new Set(all.map((n) => n.id)));
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
    setNodes(null);
    try {
      const r = await refreshTree();
      if (r.cached) {
        setNodes(r.nodes);
        setDiscoveredAt(r.discoveredAt);
      } else {
        setDiscoveryJobId(r.job_id);
      }
    } catch (e) {
      setError(String(e));
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

  if (error) return <p style={{ color: 'crimson' }}>{error}</p>;
  if (nodes === null) {
    if (discoveryJobId) {
      return <DiscoveryProgress jobId={discoveryJobId} onTreeReady={handleTreeReady} />;
    }
    return <p>Carregando…</p>;
  }
  if (!nodes.length) {
    return <p>Nenhuma página/database compartilhada com a integração ainda.</p>;
  }

  return (
    <section>
      <div className="tree-header">
        <h2>O que migrar?</h2>
        <div className="meta">
          {discoveredAt && (
            <>
              Última atualização: {new Date(discoveredAt).toLocaleString('pt-BR')}{' '}
              <button
                type="button"
                onClick={doRefresh}
                disabled={refreshing}
                aria-label="Refresh tree"
              >
                {refreshing ? '↻…' : '↻ Refresh'}
              </button>
            </>
          )}
        </div>
      </div>

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
        {roots.map((r) => (
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
      </div>

      <button
        type="button"
        disabled={selected.size === 0 || busy}
        onClick={submit}
        style={{ marginTop: '1rem' }}
      >
        {busy ? 'Iniciando…' : `Extrair selecionados (${selected.size})`}
      </button>
    </section>
  );
}
