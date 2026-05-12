import type { PlannedNode } from '@shared/types';

export async function getStatus(): Promise<{ tokenConfigured: boolean; outputDir: string | null }> {
  const res = await fetch('/api/status');
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

export async function postSetup(notionToken: string, outputDir: string): Promise<void> {
  const res = await fetch('/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ notionToken, outputDir }),
  });
  if (!res.ok) throw new Error(`setup failed: ${res.status}`);
}

export type TreeResponse =
  | { cached: true; nodes: PlannedNode[]; discoveredAt: string }
  | { cached: false; job_id: string };

export async function getTree(): Promise<TreeResponse> {
  const res = await fetch('/api/tree');
  if (!res.ok) throw new Error(`tree failed: ${res.status}`);
  return res.json();
}

export async function refreshTree(): Promise<TreeResponse> {
  const res = await fetch('/api/tree?refresh=true');
  if (!res.ok) throw new Error(`tree refresh failed: ${res.status}`);
  return res.json();
}

export async function startExtract(selectedIds: string[]): Promise<string> {
  const res = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ selectedIds }),
  });
  if (!res.ok) throw new Error(`extract failed: ${res.status}`);
  const { job_id } = (await res.json()) as { job_id: string };
  return job_id;
}
