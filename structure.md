# Anthropic Docs MCP Server — Struktur og design

Dokumentasjon av `anthropic-docs` MCP-serverens 5 tools: input-skjema, output-format og designmønstre.

---

## Oversikt: Tools

| Tool | Formål | Krever |
|---|---|---|
| `get_navigation` | Hent hele nav-hierarkiet | — |
| `search_docs` | Full-text søk i docs | `query` |
| `get_doc` | Hent én doc-side komplett | `path` |
| `list_api_endpoints` | List alle API-endepunkter | — |
| `get_api_endpoint` | Detaljer om ett endepunkt | `method`, `path` |

---

## 1. `get_navigation`

### Input
```json
{
  "format": "json" | "markdown",   // valgfri, default: "markdown"
  "tab": "Messages"                // valgfri filter
}
```

Gyldige tab-verdier: `"Messages"`, `"Managed Agents"`, `"Admin"`, `"Resources"`

Ugyldig tab returnerer feilmelding:
```
Tab "X" not found. Available tabs: Messages, Managed Agents, Admin, Resources
```

### Output (format: "json")
```json
{
  "tabs": [
    {
      "label": "Messages",
      "defaultPath": "/docs/en/intro",
      "displayAs": "dropdown",          // valgfri — brukes for Resources-tabben
      "hiddenInMenu": true,             // valgfri
      "groups": [
        {
          "label": "First steps",
          "pages": [
            {
              "path": "/docs/en/intro",
              "sidebarTitle": "Intro to Claude",
              "pageTitle": "Intro to Claude"
            }
          ],
          "groups": []                  // nestede under-grupper støttes
        }
      ],
      "pages": [],                      // sider direkte under tab (ikke i gruppe)
      "topGroups": [],                  // valgfri — vises øverst i sidebar
      "bottomGroups": [],               // valgfri — vises nederst i sidebar
      "items": []                       // valgfri — for dropdown-tabs, liste av seksjoner
    }
  ]
}
```

**Viktig:** `pages` finnes både på tab-nivå og gruppe-nivå. Grupper kan nestes (`groups` inne i `groups`). Noen sider deles på tvers av tabs (f.eks. Files API vises under både Messages og Managed Agents).

### Output (format: "markdown")
Menneskelesbar markdown, egnet for rask oversikt.

---

## 2. `search_docs`

### Input
```json
{
  "query": "tool use JSON schema",   // påkrevd
  "limit": 10                        // valgfri, default: 10, maks: 50
}
```

### Output
```
Found N results for "query":

### 1. Sidetittel
**Path:** /docs/en/...
**URL:** https://platform.claude.com/docs/en/...
**Description:** Første avsnitt / meta-beskrivelse av siden.

Snippet med kontekst rundt søketreffet...

---
```

**Mønster:**
- Resultater rangert etter relevans
- Hvert resultat: tittel, path, full URL, beskrivelse, tekstsnippet
- Beskrivelsen er sidenes første avsnitt (ikke nødvendigvis en dedikert meta-tag)

---

## 3. `get_doc`

### Input
```json
{
  "path": "/docs/en/intro"   // påkrevd — støtter partial matching
}
```

**Partial path matching:** Serveren prøver å matche delvise stier. `"prompt-caching"` kan matche `/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching`. Matching er ikke alltid deterministisk — bruk fullstendige stier for forutsigbarhet.

### Output
```markdown
# Sidetittel

**URL:** https://platform.claude.com/docs/en/...

Kort beskrivelse av siden (første avsnitt).

---

[Komplett renset markdown-innhold av siden]
```

**Mønster:**
- H1 = sidetittel
- URL som bold-linje
- Beskrivelse
- HR-separator
- Komplett sideinnhold som renset markdown
- MDX-komponenter (`<Tip>`, `<Note>`, `<Steps>`, `<Card>`, `<CardGroup>`) er bevart som tekst eller konvertert til markdown-tabeller

---

## 4. `list_api_endpoints`

### Input
```json
{
  "search": "session",      // valgfri — søk i path eller summary
  "tag": "Messages"         // valgfri — filtrer på resource-tag
}
```

Kjente resource-tags (fra observasjon):
`messages`, `models`, `agents`, `environments`, `sessions`, `vaults`, `memory_stores`, `files`, `skills`, `user_profiles`

### Output
```markdown
# Claude API Endpoints

- **POST /v1/messages**: Create a Message
- **GET /v1/messages/batches/{message_batch_id}**: Retrieve a Message Batch
...

Use get_api_endpoint for detailed information about a specific endpoint.
```

**Mønster:** Flat liste — `**METHOD /path**: Summary`. Veileder brukeren mot `get_api_endpoint` for detaljer.

---

## 5. `get_api_endpoint`

### Input
```json
{
  "method": "POST",          // påkrevd — enum: GET, POST, PUT, PATCH, DELETE
  "path": "/v1/messages"    // påkrevd
}
```

### Output
```markdown
# POST /v1/messages

**Create a Message**

Send a structured list of input messages with text and/or image content,
and the model will generate the next message in the conversation.

**Resource:** messages

**Documentation:** https://platform.claude.com/docs/en/api/v1/messages
```

**Viktig observasjon:** Outputen er sparsom — den returnerer *ikke* request-parametere, request body-skjema eller response-skjema direkte. Den peker på en URL for full dokumentasjon. Dette er et bevisst design: selve parameterdokumentasjonen lever på docs-siden, ikke i MCP-svaret.

---

## URL-mønstre

```
Docs-sider:   https://platform.claude.com/docs/en/{seksjon}/{underseksjon}/{side}
API-sider:    https://platform.claude.com/docs/en/api/v1/{endepunkt}
Interne refs: /docs/en/{sti}   (relativ, brukes i navigasjonen)
```

---

## Navigasjonsstruktur (4 tabs)

```
Messages
├── First steps
├── Building with Claude
├── Model capabilities
├── Tools
├── Tool infrastructure
├── Context management
├── Working with files
├── Skills
├── MCP
└── Claude on cloud platforms

Managed Agents
├── First steps
├── Define your agent
├── Configure agent environment
├── Delegate work to your agent
├── Manage agent context
├── Advanced orchestration
├── Working with files (delt med Messages)
├── Skills (delt med Messages)
└── MCP (delt med Messages)

Admin
├── Organization
├── Authentication
├── Monitoring
└── Data & compliance / Compliance API

Resources  (dropdown)
├── Best practices
├── Models & pricing
├── Client SDKs
├── API reference
├── Claude API skill
└── Release notes
```

---

## Designmønstre å ta med seg

### 1. Progressiv avsløring
`list_api_endpoints` → oversikt, `get_api_endpoint` → detaljer.
LLM-en velger selv om den trenger mer info. Unngår å dumpe alt i én respons.

### 2. Separasjon: navigasjon / innhold / API-referanse
Tre distinkte tool-typer for tre distinkte bruksmønstre:
- **Utforsk** → `get_navigation`
- **Søk** → `search_docs`
- **Les** → `get_doc` / `get_api_endpoint`

### 3. Alltid markdown-output
Alle tools returnerer markdown (eller JSON for `get_navigation` med `format: "json"`).
LLM-er konsumerer markdown naturlig — ingen XML-wrapping, ingen custom structs.

### 4. Filtrering på alle list-tools
Både `get_navigation` (tab-filter) og `list_api_endpoints` (tag + søk) støtter filtering.
Reduserer noise uten å tvinge klienten til å hente alt og filtrere selv.

### 5. Partial path matching i `get_doc`
Gjør det enklere for LLM-en å slå opp en side uten å huske eksakt sti.
Tradeoff: ikke-deterministisk ved tvetydige partial paths.

### 6. Delte sider på tvers av tabs
Innhold kan refereres fra flere kontekster (f.eks. Files API vises under både
Messages og Managed Agents). Unngår duplisering av innhold.

### 7. Ingen paginering i `get_doc`
Hele siden returneres i ett kall. For korte docs er dette optimalt.
Krever at innholdet holdes konsist — lange sider kan sprenge kontekstvinduer.

---

## Implikasjoner for din MCP-server

Basert på Anthropics valg:

- **Struktur-tool** (`get_navigation`-ekvivalent): eksponér hierarki som JSON med `path`, `sidebarTitle`, `pageTitle`
- **Søk-tool**: returner path + URL + første avsnitt + snippet — ikke hele siden
- **Hent-tool**: returner komplett markdown i ett kall — én side = én respons
- **API-tool** (hvis aktuelt): skill liste (oversikt) fra detalj (enkelt oppslag)
- **Output-format**: alltid markdown — LLM-vennlig, ingen custom wrapping
- **Paths som nøkler**: bruk konsistente, hierarkiske stier som primær identifikator
