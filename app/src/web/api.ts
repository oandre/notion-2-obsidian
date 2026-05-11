import type { RootDTO } from '@shared/types';

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

export async function getRoots(): Promise<RootDTO[]> {
  const res = await fetch('/api/roots');
  if (!res.ok) throw new Error(`roots failed: ${res.status}`);
  return res.json();
}

export async function startExtract(
  selection: Array<{ id: string; kind: string }>,
): Promise<string> {
  const res = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ selection }),
  });
  if (!res.ok) throw new Error(`extract failed: ${res.status}`);
  const { job_id } = (await res.json()) as { job_id: string };
  return job_id;
}
