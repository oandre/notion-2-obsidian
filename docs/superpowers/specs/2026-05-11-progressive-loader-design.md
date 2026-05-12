# Progressive Discovery + Extraction Loader — Design

**Data:** 2026-05-11
**Versão alvo:** v0.4 (sobre v0.3)
**Status:** Aprovado para implementação
**Predecessor:** [v0.3 design](./2026-05-11-hierarchical-picker-cache-design.md)

## 1. Problema

Hoje, ao abrir o picker pela primeira vez (cache miss), o usuário vê apenas um spinner com texto "Descobrindo o workspace…" — sem saber se a ferramenta está travada, quantas páginas já foram encontradas, ou em que parte do processo está. Durante a extração, o `ProgressView` mostra o id técnico dos nós (ex: `✓ p1`), sem o título, sem o total selecionado, e sem distinguir entre fases (renderizar blocos vs baixar anexos vs escrever no disco).

## 2. Objetivo

Fornecer feedback progressivo nas duas operações longas:

- **Descoberta** (`/api/tree` no cache miss): mostrar fases ("Listando workspace", "Mapeando 'Notas'", "Lendo database 'Tarefas'") + contador acumulado de nós descobertos.
- **Extração** (`/api/extract`): mostrar total selecionado, fase atual ("Renderizando", "Baixando anexos", "Escrevendo arquivos"), e progresso real (X/Y) em barra com numerador/denominador certos.

Não-objetivos: ETA estimado em tempo, cancelar operação no meio, pause/resume.

## 3. Decisões de produto

| Decisão | Escolha |
|---|---|
| Modelo do `/api/tree` no cache miss | Job-based (mesmo padrão de `/api/extract`): retorna `job_id`, frontend assina SSE |
| Modelo do `/api/tree` no cache hit | Inalterado — retorna `{ nodes, discoveredAt, cached: true }` imediatamente |
| Granularidade dos eventos de descoberta | Por fase + por raiz + por bloco descoberto |
| Granularidade dos eventos de extração | `extraction_planned` no início + `phase_started` por fase + per-node mantidos |
| Mostrar título do nó (não só id) na UI | Sim, no log da extração |
| Cancelamento | Out of scope |

## 4. Arquitetura

### 4.1 Mudança em `/api/tree`

```
GET /api/tree (refresh? bool)
  │
  ├── Cache hit? → return { nodes, discoveredAt, cached: true } (síncrono, inalterado)
  │
  └── Cache miss:
       1. cria EventBus + jobId
       2. inicia discoverWorkspace(client, bus) em background
       3. retorna { job_id, cached: false } imediatamente

GET /api/events?job=<id>
  → stream SSE com eventos de descoberta
  → último evento: tree_ready { nodes, discoveredAt }
  → frontend salva o tree em estado e troca a view
```

O servidor mantém o tree em `latestTree` (já existia) — quando `tree_ready` é emitido internamente, o handler de descoberta também escreve nessa variável e salva o cache, exatamente como hoje.

### 4.2 Eventos novos durante descoberta

| Evento | Payload | Quando |
|---|---|---|
| `discovery_started` | `{}` | (já existia) Início absoluto |
| `roots_listing` | `{}` | Antes do `POST /v1/search` |
| `roots_listed` | `{ count }` | `/v1/search` retornou — conhecemos quantas raízes |
| `root_started` | `{ id, title, kind }` | Iniciando o walk de uma raiz |
| `discovery_progress` | `{ discovered, currentRoot }` | A cada nó adicionado à árvore (page, db, db_item) |
| `root_done` | `{ id, title, pages, databases, dbItems }` | Raiz totalmente mapeada, com contagens |
| `discovery_done` | `{ total, byKind: { pages, databases, dbItems } }` | Última raiz acabou |
| `tree_ready` | `{ nodes: PlannedNode[], discoveredAt: string }` | Cache salvo, tree pronta para uso |

`discovery_progress` é emitido **uma vez para cada novo `PlannedNode` adicionado à árvore** — ou seja, sempre que `walkPage` ou `walkDatabase` cria um node filho. Não é emitido para cada bloco lido individualmente (isso poluiria o stream com milhares de eventos).

### 4.3 Eventos novos durante extração

| Evento | Payload | Quando |
|---|---|---|
| `extraction_started` | `{}` | Substitui o uso atual de `discovery_started` que não fazia sentido aqui. Início absoluto. |
| `extraction_planned` | `{ totalPages, totalDbItems, totalDatabases, totalNodes }` | Logo após calcular `effective` |
| `phase_started` | `{ name: 'render' \| 'download_and_write' }` | Início de cada fase |
| `node_started` | `{ id, title, kind }` | (já existia, agora carrega `title` + `kind`) Sempre durante fase `render` |
| `node_done` | `{ id }` | (já existia) Durante `render` |
| `node_failed` | `{ id, reason }` | (já existia) |
| `node_writing` | `{ id, title }` | Antes de escrever cada arquivo na fase `download_and_write` |
| `attachment_downloaded` | `{ url, path }` | (já existia) |
| `extraction_done` | `{ pages, items, attachments }` | (já existia) |

Observação: o pipeline atual emite `discovery_started`/`discovery_done` mesmo na extração, o que era cruft da v0.2. Remove-se.

### 4.4 Mudanças no backend

#### `discoverWorkspace(client, bus?)`

Hoje:
```ts
export async function discoverWorkspace(client: NotionClient): Promise<PlannedNode[]>
```

Depois:
```ts
export async function discoverWorkspace(
  client: NotionClient,
  bus?: EventBus,
): Promise<PlannedNode[]>
```

O `bus` é opcional para preservar testes existentes que não querem barulho de eventos. Quando presente, eventos são publicados nos pontos certos.

Internamente:
- Antes de `listSharedRoots`: `bus.publish({ kind: 'roots_listing', data: {} })`.
- Depois de `listSharedRoots`: `bus.publish({ kind: 'roots_listed', data: { count: roots.length } })`.
- Para cada raiz, antes de `discoverSubtree`: `bus.publish({ kind: 'root_started', data: { id, title, kind } })`.
- `discoverSubtree` ganha o `bus` propagado; emite `discovery_progress` para cada novo nó (page/db/db_item) que vai sendo adicionado.
- Depois de cada raiz: `bus.publish({ kind: 'root_done', data: { id, title, pages, databases, dbItems } })` (contagens derivadas do subtree).

#### `discoverSubtree(client, rootId, rootKind, bus?)`

Mesma assinatura ganha bus opcional. `walkPage` e `walkDatabase` passam adiante. Cada criação de novo `PlannedNode` filho dispara `discovery_progress`.

#### `runExtraction({ bus, outputDir, tree, selectedIds })`

Antes da render loop:
```ts
await bus.publish({ kind: 'extraction_started', data: {} });
const effective = expandSelectionToDescendants(new Set(selectedIds), tree);
const counts = countByKind(effective, tree);
await bus.publish({ kind: 'extraction_planned', data: counts });
await bus.publish({ kind: 'phase_started', data: { name: 'render' } });
```

Entre as duas loops:
```ts
await bus.publish({ kind: 'phase_started', data: { name: 'download_and_write' } });
```

Dentro da loop de write, antes de `writeFile`:
```ts
await bus.publish({ kind: 'node_writing', data: { id: node.id, title: node.title } });
```

`node_started` ganha `title` e `kind` no payload.

#### `/api/tree` handler

Pseudocódigo da nova versão:

```ts
fastify.get('/api/tree', async (req, reply) => {
  // (validation: settings.notionToken / outputDir)
  const refresh = req.query.refresh === 'true';
  const client = new NotionClient({ token: settings.notionToken });
  const roots = await listSharedRoots(client);
  const workspaceId = pickWorkspaceId(roots);

  if (!refresh) {
    const cached = await loadCache(settings.outputDir, workspaceId);
    if (cached) {
      latestTree = cached.nodes;
      return { nodes: cached.nodes, discoveredAt: cached.discoveredAt, cached: true };
    }
  } else {
    await invalidateCache(settings.outputDir);
  }

  // Cache miss → job-based
  const bus = new EventBus();
  const jobId = randomUUID();
  jobs.set(jobId, bus);

  void (async () => {
    await bus.publish({ kind: 'discovery_started', data: {} });
    try {
      const nodes = await discoverWorkspace(client, bus);
      const discoveredAt = new Date().toISOString();
      const tree = { version: 1, workspaceId, discoveredAt, nodes };
      try { await saveCache(settings.outputDir, tree); } catch {}
      latestTree = nodes;
      await bus.publish({ kind: 'tree_ready', data: { nodes, discoveredAt } });
    } catch (err) {
      await bus.publish({ kind: 'error', data: { message: String(err) } });
    }
  })();

  return { job_id: jobId, cached: false };
});
```

### 4.5 Mudanças no frontend

#### Tipo `ProgressEventKind`

`app/src/shared/types.ts` ganha:

```ts
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
```

#### `DiscoveryProgress`

Vira componente com estado próprio. Recebe `jobId` e assina `/api/events?job=<id>`. Exibe:

```
Mapeando o workspace…

[contagem]  47 nós encontrados
[fase]      Lendo database "Tarefas"
[última raiz] ✓ Notas (12 pages, 1 database)
```

Quando recebe `tree_ready`, chama um callback `onTreeReady(nodes, discoveredAt)` para o `TreeView` que então renderiza a árvore.

#### `TreeView`

Hoje chama `getTree()` no mount e popula `nodes` direto. Vira:

```ts
useEffect(() => {
  getTree().then((r) => {
    if (r.cached) {
      // cache hit — render immediately
      setNodes(r.nodes);
      setDiscoveredAt(r.discoveredAt);
    } else {
      // cache miss — show DiscoveryProgress with the job_id
      setDiscoveryJobId(r.job_id);
    }
  });
}, []);
```

A view de "loading" passa a ser o `DiscoveryProgress` com `jobId` e `onTreeReady`.

#### `ProgressView`

Recebe `totalNodes` via `extraction_planned` e mostra `done/total` na barra. Exibe a fase atual via `phase_started`. Log mostra título (não só id) para `node_started` / `node_done` / `node_writing` / `node_failed`. `attachment_downloaded` adiciona uma linha discreta.

### 4.6 Backwards-compat

O `bus` parâmetro em `discoverWorkspace` e `discoverSubtree` é opcional. Testes existentes que chamam `discoverWorkspace(client)` continuam funcionando — não recebem eventos, apenas o array.

`/api/tree` retorna agora dois shapes distintos:
- `{ nodes, discoveredAt, cached: true }` (cache hit)
- `{ job_id, cached: false }` (cache miss)

Frontend precisa lidar com os dois. Discriminável por `cached`.

## 5. UI mockup

### Discovery (cache miss)

```
┌─────────────────────────────────────────────┐
│ Mapeando o workspace…                       │
│                                             │
│ [██████████████░░░░░░░░░░░░░░░░] indeterm.  │
│                                             │
│ 47 nós encontrados                          │
│ Lendo database "Tarefas" (38 items)         │
│                                             │
│ ✓ Notas (12 pages, 1 database)              │
│ ✓ Projetos (8 pages)                        │
│ ⟳ Tarefas (em progresso)                    │
└─────────────────────────────────────────────┘
```

### Extraction

```
┌─────────────────────────────────────────────┐
│ Extraindo 30 nós (24 páginas, 5 items, 1 db)│
│                                             │
│ [████████████░░░░░░░░░░░░░] 14/30           │
│                                             │
│ Fase: Renderizando blocos                   │
│                                             │
│ ✓ Reunião 2026-01-15                        │
│ ✓ Nota sobre arquitetura                    │
│ ✓ Fazer X                                   │
│ ⟳ Lista de tarefas                          │
└─────────────────────────────────────────────┘
```

## 6. Testes

- `progress.test.ts` — já existe. Adicionar testes para a serialização SSE dos novos eventos (e.g., `roots_listing`, `tree_ready`, `extraction_planned`).
- `discovery.test.ts` — novo teste que injeta um `EventBus`, coleta eventos publicados, e verifica que `roots_listed { count: N }` é emitido e que `root_done` traz contagens certas.
- `pipeline.test.ts` — adicionar verificação de que `extraction_planned` é publicado com os totais corretos e que `phase_started` aparece duas vezes (render + download_and_write).
- `app.test.ts` — atualizar `/api/tree` test para o novo contrato (cache miss retorna `{ job_id, cached: false }`).
- `DiscoveryProgress.test.tsx` — novo componente, novo teste. Mocka `EventSource` e dispara eventos sintéticos; verifica que o texto atualiza.
- `ProgressView` (manual smoke ou teste unitário leve) — verifica que a fase muda quando `phase_started` chega.

## 7. Tratamento de erros

| Cenário | Comportamento |
|---|---|
| Discovery falha no meio (ex: API 500) | Bus emite `error { message }`; frontend mostra erro e oferece botão "Tentar novamente" (chama `refreshTree()`) |
| `tree_ready` nunca chega (timeout indeterminado) | Sem timeout artificial; usuário pode fechar a aba ou clicar refresh |
| `EventSource` desconecta no meio | Mostra erro inline com botão "Tentar novamente" que chama `refreshTree()` para reiniciar do zero. Sem reconexão automática complexa. |
| Cache válido em paralelo: usuário clicou Refresh enquanto outra discovery rodava | Cancela a anterior? Não. Inicia uma nova e ignora a anterior (a nova invalida o cache que a anterior estava prestes a escrever). Aceitável; raro. |

## 8. Out of scope

- ETA / estimativa de tempo restante
- Cancelar descoberta ou extração no meio
- Pause / resume
- Eventos de progresso mais granulares ainda (por bloco baixado, por parágrafo renderizado)
- Reconexão automática do `EventSource` em loop infinito

## 9. Estrutura de arquivos (mudanças)

```
app/
├── src/
│   ├── server/
│   │   ├── app.ts                            # MODIFIED (/api/tree → job-based on miss)
│   │   ├── notion/discovery.ts               # MODIFIED (bus param)
│   │   └── extract/pipeline.ts               # MODIFIED (phase events + planned)
│   ├── shared/types.ts                       # MODIFIED (new ProgressEventKind values)
│   └── web/
│       ├── api.ts                            # MODIFIED (getTree returns union shape)
│       └── components/
│           ├── DiscoveryProgress.tsx         # REWRITTEN (subscribes to events)
│           ├── DiscoveryProgress.test.tsx    # NEW
│           ├── TreeView.tsx                  # MODIFIED (handles cached vs jobId)
│           └── ProgressView.tsx              # MODIFIED (totals + phase + titles)
```
