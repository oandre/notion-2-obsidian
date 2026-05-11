import { useEffect, useRef, useState } from 'react';

interface Props {
  jobId: string;
}

type LogEntry = { text: string; cls: 'done' | 'failed' | '' };

export function ProgressView({ jobId }: Props) {
  const [status, setStatus] = useState('Iniciando…');
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const source = new EventSource(`/api/events?job=${encodeURIComponent(jobId)}`);
    const append = (text: string, cls: LogEntry['cls'] = '') =>
      setLog((prev) => [...prev, { text, cls }]);

    source.addEventListener('discovery_started', () => append('Descoberta iniciada'));
    source.addEventListener('discovery_done', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setTotal(d.total);
      setStatus(`Descobertos ${d.total} nós. Extraindo…`);
      append(`Descobertos ${d.total} nós`);
    });
    source.addEventListener('node_done', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setDone((n) => n + 1);
      append(`✓ ${d.id}`, 'done');
    });
    source.addEventListener('node_failed', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      append(`✗ ${d.id}: ${d.reason}`, 'failed');
    });
    source.addEventListener('extraction_done', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setStatus(`Concluído: ${d.pages} páginas, ${d.items} itens, ${d.attachments} anexos.`);
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
      <h2>{status}</h2>
      <progress value={done} max={Math.max(total, 1)} />
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
