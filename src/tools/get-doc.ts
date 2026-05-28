import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export type DocSlug = { slug: string; isParent: boolean };

type NodeData = Record<string, unknown>;

function readNode(docsDir: string, slug: string): { data: NodeData; isParent: boolean } | null {
  const parentPath = join(docsDir, slug, "index.json");
  if (existsSync(parentPath)) {
    return { data: JSON.parse(readFileSync(parentPath, "utf-8")) as NodeData, isParent: true };
  }
  const leafPath = join(docsDir, `${slug}.json`);
  if (existsSync(leafPath)) {
    return { data: JSON.parse(readFileSync(leafPath, "utf-8")) as NodeData, isParent: false };
  }
  return null;
}

function formatNode(data: NodeData, isParent: boolean): string {
  const title = String(data.title ?? "");
  const description = String(data.description ?? "");

  if (isParent) {
    const children = (data.children as Array<{ title: string; slug: string }>) ?? [];
    const childLines = children.map((c) => `- \`${c.slug}\` — ${c.title}`);
    return `# ${title}\n\n${description}\n\n## Sections\n${childLines.join("\n")}`;
  }

  const content = String(data.content ?? "");
  return `# ${title}\n\n${description}\n\n---\n\n${content}`;
}

export function registerGetDoc(
  server: McpServer,
  docSlugs: DocSlug[],
  docsDir: string
) {
  server.registerTool(
    "get_doc",
    {
      description:
        "Get a Medusa documentation page by slug. Parent pages list their subsections; leaf pages contain full content. Use get_navigation to find slugs.",
      inputSchema: {
        slug: z.string().describe("Document slug from get_navigation or search_docs"),
      },
    },
    async ({ slug }) => {
      const exact = readNode(docsDir, slug);
      if (exact) {
        return {
          content: [{ type: "text" as const, text: formatNode(exact.data, exact.isParent) }],
        };
      }

      const matches = docSlugs.filter((d) => d.slug.includes(slug));
      if (matches.length === 0) {
        return {
          content: [
            { type: "text" as const, text: `No document found for slug: "${slug}"` },
          ],
          isError: true,
        };
      }

      const best = matches.sort((a, b) => a.slug.length - b.slug.length)[0];
      const node = readNode(docsDir, best.slug);
      if (!node) {
        return {
          content: [{ type: "text" as const, text: `Failed to read document: "${best.slug}"` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: formatNode(node.data, node.isParent) }],
      };
    }
  );
}
