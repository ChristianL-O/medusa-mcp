import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type OpenApiSpec = {
  paths?: Record<string, Record<string, { summary?: string; tags?: string[] }>>;
};

type Endpoint = {
  method: string;
  path: string;
  summary: string;
  tags: string[];
  api: "admin" | "store";
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

function extractEndpoints(spec: OpenApiSpec, api: "admin" | "store"): Endpoint[] {
  const endpoints: Endpoint[] = [];
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = methods[method];
      if (!op) continue;
      endpoints.push({
        method: method.toUpperCase(),
        path,
        summary: op.summary ?? "",
        tags: op.tags ?? [],
        api,
      });
    }
  }
  return endpoints;
}

export function registerListApiEndpoints(
  server: McpServer,
  adminSpec: OpenApiSpec,
  storeSpec: OpenApiSpec
) {
  const adminEndpoints = extractEndpoints(adminSpec, "admin");
  const storeEndpoints = extractEndpoints(storeSpec, "store");

  server.registerTool(
    "list_api_endpoints",
    {
      description:
        "List Medusa API endpoints. Optionally filter by search term, tag, or which API (admin/store).",
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe("Filter by path or summary (case-insensitive)"),
        tag: z.string().optional().describe("Filter by OpenAPI tag"),
        api: z.enum(["admin", "store", "both"]).optional(),
      },
    },
    async ({ search, tag, api = "both" }) => {
      let endpoints =
        api === "admin"
          ? adminEndpoints
          : api === "store"
          ? storeEndpoints
          : [...adminEndpoints, ...storeEndpoints];

      if (search) {
        const q = search.toLowerCase();
        endpoints = endpoints.filter(
          (e) =>
            e.path.toLowerCase().includes(q) || e.summary.toLowerCase().includes(q)
        );
      }

      if (tag) {
        const q = tag.toLowerCase();
        endpoints = endpoints.filter((e) =>
          e.tags.some((t) => t.toLowerCase().includes(q))
        );
      }

      if (endpoints.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No endpoints found matching your criteria.",
            },
          ],
        };
      }

      const lines = endpoints.map(
        (e) => `**${e.method} ${e.path}** [${e.api}]: ${e.summary}`
      );
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
