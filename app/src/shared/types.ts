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
  | 'root_done'
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
