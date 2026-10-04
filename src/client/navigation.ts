export type FocusedPane = "commits" | "files" | "diff";
export type NavigationAction = { pane: FocusedPane; index?: number; scroll?: number };

export function navigationAction(pane: FocusedPane, key: string, count: number, selectedIndex: number, fileCount: number): NavigationAction | null {
  if (key === "h") return { pane: pane === "diff" ? "files" : "commits" };
  if (key === "l") {
    if (!fileCount || pane === "diff") return null;
    return { pane: pane === "commits" ? "files" : "diff", ...(pane === "commits" && selectedIndex < 0 ? { index: 0 } : {}) };
  }
  if (key !== "j" && key !== "k") return null;
  if (pane === "diff") return { pane, scroll: key === "j" ? 60 : -60 };
  if (!count) return null;
  return { pane, index: selectedIndex < 0 ? 0 : Math.max(0, Math.min(count - 1, selectedIndex + (key === "j" ? 1 : -1))) };
}

export function ignoresNavigation(event: KeyboardEvent): boolean {
  return event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    || (event.target instanceof HTMLElement && !!event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"));
}
