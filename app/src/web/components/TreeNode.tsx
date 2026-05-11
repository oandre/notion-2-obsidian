import type { PlannedNode } from '@shared/types';
import { useMemo } from 'react';

const ICON: Record<string, string> = { page: '📄', database: '🗃️', db_item: '·' };

interface Props {
  node: PlannedNode;
  childrenOf: Map<string, PlannedNode[]>;
  selected: Set<string>;
  expanded: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
}

export function TreeNode({
  node,
  childrenOf,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
}: Props) {
  const children = childrenOf.get(node.id) ?? [];
  const hasChildren = children.length > 0;
  const isExpanded = expanded.has(node.id);

  const state = useMemo(() => {
    if (selected.has(node.id)) return 'full' as const;
    return anyDescendantSelected(node, childrenOf, selected)
      ? ('indeterminate' as const)
      : ('none' as const);
  }, [node, childrenOf, selected]);

  const handleChevronKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggleExpand(node.id);
    }
  };

  return (
    <div className="tree-node">
      <div className="row">
        <span
          className={`chev ${hasChildren ? '' : 'placeholder'}`}
          onClick={hasChildren ? () => onToggleExpand(node.id) : undefined}
          onKeyDown={hasChildren ? handleChevronKeyDown : undefined}
          role={hasChildren ? 'button' : undefined}
          tabIndex={hasChildren ? 0 : undefined}
        >
          {hasChildren ? (isExpanded ? '▾' : '▸') : '•'}
        </span>
        <label htmlFor={`cb-${node.id}`}>
          <input
            id={`cb-${node.id}`}
            type="checkbox"
            checked={state === 'full'}
            ref={(el) => {
              if (el) el.indeterminate = state === 'indeterminate';
            }}
            onChange={() => onToggleSelect(node.id)}
          />{' '}
          {ICON[node.kind] ?? '•'} {node.title}
        </label>
      </div>
      {hasChildren && isExpanded && (
        <div className="children">
          {children.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              childrenOf={childrenOf}
              selected={selected}
              expanded={expanded}
              onToggleSelect={onToggleSelect}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function anyDescendantSelected(
  node: PlannedNode,
  childrenOf: Map<string, PlannedNode[]>,
  selected: Set<string>,
): boolean {
  const children = childrenOf.get(node.id) ?? [];
  for (const c of children) {
    if (selected.has(c.id)) return true;
    if (anyDescendantSelected(c, childrenOf, selected)) return true;
  }
  return false;
}
