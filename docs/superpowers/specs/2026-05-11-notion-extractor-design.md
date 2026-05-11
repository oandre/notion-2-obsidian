# Notion → Obsidian Extractor — Design

**Data:** 2026-05-11
**Status:** Aprovado para implementação

## 1. Objetivo

Migrar conteúdo de um workspace Notion para um vault Obsidian, com fidelidade alta o suficiente para abandonar o Notion. O usuário deve poder:

- Conectar ao Notion via API oficial (integration token).
- Ver as páginas e databases compartilhados com a integração e selecionar quais extrair.
- Receber um vault Obsidian (pasta no disco) com Markdown limpo, wikilinks resolvidos entre o que foi extraído, anexos baixados localmente, e um relatório do que apontou para fora da seleção.

Não-objetivos: sincronização incremental (cada execução sobrescreve), edição bidirecional, suporte a múltiplos workspaces simultâneos.

## 2. Decisões de produto

| Decisão | Escolha |
|---|---|
| Fonte | API oficial do Notion |
| Linguagem | Python 3.11+ |
| UI | App web local (FastAPI serve HTML/JS estático em `localhost`) |
| Seleção | Árvore navegável no navegador, marcação por checkbox |
| Databases | Pasta por database, um `.md` por linha, properties → frontmatter YAML |
| Anexos | Baixados para `assets/`, links reescritos para caminhos relativos |
| Execução | One-shot repetível: cada run apaga o output e regenera tudo |
| Links internos | Wikilinks `[[Página]]` + relatório de links para fora da seleção |
| Blocos | Callouts → `> [!note]`, toggles → `<details>`, code com linguagem preservada, embeds nativos quando suportados, LaTeX `$...$` / `$$...$$` |
| Páginas com filhos | Página-folha = `Nome.md`. Página com subpáginas/database = `Nome.md` + pasta irmã `Nome/` |

## 3. Arquitetura

Processo Python único. FastAPI serve a UI e a API local. Toda a extração roda em background tasks do próprio processo, comunicando progresso via Server-Sent Events.

```
┌─────────────────────────────────────────┐
│  Navegador (vanilla JS)                 │
│    ├── Árvore de seleção (GET /tree)    │
│    ├── Start (POST /extract)            │
│    └── Progress (EventSource /events)   │
└────────────────┬────────────────────────┘
                 │  HTTP / SSE
┌────────────────▼────────────────────────┐
│  FastAPI app (uvicorn, asyncio)         │
│    ├── routes/                          │
│    ├── progress bus (asyncio.Queue)     │
│    └── extraction pipeline ▼            │
└────────────────┬────────────────────────┘
                 │
       ┌─────────┴──────────┐
       ▼                    ▼
   Notion API           Sistema de arquivos
   (rate-limited        (vault de saída)
    httpx pool)
```

### 3.1 Pipeline em 3 fases

A escolha pelas 3 fases vem de uma propriedade crítica: **wikilinks só podem ser resolvidos depois que todos os caminhos de saída são conhecidos**. Misturar descoberta com escrita força lookups parciais e gera falsos quebrados.

1. **Discovery.** Listar raízes via `POST /v1/search` (Notion retorna tudo compartilhado com a integração). Para cada raiz selecionada na UI, anda recursivamente: páginas via `GET /v1/blocks/{id}/children` (filtrando blocos do tipo `child_page` / `child_database`), databases via `POST /v1/databases/{id}/query`. Constrói um `dict[notion_id → PlannedNode]` com tipo, título, hierarquia e caminho de saída final calculado pelas regras de mapeamento (seção 4). Faz isso *antes* de buscar conteúdo.

2. **Extraction.** Para cada nó do mapa, busca blocos (páginas) ou properties + blocos (itens de database). Converte cada bloco para Markdown produzindo *placeholders* para links internos (`{{notion-link:<id>}}`) e anexos (`{{notion-asset:<url>}}`). Enfileira downloads de anexos.

3. **Write & resolve.** Para cada nó, substitui placeholders: `notion-id` vira wikilink usando o mapa da fase 1 (se o id não está no mapa → vai pro relatório de quebrados); `notion-asset` vira caminho relativo após o download terminar. Escreve os `.md` no disco. Gera `_report.md` no root do vault.

### 3.2 Concorrência e rate limit

- A API do Notion limita a ~3 req/s por integração. Um `asyncio.Semaphore(3)` envolve cada chamada à API.
- Downloads de anexos (URLs do S3 da Notion) não contam contra esse limite. Pool separado: `Semaphore(8)` + `httpx.AsyncClient`.
- Retry com backoff exponencial em 429 e 5xx (até 5 tentativas).
- Falhas por nó são isoladas: se uma página falha, o pipeline continua e a falha vira linha no relatório.

### 3.3 Comunicação de progresso

Evento por mudança relevante: `discovery_started`, `discovery_progress`, `discovery_done`, `node_started`, `node_done`, `node_failed`, `attachment_downloaded`, `extraction_done`. O front renderiza barra de progresso (`done/total`) e um log rolante. SSE em vez de WebSocket porque o tráfego é só servidor→cliente; HTTP keep-alive resolve.

## 4. Mapeamento Notion → Obsidian

### 4.1 Estrutura de arquivos

```
vault/
├── _report.md                       # relatório da execução
├── assets/                          # imagens, PDFs, etc.
│   └── <hash>-<nome-original>       # nomes seguros, sem colisão
├── Notas/                           # pasta selecionada
│   ├── Notas.md                     # conteúdo próprio da página raiz
│   ├── Sub-página sem filhos.md
│   └── Sub-página com filhos/
│       ├── Sub-página com filhos.md
│       └── Mais um nível.md
└── Tarefas/                         # database selecionada
    ├── Tarefas.md                   # descrição do db + tabela linkando cada linha
    ├── Fazer X.md                   # uma linha = um arquivo
    └── Fazer Y.md
```

Regra: nó tem filhos (subpáginas ou, no caso de database, qualquer linha)? → pasta `Nome/` + arquivo irmão `Nome.md`. Sem filhos? → só `Nome.md`.

Para databases, o `Nome.md` irmão sempre é gerado e contém: descrição textual do database (do campo `description` da API), seguida de uma tabela Markdown com colunas = properties visíveis e linhas = wikilinks para os arquivos dos itens. Funciona como índice navegável.

### 4.2 Naming

- Slug a partir do título: preserva acentos/UTF-8 (Obsidian aceita), substitui `/ \ : * ? " < > |` por `-`, trim de espaços nas pontas.
- Colisão de slug dentro do mesmo diretório: sufixo ` (2)`, ` (3)`, … determinístico pela ordem alfabética do `notion_id`.

### 4.3 Properties → frontmatter

Cada item de database recebe frontmatter YAML:

```yaml
---
notion_id: 1a2b3c...                 # para auditoria/futuro
notion_url: https://notion.so/...
created_time: 2026-03-12T14:33:00Z
last_edited_time: 2026-05-10T09:01:00Z
# properties:
Status: Em andamento
Tags: [urgente, cliente-x]
Prazo: 2026-05-20
Relacionado: [[Outro Item]]          # se a relation cai dentro da seleção
---
```

Tipos suportados: `title`, `rich_text`, `number`, `select`, `multi_select`, `status`, `date`, `people` (nome), `files` (baixados), `checkbox`, `url`, `email`, `phone_number`, `relation` (wikilinks), `formula` (valor calculado), `rollup` (valor calculado), `created_time`, `last_edited_time`, `created_by`, `last_edited_by`.

### 4.4 Blocos → Markdown

| Notion block | Markdown |
|---|---|
| `paragraph` | parágrafo |
| `heading_1/2/3` | `#`, `##`, `###` |
| `bulleted_list_item` | `- ` |
| `numbered_list_item` | `1. ` |
| `to_do` | `- [ ]` / `- [x]` |
| `quote` | `> ` |
| `callout` | `> [!note] <emoji opcional>` (mapeia emoji → tipo: 💡→tip, ⚠️→warning, ❌→danger, ℹ️→info, default→note) |
| `toggle` | `<details><summary>...</summary>...</details>` (Obsidian renderiza) |
| `code` | fence ``` ```linguagem ``` |
| `equation` (block) | `$$...$$` |
| `equation` (inline) | `$...$` |
| `divider` | `---` |
| `image` | `![<alt>](assets/<arquivo>)` |
| `file`, `pdf`, `audio`, `video` | `[<nome>](assets/<arquivo>)` |
| `bookmark`, `embed`, `link_preview` | tenta embed nativo do Obsidian quando o domínio é conhecido (YouTube, Twitter, Vimeo, Loom, Figma); caso contrário link simples |
| `table` | tabela Markdown |
| `column_list` / `column` | conteúdo concatenado (Obsidian não tem colunas nativas, perda aceitável) |
| `synced_block` | conteúdo inline (sem suporte a transclusão) |
| `child_page` | wikilink + filhos extraídos recursivamente |
| `child_database` | wikilink + filhos extraídos recursivamente |
| `link_to_page` | wikilink |
| Inline mention de página | wikilink |

Rich text inline: bold, italic, strikethrough, underline (`<u>`), code, color (ignorado), link, mention.

### 4.5 Anexos

- URLs internas do Notion (S3 com query params expirando) são baixadas. URLs externas são preservadas.
- Nome de arquivo: `<sha1[:8]>-<basename>` para evitar colisão e manter rastreabilidade. Ex: `a3f2b1c0-screenshot.png`.
- Path relativo do Markdown para o asset: `../assets/a3f2b1c0-screenshot.png` (sempre relativo ao arquivo que referencia).

## 5. Componentes (camadas)

```
notion_extractor/
├── app.py              # FastAPI: rotas /, /tree, /extract, /events
├── config.py           # carrega NOTION_TOKEN, output_dir do .env ou da UI
├── progress.py         # event bus (asyncio.Queue) + tipos de evento
├── notion/
│   ├── client.py       # AsyncNotionClient: wrapper httpx + rate limit + retry
│   ├── tree.py         # discovery: lista shared roots, descida recursiva
│   └── fetch.py        # busca blocos paginados, properties, items de db
├── convert/
│   ├── blocks.py       # block dict → Markdown string (com placeholders)
│   ├── inline.py       # rich_text[] → Markdown inline
│   └── properties.py   # database properties → YAML frontmatter
├── extract/
│   ├── plan.py         # PlannedNode, mapeamento id→path, naming, colisões
│   ├── pipeline.py     # orquestra discovery → extract → write
│   ├── attachments.py  # download paralelo, dedupe por URL
│   └── resolve.py      # substitui placeholders, gera relatório
└── web/
    └── static/         # index.html, app.js, style.css
```

Cada módulo testa-se sozinho. `convert/` é puro (block dict → string), trivial de testar. `notion/` é mockável via fixtures de resposta. `extract/plan.py` testa a regra de pasta vs arquivo com pequenos grafos sintéticos.

## 6. UI

Página única, três estados:

1. **Setup.** Se `NOTION_TOKEN` não está no `.env`, formulário pede o token e o output dir. Salva no `.env` local.
2. **Seleção.** Carrega `/tree` (lista de raízes compartilhadas + filhos lazy). Árvore com checkbox; marcar uma página marca todos os descendentes por padrão (pode desmarcar individualmente). Indicador de tipo (📄 página, 🗃️ database). Busca por título no topo.
3. **Execução.** Barra de progresso (descoberta + extração separadas), log rolante de eventos, link "Abrir vault" no final. Erros destacados em vermelho com mensagem.

Vanilla JS suficiente: árvore é DOM-puro, EventSource é nativo. Sem build step.

## 7. Configuração

`.env` no root do projeto:

```
NOTION_TOKEN=secret_...
OUTPUT_DIR=/caminho/para/vault
HOST=127.0.0.1
PORT=8765
```

Token e output dir podem ser editados pela UI; persistem no `.env`.

## 8. Tratamento de erros

| Erro | Comportamento |
|---|---|
| 401/403 (token inválido / sem acesso) | Para tudo, mostra erro na UI com link para revisar a integração |
| 404 (página deletada entre discovery e fetch) | Pula, registra no relatório |
| 429 | Retry com backoff (Retry-After se vier no header), até 5x |
| 5xx | Retry com backoff, até 5x |
| Bloco com tipo desconhecido | Renderiza placeholder `<!-- unsupported block: xxx -->`, registra no relatório |
| Download de anexo falha | Mantém URL original no Markdown, registra no relatório |
| Property com tipo novo | Cai como string, registra warning no relatório |
| Output dir não vazio em execução repetida | Pede confirmação na UI antes de apagar |

## 9. Relatório (`_report.md`)

Gerado ao final, no root do vault:

```markdown
# Relatório de extração — 2026-05-11 14:32

- Páginas extraídas: 142
- Itens de database extraídos: 388
- Anexos baixados: 217 (98.4 MB)
- Duração: 4m 12s

## Links para fora da seleção (12)
- [[Página X]] referenciada em [Notas](Notas.md#linha-42)
- ...

## Falhas (2)
- Página "Antigo experimento" (notion_id abc...): 404 — provavelmente deletada
- Anexo "video.mov" (URL ...): timeout após 3 tentativas

## Avisos (3)
- Bloco tipo `template` não suportado, ignorado em [Notas](Notas.md#linha-89)
```

## 10. Testes

- **Unitários** em `convert/`: dados sintéticos de blocks → assert string. Cobre cada tipo da tabela 4.4.
- **Unitários** em `extract/plan.py`: grafo sintético → asserts sobre o mapa id→path. Cobre colisões, regra de pasta vs arquivo, sanitização de slug.
- **Integração** em `notion/client.py`: fixtures de resposta gravadas via VCR-py. Testa rate limit, retry, paginação.
- **End-to-end "small"**: um workspace mock com 3 páginas e 1 database em fixtures. Roda o pipeline inteiro contra um servidor HTTP mock, assert sobre estrutura de arquivos resultante.

## 11. Ferramentas

- **uv** para deps e venv.
- **ruff** para lint + format (configura `line-length=100`).
- **pyright** strict para tipagem.
- **pytest** + **pytest-asyncio** para testes.
- **httpx** como cliente HTTP (suporte nativo a async).
- SDK oficial `notion-client` *não* é usada — ela é síncrona. Embrulhamos a API REST diretamente com httpx.

## 12. Deferred (fora do escopo desta versão)

- Sincronização incremental.
- Suporte a múltiplos workspaces na mesma execução.
- Edição/preview no browser antes de escrever no disco.
- Transclusão de synced blocks.
- Colunas (column_list) com layout preservado.
- Comentários do Notion.
- Histórico de versões de páginas.
