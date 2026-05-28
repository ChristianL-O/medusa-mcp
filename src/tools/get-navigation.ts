import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export type NavEntry = { title: string; slug: string };

export function registerGetNavigation(server: McpServer, navigation: NavEntry[]) {
  server.registerTool(
    "get_navigation",
    {
      description:
        "Get all top-level Medusa documentation sections. Use as the starting point for drilling into specific docs with get_doc.",
      inputSchema: { format: z.enum(["json", "markdown"]).optional() },
    },
    async ({ format }) => {
      if (format === "json") {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(navigation, null, 2) }],
        };
      }
      const lines = navigation.map(
        (e, i) => `${i + 1}. **${e.title}** — \`${e.slug}\``
      );
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
