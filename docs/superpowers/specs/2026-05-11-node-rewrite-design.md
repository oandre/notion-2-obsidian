# Node Rewrite + Pages Site — Design

**Data:** 2026-05-11
**Versão alvo:** v0.2 (substitui v0.1 em Python)
**Status:** Aprovado para implementação
**Predecessor:** [v0.1 Python design](./2026-05-11-notion-extractor-design.md)

## 1. Objetivo

Reescrever o `notion-2-obsidian` em TypeScript + Node, mantendo o modelo "roda local" (sem deploy, sem OAuth, sem SaaS), e publicar um site estático separado em GitHub Pages para landing, privacy policy, terms e docs.

**Não-objetivos** (continuam fora de escopo):
- Sincronização incremental
- Hosting do backend (a app continua rodando local)
- OAuth público / integration pública
- Suporte a múltiplos workspaces simultâneos

## 2. Por que reescrever?

A v0.1 em Python funciona. O motivo do rewrite é distribuição: `npx notion-2-obsidian` permite qualquer pessoa com Node instalado rodar a ferramenta sem instalar nada permanente — barreira muito menor que "instale uv, clone o repo, configure venv". O ecossistema Node domina entre não-devs migrando para Obsidian (que é Electron), então o público-alvo já tem Node ou está pronto para instalar.

## 3. Decisões de produto

| Decisão | Escolha | Confirmada |
|---|---|---|
| Linguagem | TypeScript (strict) | ✓ |
| Runtime | Node 20+ | (padrão) |
| Distribuição | `npx notion-2-obsidian` | ✓ |
| Backend framework | Fastify | (padrão) |
| Frontend | React + Vite, build embutido no pacote npm | ✓ |
| Site estático | Astro em `/site` + Tailwind, deploy via GH Action para Pages | ✓ |
| Lint + format | Biome | (padrão) |
| Testes | Vitest + msw (mock de HTTP) | (padrão) |
| Workspace tool | Sem workspaces; `app/` e `site/` independentes | ✓ |
| Conteúdo legal | Templates adaptados de tools similares, usuário revisa | ✓ |
| Código Python v0.1 | Removido de `main`, preservado na tag `v0.1-python` | ✓ |

## 4. Arquitetura

Idêntica em modelo à v0.1: app local serve HTTP no `localhost`, frontend roda no browser, três-fase pipeline (discovery → render com placeholders → resolve + write).

```
┌─────────────────────────────────────────┐
│  Navegador (React SPA buildada)         │
│    ├── /api/roots                       │
│    ├── /api/extract                     │
│    └── EventSource /api/events          │
└────────────────┬────────────────────────┘
                 │ HTTP / SSE em localhost
┌────────────────▼────────────────────────┐
│  Fastify (TypeScript, Node 20+)         │
│    ├── routes/                          │
│    ├── progress bus (EventEmitter)      │
│    └── pipeline ▼                       │
└────────────────┬────────────────────────┘
                 │
       ┌─────────┴──────────┐
       ▼                    ▼
   Notion API           Sistema de arquivos
   (undici fetch +      (vault de saída no
    p-limit + retry)    diretório do usuário)
```

A regra de ouro do design (do v0.1) **continua valendo**: wikilinks só podem ser resolvidos depois que todos os caminhos de saída forem conhecidos. Por isso a divisão em 3 fases é mantida.

### 4.1 Pipeline

1. **Discovery** (`server/notion/discovery.ts`): walk via `POST /v1/search` + recursão em `child_page` / `child_database` / itens de db. Constrói `Map<notionId, PlannedNode>`. Cada nó cacheia `blocks` e `pageData` para a fase 2 não refetchar.

2. **Render** (`server/convert/blocks.ts` + `properties.ts`): blocos viram Markdown com placeholders `{{notion-link:<id>|<label>}}` e `{{notion-asset:<url>}}`. Função pura.

3. **Resolve & write** (`server/extract/resolve.ts` + `pipeline.ts`): downloads de anexos paralelos, regex sub para placeholders → wikilinks + paths relativos, escreve `.md`, gera `_report.md`.

### 4.2 Concorrência

- API do Notion: rate limit ~3 req/s. `p-limit(3)` envolvendo cada chamada.
- Downloads de anexo (S3): pool separado, `p-limit(8)`.
- Retry: 5 tentativas com backoff exponencial em 429/5xx, respeitando `Retry-After`.

## 5. Mapeamento Notion → Obsidian

**Inalterado em relação à v0.1.** Consulte seções 4.1–4.5 do [design da v0.1](./2026-05-11-notion-extractor-design.md). O port é literal: as mesmas regras de naming, colisão, frontmatter, e tabela de blocos. Os testes em Python servem como spec executável a portar.

Resumo rápido das regras:
- Página-folha → `Nome.md`
- Página com filhos → `Nome.md` + pasta irmã `Nome/`
- Database → `Nome.md` (índice com tabela) + pasta irmã `Nome/` com um `.md` por linha
- Properties → YAML frontmatter
- Anexos → `assets/<sha1[:8]>-<basename>`
- Callouts: 💡→tip, ⚠️→warning, ❌→danger, ℹ️→info, ✅→success, ❓→question, default→note
- Embeds nativos no Obsidian para: youtube, x.com/twitter, vimeo, loom, figma

## 6. Estrutura do repositório

```
notion-2-obsidian/
├── README.md
├── LICENSE
├── CLAUDE.md
├── .gitignore
├── .github/workflows/
│   ├── ci.yml              # lint + test + build em PRs e push
│   ├── publish-npm.yml     # npm publish quando push de tag v*
│   └── publish-pages.yml   # deploy do site no push para main
├── docs/
│   └── superpowers/specs/  # specs históricos (este doc, o da v0.1, etc.)
├── app/                    # o pacote npm publicado como notion-2-obsidian
│   ├── package.json
│   ├── tsconfig.json
│   ├── biome.json
│   ├── vite.config.ts
│   ├── vitest.config.ts
│   ├── bin/
│   │   └── cli.ts          # entrypoint para npx (shebang)
│   └── src/
│       ├── server/
│       │   ├── app.ts            # Fastify app factory
│       │   ├── config.ts         # env loading com zod
│       │   ├── routes/           # /api/roots, /api/extract, /api/events
│       │   ├── progress.ts       # EventEmitter typed
│       │   ├── notion/
│       │   │   ├── client.ts     # undici fetch + p-limit + retry
│       │   │   ├── fetch.ts      # paginated GET/POST
│       │   │   └── discovery.ts  # tree walk
│       │   ├── convert/
│       │   │   ├── inline.ts     # rich_text → md
│       │   │   ├── blocks.ts     # block dispatcher + handlers
│       │   │   └── properties.ts # db properties → frontmatter
│       │   └── extract/
│       │       ├── plan.ts       # PlannedNode + plan_paths
│       │       ├── attachments.ts # downloader
│       │       ├── resolve.ts    # placeholders + report
│       │       └── pipeline.ts   # orquestrador
│       ├── shared/
│       │   └── types.ts          # tipos usados por server + web
│       └── web/
│           ├── main.tsx          # React entry
│           ├── App.tsx
│           ├── components/
│           │   ├── TreeView.tsx
│           │   ├── ProgressView.tsx
│           │   └── LogStream.tsx
│           ├── api.ts            # fetch helpers
│           └── styles.css
└── site/                   # site estático em Astro
    ├── package.json
    ├── astro.config.mjs
    ├── tailwind.config.mjs
    └── src/
        ├── layouts/
        │   └── Default.astro
        ├── pages/
        │   ├── index.astro     # landing
        │   ├── privacy.astro
        │   ├── terms.astro
        │   └── docs/
        │       ├── index.astro # quickstart
        │       └── how-it-works.astro
        ├── components/
        └── styles.css
```

## 7. Build e distribuição

### 7.1 Pacote `app/`

`package.json` chave:
```json
{
  "name": "notion-2-obsidian",
  "version": "0.2.0",
  "type": "module",
  "bin": { "notion-2-obsidian": "dist/cli.js" },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "dev": "tsx watch src/server/dev.ts",
    "build": "vite build && tsc -p tsconfig.server.json",
    "test": "vitest run",
    "lint": "biome check src bin"
  }
}
```

Dois builds em paralelo:
- **Server:** `tsc` → CommonJS-friendly ESM em `dist/server/`.
- **Web:** Vite produz `dist/web/` com `index.html` + assets. O Fastify serve via `@fastify/static`.

CLI entrypoint (`bin/cli.ts`):
1. Lê `.env` no diretório de trabalho se existir (não pede via TTY)
2. Levanta o Fastify mesmo se o token estiver ausente — o frontend trata isso no view de Setup, postando para `/api/setup` que persiste no `.env`
3. Abre browser (best-effort com `open` package)
4. Aguarda sinal SIGINT

`npm publish` (manual ou via GH Action em push de tag): roda lint+test+build, publica `dist/` no npm. Usuários: `npx notion-2-obsidian@latest`.

### 7.2 Site `site/`

GH Action `publish-pages.yml` em push para `main`:
1. `cd site && npm ci && npm run build`
2. Upload `site/dist` para `actions/deploy-pages`
3. Pages serve em `oandre.github.io/notion-2-obsidian/` (ou domínio custom)

## 8. UI (frontend React)

Página única, três views switch-eadas:

1. **Setup:** se `NOTION_TOKEN` não está no `.env`, mostra um formulário pedindo token + output dir. Salva no `.env` local.
2. **Selection:** árvore com checkbox, busca por título no topo, indicador de tipo (📄 página / 🗃️ database). Marcar um nó marca os descendentes por padrão (pode desmarcar individualmente).
3. **Progress:** barra de progresso (descoberta + extração), log rolante de eventos, link "Abrir vault" no final.

Estado gerenciado por React state (sem Redux/Zustand — tamanho não justifica). SSE consumido com EventSource nativo.

## 9. API HTTP

Idêntica à v0.1:

| Método | Path | Comportamento |
|---|---|---|
| GET | `/` | serve `index.html` |
| GET | `/api/status` | retorna `{tokenConfigured: bool, outputDir: string \| null}` |
| POST | `/api/setup` | body `{notionToken, outputDir}` — persiste no `.env`, retorna 204 |
| GET | `/api/roots` | requer setup; chama `list_shared_roots`, retorna `[{id, kind, title}]` |
| POST | `/api/extract` | body `{selection: [{id, kind}]}`, retorna `{job_id}` |
| GET | `/api/events?job=<id>` | SSE stream |

Eventos SSE (todos JSON em `data:`):
- `discovery_started` `{}`
- `discovery_progress` `{root_id, discovered}`
- `discovery_done` `{total}`
- `node_started` `{id, title}`
- `node_done` `{id}`
- `node_failed` `{id, reason}`
- `attachment_downloaded` `{url, path}`
- `extraction_done` `{pages, items, attachments}`

## 10. Testes

- **Unitários puros** em `convert/`: dados de bloco sintéticos → string. Mesma cobertura da v0.1 (cada handler de bloco tem teste).
- **Unitários** em `extract/plan.ts`: regras de folder/file + colisão + nesting.
- **Integração** em `notion/client.ts`: usando `msw` ou `nock` para mock de HTTP. Testa rate limit, retry, paginação.
- **E2E mockado:** roda `runExtraction` contra um workspace fixture mocado, assert sobre arquivos resultantes.

Vitest com `pool: 'threads'` para paralelismo.

## 11. Conteúdo do site

### 11.1 Páginas
- `/` (index): hero + 3 features (selection, fidelity, wikilinks) + GIF/screenshot + CTA "Try it: `npx notion-2-obsidian@latest`"
- `/privacy`: o que coletamos (nada), uso da Notion API, sem telemetria, sem storage cloud, links externos
- `/terms`: licença MIT, "use por sua conta e risco", não há SLA
- `/docs/`: quickstart + how-it-works (espelho resumido do README e do CLAUDE.md)

### 11.2 Design
- Tailwind com paleta neutra (preto/branco/cinza + acento azul)
- Sem framework de componentes pesado (sem shadcn etc.); CSS minimalista
- Responsivo (mobile-friendly)

## 12. Lidando com o código Python existente

1. Antes de começar o rewrite: `git tag v0.1-python` no commit atual + push da tag.
2. Primeiro commit do rewrite: remove `src/notion_extractor/`, `tests/`, `pyproject.toml`, `uv.lock`, `.python-version` etc.
3. O README e o CLAUDE.md são reescritos para refletir a v0.2.
4. Specs da v0.1 ficam em `docs/superpowers/specs/` (histórico).
5. Em `README.md`, nota: "v0.1 (Python) está em https://github.com/oandre/notion-2-obsidian/tree/v0.1-python".

## 13. Tratamento de erros

Mesmas regras da v0.1:
- 401/403 → para tudo, mostra erro na UI com link para revisar a integração
- 404 entre discovery e fetch → pula, registra
- 429/5xx → retry com backoff
- Bloco desconhecido → `<!-- unsupported block: xxx -->` + warning no relatório
- Anexo falha → mantém URL original, registra falha
- Output dir não vazio → pede confirmação na UI antes de apagar

## 14. CI/CD

Três workflows:

| Arquivo | Trigger | Faz |
|---|---|---|
| `ci.yml` | PR + push para main | `cd app && npm ci && npm run lint && npm test && npm run build`; `cd site && npm ci && npm run build` |
| `publish-npm.yml` | push de tag `v*` | re-roda CI, depois `cd app && npm publish` (usa `NPM_TOKEN` secret) |
| `publish-pages.yml` | push para main | builda `site/` e faz deploy via `actions/deploy-pages` |

## 15. Out of scope (próxima versão)

- Sincronização incremental
- Suporte a múltiplos workspaces simultaneamente
- Comentários do Notion
- Histórico de versões
- Plugin Obsidian para importar diretamente
- Preview no browser antes de escrever no disco
