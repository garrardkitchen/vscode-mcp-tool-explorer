export interface ToolCallSummary {
  isError: boolean;
  texts: string[];
  structuredText?: string;
  notes: string[];
}

const TEXT_LIMIT = 200_000;

/** Turns a `tools/call` result into text that the detail view can show. */
export function summarizeToolResult(result: unknown): ToolCallSummary {
  const record = isRecord(result) ? result : {};
  const texts: string[] = [];
  const notes: string[] = [];
  const content = Array.isArray(record.content) ? record.content : [];
  for (const block of content) {
    appendBlock(block, texts, notes);
  }
  let structuredText: string | undefined;
  if ("structuredContent" in record && record.structuredContent !== undefined) {
    structuredText = clip(safeJson(record.structuredContent), notes);
  }
  return {
    isError: record.isError === true,
    texts,
    structuredText,
    notes,
  };
}

function appendBlock(block: unknown, texts: string[], notes: string[]): void {
  if (!isRecord(block)) {
    notes.push("Skipped a content block that was not an object.");
    return;
  }
  const type = typeof block.type === "string" ? block.type : "unknown";
  if (type === "text" && typeof block.text === "string") {
    texts.push(clip(block.text, notes));
    return;
  }
  if ((type === "image" || type === "audio") && typeof block.data === "string") {
    const mime = typeof block.mimeType === "string" ? block.mimeType : type;
    const label = type === "image" ? "Image" : "Audio";
    notes.push(`${label} (${mime}, ${block.data.length} base64 characters). The bytes are not shown.`);
    return;
  }
  if (type === "resource" && isRecord(block.resource)) {
    const uri = typeof block.resource.uri === "string" ? block.resource.uri : "resource";
    if (typeof block.resource.text === "string") {
      texts.push(clip(`${uri}\n${block.resource.text}`, notes));
      return;
    }
    const blob = typeof block.resource.blob === "string" ? block.resource.blob.length : 0;
    notes.push(`Resource ${uri} (${blob} base64 characters). The bytes are not shown.`);
    return;
  }
  if (type === "resource_link") {
    const uri = typeof block.uri === "string" ? block.uri : "resource";
    notes.push(`Resource link ${uri}`);
    return;
  }
  notes.push(`Content type ${type} is not shown.`);
}

function clip(value: string, notes: string[]): string {
  if (value.length <= TEXT_LIMIT) {
    return value;
  }
  notes.push(`Omitted ${value.length - TEXT_LIMIT} characters from a long response.`);
  return value.slice(0, TEXT_LIMIT);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
