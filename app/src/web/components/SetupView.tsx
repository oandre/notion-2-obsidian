import { type FormEvent, useState } from 'react';
import { postSetup } from '../api.js';

interface Props {
  onDone: () => void;
}

export function SetupView({ onDone }: Props) {
  const [token, setToken] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !!token && !!outputDir && !busy;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postSetup(token, outputDir);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      <h2>Configuração</h2>
      <p>
        Crie uma internal integration em{' '}
        <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer">
          notion.so/profile/integrations
        </a>
        , compartilhe as páginas com ela, e cole o token aqui.
      </p>
      <label>
        Notion token
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} />
      </label>
      <label>
        Pasta de saída (caminho absoluto)
        <input
          type="text"
          value={outputDir}
          onChange={(e) => setOutputDir(e.target.value)}
          placeholder="/Users/voce/Obsidian/Vault"
        />
      </label>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <button type="submit" disabled={!canSubmit}>
        {busy ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  );
}
