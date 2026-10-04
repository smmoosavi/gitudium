export type FocusedPane = "commits" | "files" | "diff";
export type NavigationAction = { pane: FocusedPane; index?: number; scroll?: number; page?: number; edge?: "start" | "end" };

export function navigationKey(key: string): string {
  switch (key) {
    case "ArrowDown": return "j";
    case "ArrowUp": return "k";
    case "ArrowLeft": return "h";
    case "ArrowRight": return "l";
    default: return key;
  }
}

export function navigationAction(pane: FocusedPane, key: string, count: number, selectedIndex: number, fileCount: number): NavigationAction | null {
  key = navigationKey(key);
  if (pane === "diff") {
    if (key === "PageDown" || key === "PageUp") return { pane, page: key === "PageDown" ? 1 : -1 };
    if (key === "Home" || key === "End") return { pane, edge: key === "Home" ? "start" : "end" };
  }
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

export function focusNavigationTarget(viewer: HTMLElement | null, pane: FocusedPane, index?: number): void {
  if (!viewer) return;
  const selector = pane === "commits" ? ".commits button" : ".files button";
  const target = pane === "diff" ? viewer.querySelector<HTMLElement>(".diff-content")
    : index === undefined ? viewer.querySelector<HTMLElement>(`${selector}[aria-pressed="true"]`)
    : viewer.querySelectorAll<HTMLElement>(selector)[index];
  if (!target) return;
  for (let parent = target.parentElement; parent && parent !== viewer; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export function ignoresNavigation(event: KeyboardEvent): boolean {
  return event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    || (event.target instanceof HTMLElement && !!event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"));
}
