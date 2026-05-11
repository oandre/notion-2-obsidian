import { useEffect, useState } from 'react';
import { getStatus } from './api.js';
import { ProgressView } from './components/ProgressView.js';
import { SetupView } from './components/SetupView.js';
import { TreeView } from './components/TreeView.js';

type View =
  | { name: 'loading' }
  | { name: 'setup' }
  | { name: 'selection' }
  | { name: 'progress'; jobId: string };

export function App() {
  const [view, setView] = useState<View>({ name: 'loading' });

  useEffect(() => {
    getStatus()
      .then((status) => setView(status.tokenConfigured ? { name: 'selection' } : { name: 'setup' }))
      .catch(() => setView({ name: 'setup' }));
  }, []);

  return (
    <div className="app">
      <header>
        <h1>notion-2-obsidian</h1>
        <p className="subtitle">Migre seu workspace do Notion para o Obsidian.</p>
      </header>
      <main>
        {view.name === 'loading' && <p>Carregando…</p>}
        {view.name === 'setup' && <SetupView onDone={() => setView({ name: 'selection' })} />}
        {view.name === 'selection' && (
          <TreeView onStart={(jobId) => setView({ name: 'progress', jobId })} />
        )}
        {view.name === 'progress' && <ProgressView jobId={view.jobId} />}
      </main>
    </div>
  );
}
