import * as fs from "fs";
import * as path from "path";
import yaml from "js-yaml";

const DOCS_PATH = "docs.md";
const CACHE_DOCS_DIR = "cache/docs";
const CACHE_API_DIR = "cache/api";
const NAVIGATION_PATH = "cache/navigation.json";

type HeadingNode = {
  level: 1 | 2 | 3;
  title: string;
  // e.g. "build-medusa-application/start-built-medusa-application/auth-locally"
  slug: string;
  // slug of direct parent, or null for H1
  parentSlug: string | null;
  lines: string[];
};

type ParentNode = {
  title: string;
  description: string;
  children: { title: string; slug: string }[];
};

type LeafNode = {
  title: string;
  description: string;
  content: string;
};

type NavEntry = {
  title: string;
  slug: string;
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function extractDescription(lines: string[]): { description: string; rest: string[] } {
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;

  const descLines: string[] = [];
  while (i < lines.length && lines[i].trim() !== "") {
    descLines.push(lines[i]);
    i++;
  }
  if (i < lines.length && lines[i].trim() === "") i++;

  return {
    description: descLines.join("\n").trim(),
    rest: lines.slice(i),
  };
}

function cleanText(text: string): string {
  return text
    .replace(/\n\*\*\*\n/g, "\n\n")
    .replace(/^\*\*\*\n/, "")
    .replace(/\n\*\*\*$/, "")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "")
    .trim();
}

function parseNodes(raw: string): HeadingNode[] {
  const lines = raw.split("\n");
  const nodes: HeadingNode[] = [];
  let current: HeadingNode | null = null;
  let inCodeBlock = false;

  // Track the slug at each level so we can build child paths
  const levelSlug: Record<number, string> = {};

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
    }

    if (!inCodeBlock) {
      const m = line.match(/^(#{1,3}) (.+)/);
      if (m) {
        if (current) nodes.push(current);

        const level = m[1].length as 1 | 2 | 3;
        const title = m[2].trim();
        const part = slugify(title);

        // Build slug as path: parent-path/this-part
        let slug: string;
        let parentSlug: string | null;

        if (level === 1) {
          slug = part;
          parentSlug = null;
          levelSlug[1] = part;
        } else if (level === 2) {
          slug = `${levelSlug[1]}/${part}`;
          parentSlug = levelSlug[1];
          levelSlug[2] = part;
        } else {
          slug = `${levelSlug[1]}/${levelSlug[2]}/${part}`;
          parentSlug = `${levelSlug[1]}/${levelSlug[2]}`;
          levelSlug[3] = part;
        }

        current = { level, title, slug, parentSlug, lines: [] };
        continue;
      }
    }

    current?.lines.push(line);
  }
  if (current) nodes.push(current);
  return nodes;
}

function resolveFilePath(slug: string, isParent: boolean): string {
  if (isParent) {
    return path.join(CACHE_DOCS_DIR, slug, "index.json");
  }
  return path.join(CACHE_DOCS_DIR, `${slug}.json`);
}

function buildCache(nodes: HeadingNode[]): void {
  // Map parentSlug → children
  const childrenMap = new Map<string, { title: string; slug: string }[]>();
  for (const node of nodes) {
    if (node.parentSlug !== null) {
      if (!childrenMap.has(node.parentSlug)) childrenMap.set(node.parentSlug, []);
      childrenMap.get(node.parentSlug)!.push({ title: node.title, slug: node.slug });
    }
  }

  const navigation: NavEntry[] = [];

  for (const node of nodes) {
    const children = childrenMap.get(node.slug);
    const isParent = !!children?.length;

    let fileContent: ParentNode | LeafNode;

    if (isParent) {
      fileContent = {
        title: node.title,
        description: cleanText(node.lines.join("\n")),
        children: children!,
      };
    } else {
      const { description, rest } = extractDescription(node.lines);
      fileContent = {
        title: node.title,
        description: cleanText(description),
        content: cleanText(rest.join("\n")),
      };
    }

    const filePath = resolveFilePath(node.slug, isParent);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(fileContent, null, 2), "utf-8");

    if (node.level === 1) {
      navigation.push({ title: node.title, slug: node.slug });
    }
  }

  fs.writeFileSync(NAVIGATION_PATH, JSON.stringify(navigation, null, 2), "utf-8");
  console.log(`navigation.json: ${navigation.length} H1 entries`);
}

function parseOpenApi(): void {
  for (const name of ["admin-spec", "store-spec"] as const) {
    const src = path.join("openapi", `${name}.yaml`);
    if (!fs.existsSync(src)) {
      console.warn(`  skip: ${src} not found`);
      continue;
    }
    const raw = fs.readFileSync(src, "utf-8");
    const parsed = yaml.load(raw);
    const dest = path.join(CACHE_API_DIR, `${name}.json`);
    fs.writeFileSync(dest, JSON.stringify(parsed), "utf-8");
    console.log(`  ${dest}`);
  }
}

function main(): void {
  // Clear old flat cache
  if (fs.existsSync(CACHE_DOCS_DIR)) {
    fs.rmSync(CACHE_DOCS_DIR, { recursive: true });
  }
  fs.mkdirSync(CACHE_DOCS_DIR, { recursive: true });

  console.log("Reading docs.md…");
  const raw = fs.readFileSync(DOCS_PATH, "utf-8");

  console.log("Parsing headings…");
  const nodes = parseNodes(raw);
  console.log(`  Found ${nodes.length} nodes (H1/H2/H3)`);

  console.log("Writing cache/docs/…");
  buildCache(nodes);
  const total = nodes.length;
  console.log(`  ${total} files written`);

  console.log("Parsing OpenAPI specs…");
  parseOpenApi();

  console.log("Done.");
}

main();
