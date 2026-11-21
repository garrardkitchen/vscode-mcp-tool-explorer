/**
 * VS Code runs a tree item command on the first click, then again on the
 * double-click. Two opens of the same tool inside this window pin the tab.
 * A click on a different tool always updates the replaceable tab.
 */
export const TOOL_OPEN_WINDOW_MS = 800;

export interface ToolClickState {
  key?: string;
  at?: number;
  suppressKey?: string;
  suppressUntil?: number;
}

export type ToolClickAction = "preview" | "pin" | "ignore";

export function classifyToolClick(
  state: ToolClickState,
  key: string,
  now: number,
  windowMs = TOOL_OPEN_WINDOW_MS,
): { action: ToolClickAction; state: ToolClickState } {
  if (state.suppressKey === key && state.suppressUntil !== undefined && now < state.suppressUntil) {
    return { action: "ignore", state };
  }
  if (state.key === key && state.at !== undefined && now >= state.at && now - state.at <= windowMs) {
    return { action: "pin", state: { suppressKey: key, suppressUntil: now + windowMs } };
  }
  return { action: "preview", state: { key, at: now } };
}
