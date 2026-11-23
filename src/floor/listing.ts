import { compareTools } from "../catalog.js";
import type { EnvironmentId } from "./environment.js";

export type EnvFilter = "ALL" | EnvironmentId;
/** `asc` is A–Z by the label on the row. `desc` is that order reversed. */
export type ToolOrder = "asc" | "desc";

export interface FloorServerInput {
  id: string;
  name: string;
  originLabel: string;
  skipReason?: string;
  notice?: string;
  credentials: boolean;
  environment?: EnvironmentId;
  /** Undefined while this server's tools are still being read. */
  tools?: FloorToolInput[];
  error?: string;
}

export interface FloorToolInput {
  name: string;
  title?: string;
  description?: string;
  iconPath?: string;
  iconSvg?: string;
  favourite: boolean;
  /** The tool has been run from Try on this machine. */
  used?: boolean;
}

export interface FloorShelfServer {
  id: string;
  name: string;
  originLabel: string;
  environment?: EnvironmentId;
  credentials: boolean;
  selected: boolean;
  /** Set while a search is active and this server's tools are loaded. */
  matchCount?: number;
  status?: string;
  notice?: string;
}

export interface FloorToolView {
  serverId: string;
  serverName: string;
  originLabel: string;
  environment?: EnvironmentId;
  name: string;
  title: string;
  description?: string;
  iconPath?: string;
  iconSvg?: string;
  favourite: boolean;
  used: boolean;
  showServer: boolean;
}

export interface FloorView {
  selectedId?: string;
  servers: FloorShelfServer[];
  favourites: FloorToolView[];
  tools: FloorToolView[];
  message?: string;
  pendingNote?: string;
}

export function visibleServers<T extends { environment?: EnvironmentId }>(servers: readonly T[], filter: EnvFilter): T[] {
  if (filter === "ALL") {
    return [...servers];
  }
  return servers.filter((server) => server.environment === filter);
}

/** A query matches the tool, its server, or where that server was configured. */
export function toolMatchesQuery(
  query: string,
  tool: { name: string; title?: string; description?: string },
  serverName: string,
  originLabel: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) {
    return true;
  }
  const haystack = [tool.title ?? "", tool.name, tool.description ?? "", serverName, originLabel]
    .join("\n")
    .toLocaleLowerCase();
  return haystack.includes(needle);
}

/**
 * With an empty query, only the selected server is listed.
 * A query loads every visible server, selected server first.
 * Skipped servers are never started.
 */
export function serverIdsToLoad(
  servers: readonly { id: string; environment?: EnvironmentId; skipReason?: string }[],
  selectedId: string | undefined,
  query: string,
  filter: EnvFilter,
): string[] {
  const visible = visibleServers(servers, filter).filter((server) => !server.skipReason);
  if (query.trim().length === 0) {
    const selected = visible.find((server) => server.id === selectedId) ?? visible[0];
    return selected ? [selected.id] : [];
  }
  const first = visible.filter((server) => server.id === selectedId);
  const rest = visible.filter((server) => server.id !== selectedId);
  return [...first, ...rest].map((server) => server.id);
}

/** Favourites stay above the other tools. Both groups use the tool list order. */
export function buildFloorView(input: {
  servers: readonly FloorServerInput[];
  selectedId?: string;
  query: string;
  envFilter: EnvFilter;
  usedOnly?: boolean;
  toolOrder?: ToolOrder;
}): FloorView {
  const usedOnly = input.usedOnly === true;
  const toolOrder = input.toolOrder === "desc" ? "desc" : "asc";
  const visible = visibleServers(input.servers, input.envFilter);
  const selectedId = visible.some((server) => server.id === input.selectedId)
    ? input.selectedId
    : visible[0]?.id;
  const searching = input.query.trim().length > 0;
  const servers = visible.map((server) => toShelf(server, selectedId, input.query, searching, usedOnly));

  if (!searching) {
    return { selectedId, servers, ...toolsForSelected(visible, selectedId, input.envFilter, usedOnly, toolOrder) };
  }
  return { selectedId, servers, ...toolsForSearch(visible, input.query, usedOnly, toolOrder) };
}

/** Favourites stay first. Each group follows the chosen order. */
export function sortListedTools<T extends { name: string; title?: string; favourite: boolean }>(
  rows: readonly T[],
  order: ToolOrder,
): T[] {
  const direction = order === "desc" ? -1 : 1;
  const byLabel = (left: T, right: T) => direction * compareTools(left, right);
  const favourites = rows.filter((row) => row.favourite).sort(byLabel);
  const others = rows.filter((row) => !row.favourite).sort(byLabel);
  return [...favourites, ...others];
}

function toShelf(
  server: FloorServerInput,
  selectedId: string | undefined,
  query: string,
  searching: boolean,
  usedOnly: boolean,
): FloorShelfServer {
  let matchCount: number | undefined;
  if (searching && !server.skipReason && server.tools) {
    matchCount = server.tools.filter((tool) => toolMatchesQuery(query, tool, server.name, server.originLabel) && (!usedOnly || tool.used === true)).length;
  }
  return {
    id: server.id,
    name: server.name,
    originLabel: server.originLabel,
    environment: server.environment,
    credentials: server.credentials,
    selected: server.id === selectedId,
    matchCount,
    status: server.skipReason ?? server.error,
    notice: server.notice,
  };
}

function toolsForSelected(
  visible: readonly FloorServerInput[],
  selectedId: string | undefined,
  filter: EnvFilter,
  usedOnly: boolean,
  toolOrder: ToolOrder,
): Pick<FloorView, "favourites" | "tools" | "message" | "pendingNote"> {
  const current = visible.find((server) => server.id === selectedId);
  if (!current) {
    const message = filter === "ALL" ? "No MCP servers found." : "No servers in this environment.";
    return { favourites: [], tools: [], message };
  }
  if (current.skipReason) {
    return { favourites: [], tools: [], message: current.skipReason };
  }
  if (current.error) {
    return { favourites: [], tools: [], message: current.error };
  }
  if (!current.tools) {
    return { favourites: [], tools: [], message: "Loading tools…", pendingNote: undefined };
  }
  if (current.tools.length === 0) {
    return { favourites: [], tools: [], message: "This server reported no tools." };
  }
  const rows = current.tools.map((tool) => toRow(current, tool, false));
  const shown = usedOnly ? rows.filter((row) => row.used) : rows;
  if (shown.length === 0) {
    return { favourites: [], tools: [], message: "No used tools." };
  }
  const split = splitFavourites(shown, toolOrder);
  return { favourites: split.favourites, tools: split.others };
}

function toolsForSearch(
  visible: readonly FloorServerInput[],
  query: string,
  usedOnly: boolean,
  toolOrder: ToolOrder,
): Pick<FloorView, "favourites" | "tools" | "message" | "pendingNote"> {
  const rows: FloorToolView[] = [];
  let pending = false;
  for (const server of visible) {
    if (server.skipReason) {
      continue;
    }
    if (!server.tools) {
      pending = true;
      continue;
    }
    if (server.error) {
      continue;
    }
    for (const tool of server.tools) {
      if (toolMatchesQuery(query, tool, server.name, server.originLabel)) {
        rows.push(toRow(server, tool, true));
      }
    }
  }
  const shown = usedOnly ? rows.filter((row) => row.used) : rows;
  const split = splitFavourites(shown, toolOrder);
  const pendingNote = pending ? "Still checking the other servers." : undefined;
  const failed = visible.find((server) => server.error)?.error;
  let message: string | undefined;
  if (shown.length === 0 && !pending) {
    message = rows.length > 0 && usedOnly ? "No used tools." : (failed ?? "No tools match.");
  }
  return { favourites: split.favourites, tools: split.others, message, pendingNote };
}

function toRow(server: FloorServerInput, tool: FloorToolInput, showServer: boolean): FloorToolView {
  return {
    serverId: server.id,
    serverName: server.name,
    originLabel: server.originLabel,
    environment: server.environment,
    name: tool.name,
    title: tool.title && tool.title.length > 0 ? tool.title : tool.name,
    description: tool.description,
    iconPath: tool.iconPath,
    iconSvg: tool.iconSvg,
    favourite: tool.favourite,
    used: tool.used === true,
    showServer,
  };
}

function splitFavourites(rows: FloorToolView[], order: ToolOrder): { favourites: FloorToolView[]; others: FloorToolView[] } {
  const sorted = sortListedTools(rows, order);
  return {
    favourites: sorted.filter((row) => row.favourite),
    others: sorted.filter((row) => !row.favourite),
  };
}
