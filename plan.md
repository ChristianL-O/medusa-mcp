# Plan: Medusa Docs MCP Server

## Context
Bygge en **hostet** MCP-server for Medusa v2-dokumentasjon, modellert etter Anthropic-mønsteret dokumentert i `structure.md`. Innhold skrapes fra docs.medusajs.com én gang og lagres på disk som JSON. Serveren kjører på hjemmeserver/NAS og er tilgjengelig via URL fra hvilken som helst maskin. Transport: **Streamable HTTP**. Serveren er TypeScript/Node.js og eksponerer 5 tools.

---

## Prosjektstruktur

```
/Users/christianolsen/Documents/Medusa-mcp/
├── src/
│   ├── server.ts              # MCP server entry point (StreamableHTTPServerTransport)
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
- `express` + `@types/express` — HTTP-server for Streamable HTTP transport
- `cheerio` — HTML-parsing i scraper (ikke linkedom)
- `turndown` + `@types/turndown` — HTML → Markdown
- `zod` — tool input-validering
- `typescript`, `tsx` — runtime + bygg

**`tsconfig.json`** — standard ESNext + strict, `moduleResolution: bundler`

> **Merk:** Importer bruker subpath-imports med `.js`-ending:
> ```typescript
> import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
> import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
> ```

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
3. For hver URL: `fetch` → parse HTML med `cheerio` → extract `$("main").html()` → `turndown` → `{ path, title, url, description, content }` → lagre som `cache/docs/{slug}.json`

   **Navigasjon tab-mapping** (hardkodet i scraper):
   ```typescript
   const TAB_MAP: Record<string, string> = {
     "Get Started":            "Learn",
     "Product":                "Learn",
     "Commerce Modules":       "Commerce Modules",
     "Infrastructure Modules": "Infrastructure Modules",
     "Build":                  "Build",
     "Tools":                  "Tools",
     "References":             "References",
     "Medusa Admin":           "Admin",
     "Cloud":                  "Cloud",
   };
   ```

   **Concurrency:** batches på 5 URL-er om gangen, 500ms pause mellom batches. Hvert kall i try/catch — én feil stopper ikke hele kjøringen.

4. *(API-spec-henting avklares separat — se spørsmål 8)*

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
- Søker i in-memory cache (lastet ved serverstart) — ikke disk-reads per kall
- **Algoritme:** TF-inspirert scoring — query splittes i ord, treff telles per dokument. Title-treff vektes 10× høyere enn content-treff. Resultater sorteres synkende på score.
- Output: `N results for "query"` → liste: tittel, path, URL, beskrivelse, snippet

### `get_doc`
- Input: `{ path: string }`
- Partial path matching: søker gjennom in-memory cache-nøkler for beste treff
- Output: `# Tittel\n\n**URL:** ...\n\n[komplett markdown-innhold]`

### `list_api_endpoints`
- Input: `{ search?: string, tag?: string, api?: "admin" | "store" | "both" (default: "both") }`
- Leser fra `cache/api/{admin,store}-spec.json`
- Output: flat liste `**METHOD /path**: Summary`

### `get_api_endpoint`
- Input: `{ method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE", path: string, api?: "admin"|"store" }`
- Returnerer: method, path, summary, parameters, request body og response — **strukturert sammendrag, ikke rå spec**
- Nesting begrenses til 2 nivåer. Output kappes ved ~100 linjer for å unngå kontekstoverflyt.
- Output format:
  ```markdown
  # POST /store/carts
  **Create Cart**
  **Parameters:** (none required)
  **Request Body:**
  - `region_id` (string, required) — The region to create the cart in
  - `items` (array) — Line items to add
  **Response (200):**
  - `cart` (object) — The created cart
    - `id`, `currency_code`, `total`, `items[]`, ...
  ```

---

## Fase 4 — Server entry point (`src/server.ts`)

- `McpServer` + `StreamableHTTPServerTransport` via Express
- **Per-request factory-mønster:** ny `McpServer`-instans opprettes per forespørsel (unngår double-binding av event handlers ved gjentatte `connect()`-kall på samme instans)
- Cache-data (navigation + docs) lastes én gang ved modulstart og deles på tvers av alle instanser
- Én Express-rute: `POST /mcp` — håndterer alle MCP-forespørsler
- Port konfigureres via `PORT`-miljøvariabel (default `3000`)
- `main().catch()` for fatal error handling med `process.exit(1)`

**Mønster for server entry point:**
```typescript
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const app = express();
app.use(express.json());

// Lastes én gang ved oppstart — deles av alle per-request instanser
const cache = await loadCache();

function buildServer() {
  const server = new McpServer({ name: "medusa-docs", version: "1.0.0" });
  // registrer alle tools med cache som closure
  registerTools(server, cache);
  return server;
}

app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Medusa Docs MCP server running on http://0.0.0.0:${PORT}/mcp`);
});
```

**Mønster for tool error handling (`isError: true`):**
```typescript
server.registerTool("get_doc", {
  description: "...",
  inputSchema: z.object({ path: z.string() })
}, async ({ path }) => {
  const doc = findDoc(path);
  if (!doc) {
    return {
      content: [{ type: "text", text: `Path "${path}" ikke funnet` }],
      isError: true   // LLM ser feilen og kan korrigere seg selv
    };
  }
  return { content: [{ type: "text", text: doc.content }] };
});
```

> **Viktig:** Tool-feil skal returneres med `isError: true` — aldri kastes som exceptions.
> Exceptions er skjult for LLM-en og kan ikke selvkorrigeres.

---

## Fase 5 — MCP-konfigurasjon

Siden serveren kjører på hjemmeserver og eksponeres via HTTP, bruker klientmaskiner URL i stedet for en lokal kommando.

Legg til i `.claude/settings.json` på **hver klientmaskin**:
```json
{
  "mcpServers": {
    "medusa-docs": {
      "type": "http",
      "url": "http://<server-ip>:3000/mcp"
    }
  }
}
```

Start serveren på hjemmeserveren:
```bash
npx tsx src/server.ts
# eller etter bygg:
node dist/server.js
```

For å kjøre serveren som en bakgrunnsprosess som overlever reboot, bruk `pm2` eller en systemd-service.

---

## Verifikasjon

1. `npx tsx scripts/scrape.ts` — verifiser at `cache/` fylles med JSON-filer
2. `npx tsx src/server.ts` — start HTTP-server, sjekk at den lytter på port 3000
3. Test at serveren svarer:
   ```bash
   curl -X POST http://localhost:3000/mcp \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
   ```
4. Test tools via MCP inspector eller Claude Code (legg til `http://localhost:3000/mcp` som MCP-server):
   - `get_navigation` → returnerer Medusa-hierarkiet
   - `search_docs query="workflow"` → treffer relevante sider
   - `get_doc path="/learn/fundamentals/workflows"` → komplett markdown
   - `list_api_endpoints tag="products"` → lister produkt-endepunkter
   - `get_api_endpoint method="POST" path="/store/carts"` → full endepunkt-detalj
