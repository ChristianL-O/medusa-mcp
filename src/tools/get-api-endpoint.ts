import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type JsonObj = Record<string, unknown>;
type OpenApiSpec = JsonObj;

function resolveRef(spec: OpenApiSpec, ref: string): JsonObj {
  const parts = ref.replace(/^#\//, "").split("/");
  let current: unknown = spec;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return {};
    current = (current as JsonObj)[part];
  }
  return (current as JsonObj) ?? {};
}

function resolveSchema(spec: OpenApiSpec, schema: JsonObj): JsonObj {
  if (schema.$ref) {
    return resolveSchema(spec, resolveRef(spec, String(schema.$ref)));
  }
  if (schema.allOf || schema.anyOf || schema.oneOf) {
    const items = ((schema.allOf ?? schema.anyOf ?? schema.oneOf) as JsonObj[]);
    const merged: JsonObj = {};
    const props: Record<string, JsonObj> = {};
    const required: string[] = [];
    for (const item of items) {
      const resolved = resolveSchema(spec, item);
      if (resolved.properties) {
        Object.assign(props, resolved.properties as Record<string, JsonObj>);
      }
      if (resolved.required) {
        required.push(...(resolved.required as string[]));
      }
      Object.assign(merged, resolved);
    }
    if (Object.keys(props).length > 0) merged.properties = props;
    if (required.length > 0) merged.required = [...new Set(required)];
    return merged;
  }
  return schema;
}

function schemaToLines(spec: OpenApiSpec, schema: JsonObj, depth: number): string[] {
  const resolved = resolveSchema(spec, schema);
  const props = resolved.properties as Record<string, JsonObj> | undefined;
  const required = (resolved.required as string[]) ?? [];
  const indent = "  ".repeat(depth - 1);

  if (!props) {
    if (resolved.type === "array") {
      return [`${indent}(array)`];
    }
    return [];
  }

  const lines: string[] = [];
  for (const [name, rawProp] of Object.entries(props)) {
    const prop = resolveSchema(spec, rawProp as JsonObj);
    const isReq = required.includes(name);
    const req = isReq ? ", required" : "";
    const desc = prop.description ? ` — ${String(prop.description)}` : "";

    if ((prop.type === "object" || prop.properties || prop.allOf) && depth < 2) {
      lines.push(`${indent}- \`${name}\` (object${req})${desc}`);
      lines.push(...schemaToLines(spec, prop, depth + 1));
    } else if (prop.type === "object" || prop.allOf) {
      lines.push(`${indent}- \`${name}\` (object${req})${desc}`);
    } else if (prop.type === "array") {
      lines.push(`${indent}- \`${name}\` (array${req})${desc}`);
    } else {
      const type = String(prop.type ?? "unknown");
      lines.push(`${indent}- \`${name}\` (${type}${req})${desc}`);
    }
  }
  return lines;
}

function formatRequestBody(spec: OpenApiSpec, requestBody: JsonObj): string[] {
  const content = requestBody.content as JsonObj | undefined;
  const jsonContent = content?.["application/json"] as JsonObj | undefined;
  const schema = jsonContent?.schema as JsonObj | undefined;
  if (!schema) return ["(no schema)"];
  const lines = schemaToLines(spec, schema, 1);
  return lines.length > 0 ? lines : ["(no properties documented)"];
}

function formatResponse(spec: OpenApiSpec, responses: Record<string, JsonObj>): string[] {
  const code = Object.keys(responses).find((c) => c.startsWith("2"));
  if (!code) return ["(no success response documented)"];
  const resp = responses[code] as JsonObj;
  const content = resp.content as JsonObj | undefined;
  const jsonContent = content?.["application/json"] as JsonObj | undefined;
  const schema = jsonContent?.schema as JsonObj | undefined;
  if (!schema) return ["(no schema)"];
  const lines = schemaToLines(spec, schema, 1);
  return lines.length > 0 ? lines : ["(no properties documented)"];
}

export function registerGetApiEndpoint(
  server: McpServer,
  adminSpec: OpenApiSpec,
  storeSpec: OpenApiSpec
) {
  server.registerTool(
    "get_api_endpoint",
    {
      description:
        "Get detailed information about a specific Medusa API endpoint, including parameters, request body, and response schema.",
      inputSchema: {
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        path: z.string().describe("API path, e.g. /store/carts"),
        api: z
          .enum(["admin", "store"])
          .optional()
          .describe("Which API spec to search. Omit to try both."),
      },
    },
    async ({ method, path, api }) => {
      const specs: [OpenApiSpec, "admin" | "store"][] =
        api === "admin"
          ? [[adminSpec, "admin"]]
          : api === "store"
          ? [[storeSpec, "store"]]
          : [
              [adminSpec, "admin"],
              [storeSpec, "store"],
            ];

      let found:
        | { op: JsonObj; spec: OpenApiSpec; apiName: "admin" | "store" }
        | null = null;

      for (const [spec, apiName] of specs) {
        const paths = spec.paths as
          | Record<string, Record<string, JsonObj>>
          | undefined;
        const op = paths?.[path]?.[method.toLowerCase()];
        if (op) {
          found = { op, spec, apiName };
          break;
        }
      }

      if (!found) {
        return {
          content: [
            { type: "text" as const, text: `No endpoint found: ${method} ${path}` },
          ],
          isError: true,
        };
      }

      const { op, spec, apiName } = found;
      const lines: string[] = [];

      lines.push(`# ${method} ${path}`);
      lines.push(`**API:** ${apiName}`);
      if (op.summary) lines.push(`**${String(op.summary)}**`);
      if (op.description) {
        lines.push(`\n${String(op.description).slice(0, 400)}`);
      }
      lines.push("");

      // Parameters
      const params = (op.parameters as JsonObj[]) ?? [];
      if (params.length > 0) {
        lines.push("**Parameters:**");
        for (const p of params) {
          const schema = (p.schema as JsonObj) ?? {};
          const type = String(schema.type ?? "string");
          const req = p.required ? ", required" : "";
          const desc = p.description ? ` — ${String(p.description)}` : "";
          lines.push(`- \`${String(p.name)}\` (${String(p.in)}, ${type}${req})${desc}`);
        }
      } else {
        lines.push("**Parameters:** (none)");
      }
      lines.push("");

      // Request body
      const requestBody = op.requestBody as JsonObj | undefined;
      if (requestBody) {
        lines.push("**Request Body:**");
        lines.push(...formatRequestBody(spec, requestBody));
        lines.push("");
      }

      // Response
      const responses = (op.responses as Record<string, JsonObj>) ?? {};
      lines.push("**Response (2xx):**");
      lines.push(...formatResponse(spec, responses));

      return {
        content: [{ type: "text" as const, text: lines.slice(0, 100).join("\n") }],
      };
    }
  );
}
