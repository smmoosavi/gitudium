import { useEffect, type RefObject } from "react";
import { ignoresNavigation, navigationAction, navigationKey, parentNavigationAction, type FocusedPane, type NavigationAction } from "./navigation";

export interface CommitNavigationAdapter {
  count: number;
  selectedIndex: number;
  select: (index: number) => void;
  reveal: (index: number, focus: boolean) => void;
}

export interface DetailNavigationAdapter {
  count: number;
  selectedIndex: number;
  apply: (action: NavigationAction) => void;
}

export interface KeyboardNavigationState {
  focusedPane: FocusedPane;
  commits: CommitNavigationAdapter;
  details: RefObject<DetailNavigationAdapter | null>;
  focusReferences?: () => void;
}

export function coordinateNavigation(state: KeyboardNavigationState, key: string, preventDefault: () => void): boolean {
  key = navigationKey(key);
  const { focusedPane, commits } = state;
  if (focusedPane === "commits" && key === "h" && state.focusReferences) {
    preventDefault();
    state.focusReferences();
    return true;
  }
  const parent = focusedPane === "files"
    ? parentNavigationAction(focusedPane, key, commits.count, commits.selectedIndex)
    : focusedPane === "commits" && ["j", "k", "Home", "End"].includes(key)
      ? navigationAction("commits", key, commits.count, commits.selectedIndex, 0)
      : null;
  if (parent?.index !== undefined) {
    preventDefault();
    commits.select(parent.index);
    commits.reveal(parent.index, parent.pane === "commits");
    return true;
  }
  const details = state.details.current;
  if (!details || (focusedPane === "commits" && key !== "l")) return false;
  const action = navigationAction(focusedPane, key, details.count, details.selectedIndex, details.count);
  if (!action) return false;
  preventDefault();
  details.apply(action);
  return true;
}

export function listenForNavigation(target: Pick<Window, "addEventListener" | "removeEventListener">, state: KeyboardNavigationState): () => void {
  const handleKey = (event: KeyboardEvent) => {
    if (ignoresNavigation(event)) return;
    coordinateNavigation(state, event.key, () => event.preventDefault());
  };
  target.addEventListener("keydown", handleKey);
  return () => target.removeEventListener("keydown", handleKey);
}

export function useKeyboardNavigation(state: KeyboardNavigationState): void {
  useEffect(() => listenForNavigation(window, state), [state]);
}
