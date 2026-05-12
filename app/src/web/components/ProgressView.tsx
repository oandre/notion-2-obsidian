import { useEffect, useRef, useState } from 'react';

interface Props {
  jobId: string;
}

type LogEntry = { text: string; cls: 'done' | 'failed' | 'writing' | '' };

const PHASE_LABEL: Record<string, string> = {
  render: 'Renderizando blocos',
  download_and_write: 'Baixando anexos e escrevendo arquivos',
};

export function ProgressView({ jobId }: Props) {
  const [phase, setPhase] = useState('Iniciando…');
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const source = new EventSource(`/api/events?job=${encodeURIComponent(jobId)}`);
    const append = (text: string, cls: LogEntry['cls'] = '') =>
      setLog((prev) => [...prev, { text, cls }]);

    source.addEventListener('extraction_planned', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        totalPages: number;
        totalDbItems: number;
        totalDatabases: number;
        totalNodes: number;
      };
      setTotal(data.totalNodes);
      setSummary(
        `${data.totalNodes} nós (${data.totalPages} páginas, ${data.totalDbItems} items, ${data.totalDatabases} db)`,
      );
    });

    source.addEventListener('phase_started', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { name: string };
      setPhase(PHASE_LABEL[data.name] ?? data.name);
    });

    source.addEventListener('node_started', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        id: string;
        title?: string;
      };
      append(`⟳ ${data.title ?? data.id}`);
    });

    source.addEventListener('node_done', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { id: string };
      setDone((n) => n + 1);
      append(`✓ ${data.id}`, 'done');
    });

    source.addEventListener('node_failed', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        id: string;
        reason: string;
      };
      append(`✗ ${data.id}: ${data.reason}`, 'failed');
    });

    source.addEventListener('node_writing', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        id: string;
        title?: string;
      };
      append(`→ escrevendo ${data.title ?? data.id}`, 'writing');
    });

    source.addEventListener('attachment_downloaded', () => {
      // discreet — could be a count later
    });

    source.addEventListener('extraction_done', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        pages: number;
        items: number;
        attachments: number;
      };
      setPhase(
        `Concluído: ${data.pages} páginas, ${data.items} itens, ${data.attachments} anexos.`,
      );
      source.close();
    });

    return () => source.close();
  }, [jobId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: log triggers scroll-to-bottom on append
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  return (
    <section>
      <h2>{phase}</h2>
      {summary && <p>{summary}</p>}
      <progress value={done} max={Math.max(total, 1)} />
      <p>
        {done}/{Math.max(total, 1)} nós
      </p>
      <pre className="log" ref={logRef}>
        {log.map((entry, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: log entries are append-only
          <div key={i} className={`log-line ${entry.cls}`}>
            {entry.text}
          </div>
        ))}
      </pre>
    </section>
  );
}
