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
  | 'discovery_progress'
  | 'discovery_done'
  | 'node_started'
  | 'node_done'
  | 'node_failed'
  | 'attachment_downloaded'
  | 'extraction_done'
  | 'error';

export interface ProgressEvent {
  kind: ProgressEventKind;
  data: Record<string, unknown>;
}
