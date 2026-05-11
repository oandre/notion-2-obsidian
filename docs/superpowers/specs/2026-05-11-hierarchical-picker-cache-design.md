# Hierarchical Picker + Workspace Tree Cache — Design

**Data:** 2026-05-11
**Versão alvo:** v0.3 (sobre v0.2)
**Status:** Aprovado para implementação
**Predecessor:** [v0.2 design](./2026-05-11-node-rewrite-design.md)

## 1. Problema

Na v0.2 o picker é uma lista chata de tudo o que a integração enxerga: workspaces médios produzem 50+ entradas misturando páginas raiz, sub-páginas e linhas de databases. Difícil ter ideia do que está sendo migrado.

Além disso, toda execução refaz discovery do zero — a varredura completa do workspace pode levar dezenas de segundos. Isso é fricção quando o usuário só quer iterar nas escolhas.

## 2. Objetivo

- Picker hierárquico: usuário consegue ver e navegar na estrutura do workspace, marcar/desmarcar em qualquer nível.
- Persistir a árvore descoberta em disco para que execuções subsequentes não esperem pela API do Notion.
- "Refresh" explícito para re-varrer quando a estrutura no Notion mudou.

Não-objetivos: caching do conteúdo extraído (markdown final), TTL automático, drill-down em linha individual de database.

## 3. Decisões de produto

| Decisão | Escolha |
|---|---|
| Caching | Só a árvore (nodes + blocks + pageData), não o markdown gerado |
| Modo do picker | Eager: discovery completa carrega tudo, cache torna recarrega instantânea |
| Refresh | Manual via botão; sem TTL nem auto-refresh |
| Granularidade de seleção | Páginas até a folha; databases atômicas (selecionar database = todas as linhas) |
| Local do cache | `<OUTPUT_DIR>/.notion-2-obsidian-cache.json` (junto do vault) |
| Invalidacão | Versionado por `version: 1`; mudança de workspace invalida automaticamente |

## 4. Arquitetura

### 4.1 Fluxo

```
┌──────────────────────────────────────────────────────────┐
│ App abre / Setup pronto                                  │
│   │                                                      │
│   ▼                                                      │
│ GET /api/tree                                            │
│   ├── Tem cache? → carrega de disco → 200 instantâneo    │
│   └── Não tem  → discovery completa (SSE de progresso)   │
│                  → salva cache → 200                     │
│   │                                                      │
│   ▼                                                      │
│ TreeView (hierárquico, com checkbox)                     │
│   ├── Usuário expande/colapsa nós                        │
│   ├── Usuário marca/desmarca em qualquer nível           │
│   ├── Botão Refresh → GET /api/tree?refresh=true         │
│   └── Botão Extrair                                      │
│         │                                                │
│         ▼                                                │
│ POST /api/extract { selectedIds }                        │
│   └── Servidor já tem tree em memória/cache              │
│       → pula discovery, vai direto para render+resolve   │
└──────────────────────────────────────────────────────────┘
```

### 4.2 Mudanças no pipeline

Hoje `runExtraction` faz tudo: discovery + render + write. Vamos separar:

- **`discoverWorkspace(client)`** — Nova função pública em `notion/discovery.ts`. Internamente: chama `listSharedRoots` para obter as raízes (parent.type === workspace), depois `discoverSubtree` em cada uma, e concatena os resultados em um único `PlannedNode[]`. Cada nó leva `blocks` e `pageData` cacheados.
- **`runExtraction({ tree, selectedIds, ... })`** — Recebe a árvore já descoberta + os ids que o usuário marcou. Computa o subconjunto efetivo (ver §4.2.1 abaixo), renderiza com placeholders, baixa anexos, escreve `_report.md`. Não faz nenhuma chamada de discovery à API.

`PlannedNode` permanece a mesma estrutura — vai bem para serialização JSON do cache.

#### 4.2.1 Regra de seleção e estrutura de saída

Selecionar um nó implica seus descendentes (sub-páginas, linhas de database). E também implica que seus **ancestrais até a raiz** entram no output, mas **apenas como pastas** — sem `.md` gerado para eles. Isso preserva o caminho do Notion no vault, mesmo que o usuário só queira páginas profundas.

Concretamente: se o usuário marca `Notas/Reuniões/2026-01-15` (nó folha) sem marcar os pais:
- Output: `Notas/Reuniões/2026-01-15.md` é escrito.
- `Notas.md` e `Reuniões.md` **não** são escritos.
- A pasta `Notas/Reuniões/` é criada implicitamente porque o arquivo dentro dela existe.

Algoritmo:
1. `effectiveIds = expandWithDescendants(selectedIds, tree)` — adiciona descendentes.
2. `ancestorIds = collectAncestors(effectiveIds, tree)` — só para garantir que `planPaths` calcule corretamente os caminhos. Mas só os nós em `effectiveIds` são renderizados e escritos.
3. `planPaths(allNodesInTreeReachable, outputDir)` — usa a árvore completa para resolver paths corretamente; a função já lida bem com nós que existem na árvore mas cujo `.md` pode não ser produzido.

### 4.3 Cache em disco

Arquivo `<OUTPUT_DIR>/.notion-2-obsidian-cache.json`:

```json
{
  "version": 1,
  "workspaceId": "abc-123",
  "discoveredAt": "2026-05-11T17:32:00.000Z",
  "nodes": [
    {
      "id": "page-1",
      "kind": "page",
      "title": "Notas",
      "parentId": null,
      "childrenIds": ["sub-1", "db-1"],
      "blocks": [ /* raw Notion blocks */ ],
      "pageData": { /* raw Notion page object */ }
    }
  ]
}
```

`workspaceId` é extraído do primeiro resultado de `/search` (`results[0].parent.workspace_id` quando disponível, senão null). Se token aponta para outro workspace na próxima execução, cache é descartado.

Tamanho típico esperado: ~100 KB para 50 nós; ~5 MB para um workspace com 500 nós (blocos inclusos). Aceitável para JSON.

### 4.4 Componente de cache

Novo módulo `app/src/server/cache.ts`:

```ts
loadCache(outputDir: string): CachedTree | null
saveCache(outputDir: string, tree: CachedTree): Promise<void>
invalidateCache(outputDir: string): Promise<void>
```

Encapsula leitura/escrita do JSON. Validação de versão e workspaceId acontece aqui. Falhas de I/O (permissão, JSON malformado) são tratadas como "sem cache".

### 4.5 API HTTP

Endpoint antigo `/api/roots` é **removido** (substituído).

| Método | Path | Comportamento |
|---|---|---|
| GET | `/api/status` | (inalterado) |
| POST | `/api/setup` | (inalterado) |
| GET | `/api/tree` | Se cache válido existe, retorna. Senão, faz discovery completa, cacheia, retorna. Query `?refresh=true` força re-fetch. Discovery roda em background com job_id para acompanhar via SSE. |
| GET | `/api/events?job=<id>` | (inalterado em formato — agora também recebe eventos de discovery em standalone) |
| POST | `/api/extract` | Body agora `{ selectedIds: string[] }`. Servidor tem a árvore em memória de uma chamada prévia a `/api/tree`. |

Estado do servidor: `latestTree: CachedTree | null` em memória, populado por `/api/tree`. `/api/extract` lê dali. Se ausente, retorna 412.

### 4.6 Eventos SSE (novos)

Já existentes continuam. Adicionar:

- `discovery_started` `{}` (já existe)
- `discovery_progress` `{ discovered: number }` (já existe, agora reusado por /api/tree)
- `discovery_done` `{ total: number }` (já existe)

Nenhum evento novo necessário.

## 5. Mudanças no frontend

### 5.1 `TreeView` recursivo

Cada nó renderiza:

```
[chevron] [checkbox] [icon] Título
   └─ se expandido e tem filhos: subcomponente recursivo com indent
```

Estado:
- `expanded: Set<string>` — quais ids estão expandidos
- `selected: Set<string>` — quais ids estão marcados (representa "este nó e seus descendentes vão")
- Marcação parcial: se um pai NÃO está em `selected` mas algum descendente está, mostra checkbox em estado "indeterminate".

Regra de seleção:
- Clicar no checkbox do pai marca/desmarca o pai e propaga para descendentes (limpa qualquer marcação parcial neles, todos ficam coerentes).
- Para fine-grained, usuário expande e desmarca filhos individualmente.

### 5.2 Header da `TreeView`

```
┌──────────────────────────────────────────────┐
│ O que migrar?                                │
│ Última atualização: 2026-05-11 17:32  [↻]    │
│ [Expandir tudo] [Selecionar tudo] [Limpar]   │
└──────────────────────────────────────────────┘
```

`[↻]` = botão Refresh. Confirma com modal antes de invalidar (porque pode demorar). Durante o refresh, mostra a barra de progresso.

### 5.3 Estado de loading

`TreeView` no momento de descoberta inicial (sem cache):

```
Descobrindo workspace…
Descobertos 42 nós
[============>          ] indeterminate
```

Quando recebe `discovery_done`, troca para a árvore.

## 6. Estrutura de arquivos (mudanças)

```
app/
├── src/
│   ├── server/
│   │   ├── cache.ts                       # NOVO
│   │   ├── cache.test.ts                  # NOVO
│   │   ├── app.ts                         # routes mudam: /api/roots → /api/tree
│   │   ├── extract/pipeline.ts            # runExtraction aceita tree + selectedIds
│   │   └── notion/discovery.ts            # discoverWorkspace exportado
│   └── web/
│       ├── api.ts                         # getRoots() → getTree() / refreshTree()
│       └── components/
│           ├── TreeView.tsx               # reescreve recursivo
│           ├── TreeNode.tsx               # NOVO — componente recursivo por nó
│           └── DiscoveryProgress.tsx      # NOVO — barra de progresso
```

`PlannedNode` em `shared/types.ts` permanece igual.

## 7. Tratamento de erros

| Cenário | Comportamento |
|---|---|
| Cache existe mas JSON malformado | Trata como ausente; faz discovery |
| Cache `version` antiga | Trata como ausente; faz discovery |
| Cache `workspaceId` ≠ workspace atual | Trata como ausente; faz discovery |
| Permissão de escrita no `OUTPUT_DIR` falha ao salvar | Log warning, continua sem cache (extração roda) |
| Discovery falha no meio | Sem cache parcial: ou completa e salva, ou aborta e mantém cache anterior se existir |
| `/api/extract` chamado sem `latestTree` em memória | 412 Precondition Required ("call /api/tree first") |

## 8. Testes

- `cache.test.ts`:
  - `loadCache` retorna null se arquivo ausente / JSON inválido / version diferente / workspaceId diferente
  - `saveCache` grava JSON válido com `version: 1`, `discoveredAt` ISO, `workspaceId`
  - `invalidateCache` remove o arquivo (idempotente se não existe)
- `discovery.test.ts`:
  - Atualizar para usar `discoverWorkspace` (renomeado de `discoverSubtree`, sem `rootId`/`rootKind` — varre todo o /search)
- `pipeline.test.ts`:
  - `runExtraction` aceita `{ tree, selectedIds }` e roda só render+resolve
  - Selecionar um pai inclui descendentes automaticamente; selecionar descendente sem pai inclui também subgráfico do descendente
- `app.test.ts`:
  - `/api/tree` retorna do cache se existe
  - `/api/tree?refresh=true` força nova discovery
  - `/api/extract` retorna 412 sem chamada prévia a `/api/tree`
  - `/api/extract` filtra a árvore para os ids selecionados + descendentes

## 9. Migração de v0.2 → v0.3

Para usuários que já fizeram migração com v0.2 e atualizaram para v0.3:

- Caches anteriores não existem → primeira execução da v0.3 faz discovery (mesmo comportamento que v0.2)
- Estrutura do output `<OUTPUT_DIR>/...` é a mesma. Nenhum arquivo existente é tocado pela introdução do cache.

Sem breaking changes que afetem o usuário final além do contrato de API (que é interno).

## 10. Performance esperada

- Primeira execução: tempo de discovery atual da v0.2 + ~50ms de I/O para salvar cache (negligível).
- Execuções subsequentes: ~10-50ms para carregar cache JSON. Picker aparece instantâneo.
- Refresh manual: igual primeira execução.
- Tamanho do cache: ~30 KB por 10 páginas com blocos típicos. Workspaces grandes (~500 nós) ficam em poucos MB. Confortável.

## 11. Out of scope (próximas versões)

- Caching do markdown gerado (incremental sync) — explicitamente removido pelo usuário do escopo.
- TTL/auto-invalidação por `last_edited_time` agregado.
- Drill-down de linhas de database individualmente.
- Múltiplos workspaces em simultâneo no mesmo OUTPUT_DIR.
- Compactação do cache (gzip).
