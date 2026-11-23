import { schemaFields } from "../schema/fields.js";
import type { SchemaField } from "../types.js";

export interface CatalogToolDoc {
  name: string;
  title: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface CatalogServerDoc {
  name: string;
  originLabel: string;
  environment?: string;
  /** Why this server has no tool sections. */
  note?: string;
  tools: readonly CatalogToolDoc[];
}

interface ContentsRow {
  title: string;
  description?: string;
  id: string;
}

/** Markdown for the tools on screen: parameters and response schemas, not a tool call. */
export function toolsMarkdown(servers: readonly CatalogServerDoc[]): string {
  if (servers.length === 0) {
    return "# Tools\n\nNo MCP servers found.\n";
  }
  const slugs = createHeadingSlugger();
  const contents: ContentsRow[] = [];
  const parts = ["# Tools", ""];
  slugs.add("Tools");
  for (const server of servers) {
    const serverName = oneLine(server.name);
    parts.push(`## ${serverName}`, "");
    slugs.add(serverName);
    const place = [server.environment, server.originLabel].filter((item) => item && item.length > 0);
    if (place.length > 0) {
      parts.push(place.join(" · "), "");
    }
    if (server.note) {
      parts.push(oneLine(server.note), "");
      continue;
    }
    if (server.tools.length === 0) {
      parts.push("This server reported no tools.", "");
      continue;
    }
    for (const tool of server.tools) {
      parts.push(...toolSection(tool, slugs, contents));
    }
  }
  if (contents.length > 0) {
    parts.splice(2, 0, contentsTable(contents), "");
  }
  return `${parts.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function contentsTable(rows: readonly ContentsRow[]): string {
  const lines = ["| Tool | Description |", "| --- | --- |"];
  for (const row of rows) {
    lines.push(`| ${toolLink(row.title, row.id)} | ${cell(row.description ?? "")} |`);
  }
  return lines.join("\n");
}

function toolLink(title: string, id: string): string {
  const label = oneLine(title).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
  return `[${label}](#${id})`;
}

function toolSection(tool: CatalogToolDoc, slugs: HeadingSlugger, contents: ContentsRow[]): string[] {
  const title = oneLine(tool.title);
  const id = slugs.add(title);
  contents.push({ title, description: tool.description, id });
  const lines = [`### ${title}`, "", `\`${codeSpan(tool.name)}\``, ""];
  if (tool.description) {
    lines.push(oneLine(tool.description), "");
  }
  lines.push("#### Parameters", "");
  slugs.add("Parameters");
  const parameters = schemaFields(tool.inputSchema);
  if (parameters.length === 0) {
    lines.push("This tool declares no parameters.", "");
  } else {
    lines.push(fieldTable(parameters), "");
  }
  lines.push("##### Parameter schema", "", jsonFence(tool.inputSchema), "");
  slugs.add("Parameter schema");
  lines.push("#### Response", "");
  slugs.add("Response");
  if (!tool.outputSchema) {
    lines.push("This tool does not declare a response schema.", "");
    return lines;
  }
  const response = schemaFields(tool.outputSchema);
  if (response.length === 0) {
    lines.push("The response schema has no fields.", "");
  } else {
    lines.push(fieldTable(response), "");
  }
  lines.push("##### Response schema", "", jsonFence(tool.outputSchema), "");
  slugs.add("Response schema");
  return lines;
}

interface HeadingSlugger {
  add(heading: string): string;
}

/** Same heading ids VS Code uses in a Markdown preview, including repeated headings. */
function createHeadingSlugger(): HeadingSlugger {
  const counts = new Map<string, number>();
  return {
    add(heading: string): string {
      const slug = githubSlug(heading);
      const seen = counts.get(slug) ?? 0;
      counts.set(slug, seen + 1);
      if (seen === 0) {
        return slug;
      }
      return githubSlug(`${slug}-${seen}`);
    },
  };
}

function githubSlug(heading: string): string {
  return heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "").replace(/\s/g, "-");
}

function fieldTable(fields: readonly SchemaField[]): string {
  const header = "| Name | Type | Required | Description |";
  const rule = "| --- | --- | --- | --- |";
  const rows = fields.map((field) => {
    const required = field.required ? "yes" : "no";
    return `| ${cell(field.name)} | ${cell(field.type)} | ${required} | ${cell(field.description ?? "")} |`;
  });
  return [header, rule, ...rows].join("\n");
}

function jsonFence(value: unknown): string {
  const json = JSON.stringify(value, null, 2) ?? "";
  const ticks = json.includes("```") ? "````" : "```";
  return `${ticks}json\n${json}\n${ticks}`;
}

function cell(value: string): string {
  return oneLine(value).replace(/\|/g, "\\|");
}

function oneLine(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

function codeSpan(value: string): string {
  const body = value.replace(/`/g, "'");
  return body;
}
