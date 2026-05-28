import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export type LeafDoc = {
  slug: string;
  title: string;
  description: string;
  content: string;
};

export function registerSearchDocs(server: McpServer, leaves: LeafDoc[]) {
  server.registerTool(
    "search_docs",
    {
      description:
        "Search Medusa documentation by keyword. Searches only leaf pages (pages with full content). Title matches are weighted 10x higher than body matches.",
      inputSchema: {
        query: z.string().describe("Search query"),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ query, limit = 10 }) => {
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"));

      const scored = leaves
        .map((leaf) => {
          let score = 0;
          const body = leaf.description + " " + leaf.content;
          for (const re of words) {
            score += (leaf.title.match(re) ?? []).length * 10;
            score += (body.match(re) ?? []).length;
          }
          return { leaf, score };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      if (scored.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No results for "${query}"` }],
        };
      }

      const lines = [`${scored.length} results for "${query}"\n`];
      for (const { leaf } of scored) {
        const snippet =
          leaf.content.slice(0, 150).replace(/\n+/g, " ").trimEnd() + "...";
        lines.push(
          `**${leaf.title}** \`${leaf.slug}\`\n${leaf.description}\n> ${snippet}\n`
        );
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
