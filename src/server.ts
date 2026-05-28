import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { registerGetNavigation, type NavEntry } from "./tools/get-navigation.js";
import { registerSearchDocs, type LeafDoc } from "./tools/search-docs.js";
import { registerGetDoc, type DocSlug } from "./tools/get-doc.js";
import { registerListApiEndpoints } from "./tools/list-api-endpoints.js";
import { registerGetApiEndpoint } from "./tools/get-api-endpoint.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, "../cache");
const DOCS_DIR = join(CACHE_DIR, "docs");

type Cache = {
  navigation: NavEntry[];
  leaves: LeafDoc[];
  docSlugs: DocSlug[];
  adminSpec: Record<string, unknown>;
  storeSpec: Record<string, unknown>;
};

function walkDocs(
  dir: string,
  prefix: string,
  leaves: LeafDoc[],
  docSlugs: DocSlug[]
) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const isDir = statSync(fullPath).isDirectory();
    const slug = prefix ? `${prefix}/${entry}` : entry;

    if (isDir) {
      docSlugs.push({ slug, isParent: true });
      walkDocs(fullPath, slug, leaves, docSlugs);
    } else if (entry.endsWith(".json") && entry !== "index.json") {
      const leafSlug = prefix
        ? `${prefix}/${entry.slice(0, -5)}`
        : entry.slice(0, -5);
      docSlugs.push({ slug: leafSlug, isParent: false });
      try {
        const data = JSON.parse(readFileSync(fullPath, "utf-8")) as LeafDoc;
        if (data.content !== undefined) {
          leaves.push({ ...data, slug: leafSlug });
        }
      } catch {
        // skip malformed files
      }
    }
  }
}

function loadCache(): Cache {
  const navigation: NavEntry[] = JSON.parse(
    readFileSync(join(CACHE_DIR, "navigation.json"), "utf-8")
  );

  const leaves: LeafDoc[] = [];
  const docSlugs: DocSlug[] = [];
  walkDocs(DOCS_DIR, "", leaves, docSlugs);

  const adminSpec = JSON.parse(
    readFileSync(join(CACHE_DIR, "api/admin-spec.json"), "utf-8")
  ) as Record<string, unknown>;
  const storeSpec = JSON.parse(
    readFileSync(join(CACHE_DIR, "api/store-spec.json"), "utf-8")
  ) as Record<string, unknown>;

  return { navigation, leaves, docSlugs, adminSpec, storeSpec };
}

console.log("Loading cache...");
const cache = loadCache();
console.log(
  `Cache loaded: ${cache.navigation.length} nav entries, ${cache.leaves.length} leaf docs, ${cache.docSlugs.length} slugs`
);

function buildServer(): McpServer {
  const server = new McpServer({ name: "medusa-docs", version: "1.0.0" });
  registerGetNavigation(server, cache.navigation);
  registerSearchDocs(server, cache.leaves);
  registerGetDoc(server, cache.docSlugs, DOCS_DIR);
  registerListApiEndpoints(server, cache.adminSpec, cache.storeSpec);
  registerGetApiEndpoint(server, cache.adminSpec, cache.storeSpec);
  return server;
}

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Medusa Docs MCP server running on http://0.0.0.0:${PORT}/mcp`);
});
