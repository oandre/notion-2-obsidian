# Progressive Tree (drill-down during discovery) — Design

**Data:** 2026-05-11
**Versão alvo:** v0.5 (sobre v0.4)
**Status:** Aprovado para implementação direta na `main`
**Predecessor:** [v0.4 progressive loader](./2026-05-11-progressive-loader-design.md)

## 1. Problema

Hoje há duas telas: `DiscoveryProgress` (loader) enquanto a descoberta roda, depois `TreeView` (picker hierárquico) quando termina. Em workspaces grandes (78+ raízes), o usuário fica esperando minutos até ver QUALQUER coisa do conteúdo dele. Ele nem sabe quais páginas vão estar lá até o fim.

## 2. Objetivo

Unificar discovery + picker em uma só tela: o **TreeView aparece desde o segundo zero** e cresce conforme cada raiz é mapeada. O usuário pode expandir, marcar e até clicar **Extrair** enquanto outras raízes ainda estão sendo descobertas.

Não-objetivos: cancelar descoberta em andamento, pause/resume, drill-down lazy (do tree para os filhos).

## 3. Decisões de produto

| Decisão | Escolha |
|---|---|
| Componente | TreeView absorve tudo; `DiscoveryProgress.tsx` é removido |
| Extrair durante a descoberta | Permitido — opera sobre o que já está em `latestTree` |
| Raízes ainda em andamento | Visíveis como linhas desabilitadas, com indicador `⟳` ou `⋯` |
| Cancelamento ou refresh durante a descoberta | Refresh começa do zero; descoberta anterior fica órfã (continua silenciosa, resultado descartado) |
| Payload de tree no frontend | "Light" (sem `blocks`/`pageData`) — frontend nunca precisou disso |

## 4. Arquitetura

### 4.1 Fluxo

```
abre app → GET /api/tree
   │
   ├── cache hit → { cached: true, nodes (light), discoveredAt }
   │               TreeView renderiza imediato, sem status bar
   │
   └── cache miss → { cached: false, job_id }
                       │
                       ▼
                    TreeView monta vazio + status bar visível
                    Assina /api/events?job=<id>
                       │
                       ├── roots_listed { count }
                       │     → "Descobrindo: 0/N raízes"
                       │
                       ├── root_started { id, title, kind }
                       │     → adiciona raiz como "waiting" (placeholder no tree)
                       │
                       ├── discovery_progress { currentRoot, … }
                       │     → promove para "active"
                       │
                       ├── root_completed { id, title, pages, databases,
                       │                    dbItems, subtree: LightNode[] }
                       │     → injeta subgrafo no `nodes` state; raiz fica
                       │       interativa (chevron, checkbox)
                       │
                       ├── root_failed { id, title, reason }
                       │     → marca raiz com ✗ + motivo
                       │
                       └── tree_ready { discoveredAt }
                             → status bar some; cache salvo no backend
```

### 4.2 Tipos compartilhados

`app/src/shared/types.ts` ganha:

```ts
export interface LightNode {
  id: string;
  kind: NodeKind;
  title: string;
  parentId: string | null;
  childrenIds: string[];
}
```

`PlannedNode` permanece a forma "full" (com `blocks`, `pageData`) usada pelo backend para extração e pelo cache em disco. **Light** é o subset enviado ao frontend.

### 4.3 Evento `root_completed`

Substitui o `root_done` atual:

```ts
// data
{
  id: string;
  title: string;
  pages: number;
  databases: number;
  dbItems: number;
  subtree: LightNode[];  // todos os nós descobertos sob essa raiz, sem blocks/pageData
}
```

Tamanho típico: ~5-30 KB por raiz, dependendo de quantos descendentes tem. Aceitável para SSE.

### 4.4 Mudanças no backend

#### `discoverWorkspace`

Ganha uma callback opcional `onRootCompleted`:

```ts
export async function discoverWorkspace(
  client: NotionClient,
  bus?: EventBus,
  onRootCompleted?: (subtree: PlannedNode[]) => Promise<void> | void,
): Promise<PlannedNode[]>
```

Dentro do `Promise.all` por raiz, depois de `discoverSubtree` retornar com sucesso:

1. Chama `onRootCompleted(subtree)` (com nós FULL — backend usa para popular `latestTree`)
2. Emite `root_completed` no bus com o subtree mapeado para LIGHT (sem blocks/pageData)

O evento `root_done` antigo é renomeado para `root_completed` e ganha o payload `subtree`.

#### `/api/tree` (handler)

Cache miss: ANTES de disparar o background job, reseta `latestTree = []` (não null) para descartar conteúdo do job anterior (especialmente importante no caminho de refresh). Passa callback que faz `latestTree = [...latestTree, ...subtree]` a cada raiz completa. Resultado: `/api/extract` chamado em qualquer momento depois do primeiro `root_completed` enxerga os nós já prontos.

Cache hit: retorna `{ cached: true, nodes: LightNode[], discoveredAt }` (converte os PlannedNodes do cache para LightNode em serialização — JSON.stringify em PlannedNode é wasteful porque `blocks`/`pageData` viajariam de graça).

#### `tree_ready` event

Simplifica para `{ discoveredAt: string }`. O frontend já tem todos os nós via `root_completed`. O cache em disco é salvo pelo backend antes desse evento. O evento apenas sinaliza "descoberta acabou, status bar pode sumir".

### 4.5 Mudanças no frontend

#### TreeView reformulado

Estados:
- `discoveryStatus: 'cached' | 'discovering' | 'done' | 'error'`
- `nodes: LightNode[]` (cresce incrementalmente)
- `rootStatus: Map<string, 'waiting' | 'active' | 'done' | 'failed'>` (UI estado por raiz)
- Selected / expanded sets continuam como hoje
- `discoveryMeta: { total, completed, active, waiting }` derivado de rootStatus

Render:
```
┌──────────────────────────────────────────────┐
│ O que migrar?                  [↻ Refresh]   │
│ ⟳ Descobrindo: 3/78 raízes · 47 nós          │ ← só quando status === 'discovering'
│ [==========>          ] 3/78                 │
│   Mapeando "Catálogo Bosch"                  │
├──────────────────────────────────────────────┤
│ [Expandir tudo] [Recolher tudo] [Limpar]     │
│                                              │
│ ▾ ☑ 🗃️ Arquivo (77 pages, 32 db, 260 items)  │
│   ▸ ☐ 📄 Tier Mecânicas                      │
│   ▸ ☐ 📄 Outros documentos                   │
│ ▸ ☐ 📄 Mecanizou                             │
│ ⟳ Engenharia (em descoberta…)                │ ← raiz active, checkbox disabled
│ ⋯ Untitled (aguardando…)                     │ ← raiz waiting, checkbox disabled
│ ✗ Product Hub — pulada: Headers Timeout      │
│                                              │
│ [Extrair selecionados (4)]                   │
└──────────────────────────────────────────────┘
```

Raízes ainda não-completas: `TreeNode` recebe uma prop `disabled` que oculta o checkbox e mostra um indicador (`⟳` active / `⋯` waiting). Quando `root_completed` chega, a raiz vira interativa normal.

#### TreeNode

Pequeno ajuste: aceita `disabled: boolean`. Se true, renderiza marker de status e não chama os handlers de toggle.

#### App.tsx

Não troca mais entre views. O `App` sempre renderiza `TreeView` (depois de `setup`). `TreeView` lida com os dois modos internamente.

#### Componentes removidos

`DiscoveryProgress.tsx` e `DiscoveryProgress.test.tsx` são removidos. CSS específico (`.discovery-progress *`) é movido para o TreeView ou descartado.

### 4.6 API HTTP (sem mudança de contrato)

`/api/tree` continua retornando o union `{ cached: true; nodes; discoveredAt } | { cached: false; job_id }`. A única mudança interna: `nodes` no cache-hit agora é serializado como LightNode (sem blocks/pageData) para reduzir tamanho da resposta.

`/api/extract` opera em `latestTree` em qualquer momento. Se `selectedIds` referencia um nó que NÃO está em `latestTree` ainda (improvável — UI só permite marcar nós que vieram via root_completed), o pipeline simplesmente ignora (planPaths não terá esse id).

### 4.7 Refresh durante descoberta

Se o usuário clica Refresh no meio:
- Frontend chama `/api/tree?refresh=true`
- Backend invalida cache, cria novo job_id, dispara nova descoberta em background
- A descoberta anterior continua rodando (não cancelamos), mas o bus dela fica sem subscribers — eventos viram no-ops; quando termina, `saveCache` sobrescreve com resultado parcial... HMMM, race condition.

**Mitigação simples:** o backend mantém um contador global `discoveryGen` que incrementa a cada `/api/tree?refresh=true`. Cada job captura seu `gen` no início e checa antes de chamar `saveCache` / atribuir a `latestTree`. Se o gen mudou, o resultado é descartado.

```ts
const myGen = ++discoveryGen;
// ... discoverWorkspace ...
if (myGen === discoveryGen) {
  await saveCache(...);
  latestTree = nodes;
  await bus.publish({ kind: 'tree_ready', ... });
}
// else: silently discard
```

## 5. Estrutura de arquivos (mudanças)

```
app/
├── src/
│   ├── shared/types.ts                       # NEW: LightNode type
│   ├── server/
│   │   ├── app.ts                            # MODIFIED (incremental latestTree, light cache-hit, gen counter)
│   │   ├── app.test.ts                       # MODIFIED
│   │   └── notion/discovery.ts               # MODIFIED (root_completed event, onRootCompleted callback)
│   │   └── notion/discovery.test.ts          # MODIFIED
│   └── web/
│       ├── api.ts                            # MODIFIED (TreeResponse uses LightNode)
│       └── components/
│           ├── DiscoveryProgress.tsx         # DELETED
│           ├── DiscoveryProgress.test.tsx    # DELETED
│           ├── TreeView.tsx                  # REWRITTEN (absorbs discovery)
│           ├── TreeView.test.tsx             # MODIFIED
│           └── TreeNode.tsx                  # MODIFIED (disabled prop)
```

## 6. Testes

- `discovery.test.ts` — atualizar teste de evento: agora verifica `root_completed { …, subtree: LightNode[] }` em vez de `root_done`. Verifica que `onRootCompleted` callback é chamada com PlannedNode[] full.
- `app.test.ts` — atualizar contract test: `/api/extract` funciona depois de receber só PARTE do tree (uma chamada parcial). Verifica que `discoveryGen` descarta jobs órfãos no refresh.
- `TreeView.test.tsx` — novo teste: monta com `job_id`, recebe `root_completed`, verifica que a raiz aparece interativa; extract dispara com selectedIds parciais.
- `DiscoveryProgress.test.tsx` — deletado.

## 7. Tratamento de erros

| Cenário | Comportamento |
|---|---|
| `root_completed` carrega subtree malformado | Frontend valida shape básico; descarta a raiz e mostra como failed |
| `root_failed` antes de qualquer subtree | Raiz aparece com ✗ + motivo, sem nó no tree |
| `tree_ready` nunca chega (timeout indeterminado) | Status bar fica visível indefinidamente; usuário pode clicar Refresh |
| EventSource desconecta no meio | Mostra erro + botão "Tentar novamente" → refresh |
| Extract no meio com 0 selecionados | Botão fica desabilitado, mesma lógica de hoje |

## 8. Out of scope

- Cancelar descoberta em andamento (job órfão continua rodando até acabar — só o resultado é descartado)
- Pause / resume
- Lazy load de filhos sob demanda na UI (raízes completam tudo de uma vez)
- Drill-down de linhas individuais de database
