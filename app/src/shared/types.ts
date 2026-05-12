export type NodeKind = 'page' | 'database' | 'db_item';

export interface PlannedNode {
  id: string;
  kind: NodeKind;
  title: string;
  parentId: string | null;
  childrenIds: string[];
  blocks: NotionBlock[];
  pageData: Record<string, unknown>;
}

// Structural-only subset of PlannedNode, sent over the wire to the
// frontend. Frontend never needs `blocks` or `pageData`; those stay
// server-side for extraction and the on-disk cache.
export interface LightNode {
  id: string;
  kind: NodeKind;
  title: string;
  parentId: string | null;
  childrenIds: string[];
}

export interface NotionBlock {
  id?: string;
  type: string;
  has_children?: boolean;
  children?: NotionBlock[];
  [key: string]: unknown;
}

export interface RootDTO {
  id: string;
  kind: NodeKind;
  title: string;
}

export interface ExtractRequest {
  selection: Array<{ id: string; kind: NodeKind }>;
}

export type ProgressEventKind =
  | 'discovery_started'
  | 'roots_listing'
  | 'roots_listed'
  | 'root_started'
  | 'discovery_progress'
  | 'root_completed'
  | 'root_failed'
  | 'discovery_done'
  | 'tree_ready'
  | 'extraction_started'
  | 'extraction_planned'
  | 'phase_started'
  | 'node_started'
  | 'node_done'
  | 'node_failed'
  | 'node_writing'
  | 'attachment_downloaded'
  | 'extraction_done'
  | 'error';

export interface ProgressEvent {
  kind: ProgressEventKind;
  data: Record<string, unknown>;
}
