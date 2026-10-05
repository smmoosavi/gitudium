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

export function parentNavigationAction(pane: FocusedPane, key: string, count: number, selectedIndex: number): NavigationAction | null {
  if (pane === "commits" || (key !== "n" && key !== "p") || !count) return null;
  return { pane, index: selectedIndex < 0 ? 0 : Math.max(0, Math.min(count - 1, selectedIndex + (key === "n" ? 1 : -1))) };
}

export function navigationAction(pane: FocusedPane, key: string, count: number, selectedIndex: number, fileCount: number): NavigationAction | null {
  key = navigationKey(key);
  if (pane === "diff") {
    if (key === "n" || key === "p") return parentNavigationAction(pane, key, count, selectedIndex);
    if (key === "j") return { pane, scroll: 60 };
    if (key === "k") return { pane, scroll: -60 };
    if (key === "h") return { pane: "files" };
    if (key === "l") return null;
    if (key === "PageDown") return { pane, page: 1 };
    if (key === "PageUp") return { pane, page: -1 };
    if (key === "Home") return { pane, edge: "start" };
    if (key === "End") return { pane, edge: "end" };
  }
  if (pane === "files") {
    if (key === "j") {
      if (!count) return null;
      return { pane, index: selectedIndex < 0 ? 0 : Math.max(0, Math.min(count - 1, selectedIndex + 1)) };
    }
    if (key === "k") {
      if (!count) return null;
      return { pane, index: selectedIndex < 0 ? 0 : Math.max(0, Math.min(count - 1, selectedIndex - 1)) };
    }
    if (key === "h") return { pane: "commits" };
    if (key === "l") {
      if (!fileCount) return null;
      return { pane: "diff" };
    }
  }
  if (pane === "commits") {
    if (key === "j") {
      if (!count) return null;
      return { pane, index: selectedIndex < 0 ? 0 : Math.max(0, Math.min(count - 1, selectedIndex + 1)) };
    }
    if (key === "k") {
      if (!count) return null;
      return { pane, index: selectedIndex < 0 ? 0 : Math.max(0, Math.min(count - 1, selectedIndex - 1)) };
    }
    if (key === "h") return { pane: "commits" };
    if (key === "l") {
      if (!fileCount) return null;
      if (selectedIndex < 0) return { pane: "files", index: 0 };
      return { pane: "files" };
    }
  }
  return null;
}

export function focusNavigationTarget(viewer: HTMLElement | null, pane: FocusedPane, index?: number, focus = true): void {
  if (!viewer) return;
  const selector = pane === "commits" ? ".commits button" : ".files button";
  const target = pane === "diff" ? viewer.querySelector<HTMLElement>(".diff-content")
    : index === undefined ? viewer.querySelector<HTMLElement>(`${selector}[aria-pressed="true"]`)
    : pane === "commits" ? viewer.querySelector<HTMLElement>(`${selector}[data-commit-index="${index}"]`)
    : viewer.querySelectorAll<HTMLElement>(selector)[index];
  if (!target) return;
  for (let parent = target.parentElement; parent && parent !== viewer; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  if (focus) target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export function ignoresNavigation(event: KeyboardEvent): boolean {
  return event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    || (event.target instanceof HTMLElement && !!event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"));
}
