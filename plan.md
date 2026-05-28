# Plan: Medusa Docs MCP Server

## Context
Bygge en lokal MCP-server for Medusa-dokumentasjon, modellert etter Anthropic-mønsteret dokumentert i `structure.md`. Innhold skrapes fra docs.medusajs.com én gang og lagres på disk som JSON. Serveren er TypeScript/Node.js og eksponerer 5 tools.

---

## Prosjektstruktur

```
/Users/christianolsen/Documents/Medusa-mcp/
├── src/
│   ├── server.ts              # MCP server entry point (StdioServerTransport)
│   └── tools/
│       ├── get-navigation.ts
│       ├── search-docs.ts
│       ├── get-doc.ts
│       ├── list-api-endpoints.ts
│       └── get-api-endpoint.ts
├── scripts/
│   └── scrape.ts              # Engangs-scraper — bygger cache/
├── cache/
│   ├── navigation.json        # Hierarki bygd fra docs.md
│   ├── docs/                  # Én JSON per doc-side
│   │   └── {slug}.json        # { path, title, url, description, content }
│   └── api/
│       ├── admin-spec.json    # Medusa Admin OpenAPI spec
│       └── store-spec.json    # Medusa Store OpenAPI spec
├── docs.md                    # Eksisterer
├── structure.md               # Eksisterer
├── package.json
└── tsconfig.json
```

---

## Fase 1 — Prosjektoppsett

**`package.json`** — dependencies:
- `@modelcontextprotocol/sdk` — MCP server
- `turndown` + `@types/turndown` — HTML → Markdown
- `zod` — tool input-validering
- `typescript`, `tsx` — runtime + bygg

**`tsconfig.json`** — standard ESNext + strict, `moduleResolution: bundler`

---

## Fase 2 — Scraper (`scripts/scrape.ts`)

1. Parse `docs.md` for å ekstrahere alle URL-er, titler og kontekstuell beskrivelse (linjetekst)
2. Bygg `cache/navigation.json` — hierarki av tabs/grupper/sider med `{ path, sidebarTitle, pageTitle, url }`  
   Navigasjonsstrukturen (tabs) utledes fra `##`/`###`-overskriftene i `docs.md`:
   - **Learn** (Get Started + Framework + Admin + Debugging + Deployment osv.)
   - **Commerce Modules** (Cart, Payment, Product, Order …)
   - **Infrastructure Modules**
   - **Build** (Recipes, How-to, Integrations, Storefront)
   - **Tools** (CLI, JS SDK, Next.js Starter, Medusa UI)
   - **References** (Admin API, Store API, DML ref, Workflows SDK …)
   - **Admin** (User Guide)
   - **Cloud**
3. For hver URL: `fetch` → parse HTML med `DOMParser`/`linkedom` → extract `<main>` → `turndown` → `{ path, title, url, description, content }` → lagre som `cache/docs/{slug}.json`
4. Fetch Medusa OpenAPI specs:
   - Admin: `https://docs.medusajs.com/api/admin` (OpenAPI JSON endpoint)
   - Store: `https://docs.medusajs.com/api/store`
   - Lagre som `cache/api/admin-spec.json` og `cache/api/store-spec.json`

Scraper kjøres én gang: `npx tsx scripts/scrape.ts`

---

## Fase 3 — MCP Tools

### `get_navigation`
- Input: `{ format?: "json" | "markdown", tab?: string }`
- Leser `cache/navigation.json`
- Returnerer JSON-struktur eller menneskelesbar markdown
- Ugyldig tab → feilmelding med tilgjengelige tabs

### `search_docs`
- Input: `{ query: string, limit?: number (default 10, maks 50) }`
- Full-text søk over alle `cache/docs/*.json` — søker i `title` + `content`
- Output: `N results for "query"` → liste: tittel, path, URL, beskrivelse, snippet

### `get_doc`
- Input: `{ path: string }`
- Partial path matching: søker gjennom cache-nøkler for beste treff
- Output: `# Tittel\n\n**URL:** ...\n\n[komplett markdown-innhold]`

### `list_api_endpoints`
- Input: `{ search?: string, tag?: string, api?: "admin" | "store" | "both" (default: "both") }`
- Leser fra `cache/api/{admin,store}-spec.json`
- Output: flat liste `**METHOD /path**: Summary`

### `get_api_endpoint`
- Input: `{ method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE", path: string, api?: "admin"|"store" }`
- Returnerer: method, path, summary, parameters, request body schema, response schema (fra OpenAPI spec)
- Output: Markdown med alle detaljer (Medusa sin spec er mer detaljert enn Anthropic sin — vi inkluderer request/response)

---

## Fase 4 — Server entry point (`src/server.ts`)

- `@modelcontextprotocol/sdk` `Server` + `StdioServerTransport`
- Registrerer alle 5 tools med Zod-validerte input-schemas
- `package.json` `"bin"`: `{ "medusa-mcp": "./dist/server.js" }` for enkel CLI-bruk
- Instruksjoner i README for å legge til i Claude Code settings

---

## Fase 5 — MCP-konfigurasjon

Legg til i `.claude/settings.json` (eller brukerens globale MCP-konfig):
```json
{
  "mcpServers": {
    "medusa-docs": {
      "command": "npx",
      "args": ["tsx", "/path/to/src/server.ts"]
    }
  }
}
```

---

## Verifikasjon

1. `npx tsx scripts/scrape.ts` — verifiser at `cache/` fylles med JSON-filer
2. `npx tsx src/server.ts` — start server manuelt, sjekk at den starter uten feil
3. Test tools via MCP inspector eller Claude Code:
   - `get_navigation` → returnerer Medusa-hierarkiet
   - `search_docs query="workflow"` → treffer relevante sider
   - `get_doc path="/learn/fundamentals/workflows"` → komplett markdown
   - `list_api_endpoints tag="products"` → lister produkt-endepunkter
   - `get_api_endpoint method="POST" path="/store/carts"` → full endepunkt-detalj
