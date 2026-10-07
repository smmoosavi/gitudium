import { expect, test } from "bun:test";
import { focusNavigationTarget, navigationAction, navigationKey, parentNavigationAction } from "../src/client/navigation";
import { coordinateNavigation, listenForNavigation, type KeyboardNavigationState } from "../src/client/useKeyboardNavigation";

test("navigation transfers DOM focus to the destination item or diff", () => {
  const calls: string[] = [];
  const target = (name: string) => ({
    parentElement: null,
    focus: (options: FocusOptions) => { expect(options.preventScroll).toBe(true); calls.push(name); },
    scrollIntoView: () => {},
  });
  const commit = target("commit");
  const file = target("file");
  const diff = target("diff");
  const viewer = {
    querySelector: (selector: string) => selector === ".diff-content" ? diff : selector.startsWith(".commits") ? commit : file,
    querySelectorAll: (selector: string) => selector === ".commits button" ? [target("old commit"), commit] : [target("old file"), file],
  } as unknown as HTMLElement;
  focusNavigationTarget(viewer, "commits", 1);
  focusNavigationTarget(viewer, "files", 1);
  focusNavigationTarget(viewer, "diff");
  focusNavigationTarget(viewer, "files");
  focusNavigationTarget(viewer, "commits");
  focusNavigationTarget(viewer, "files", 10);
  focusNavigationTarget(null, "commits");
  expect(calls).toEqual(["commit", "file", "diff", "file", "commit"]);
});

test("virtual commit navigation uses absolute dataset indices, not mounted row positions", () => {
  let selector = "";
  const viewer = {
    querySelector: (value: string) => { selector = value; return null; },
    querySelectorAll: () => { throw new Error("Mounted row positions are not dataset indices"); },
  } as unknown as HTMLElement;
  focusNavigationTarget(viewer, "commits", 9999);
  expect(selector).toBe('.commits button[data-commit-index="9999"]');
});

test("parent selections scroll into view without taking focus from the active pane", () => {
  const scrolled: string[] = [];
  const target = (name: string) => ({
    parentElement: null,
    focus: () => { throw new Error("Parent navigation must not move focus"); },
    scrollIntoView: (options: ScrollIntoViewOptions) => {
      expect(options).toEqual({ block: "nearest", inline: "nearest" });
      scrolled.push(name);
    },
  });
  const commit = target("selected commit");
  const file = target("selected file");
  const viewer = {
    querySelector: (selector: string) => selector === '.commits button[aria-pressed="true"]' ? commit : file,
  } as unknown as HTMLElement;
  focusNavigationTarget(viewer, "commits", undefined, false);
  focusNavigationTarget(viewer, "files", undefined, false);
  expect(scrolled).toEqual(["selected commit", "selected file"]);
});

test("arrow keys match hjkl navigation in every pane", () => {
  for (const [arrow, key] of [["ArrowDown", "j"], ["ArrowUp", "k"], ["ArrowLeft", "h"], ["ArrowRight", "l"]] as const) {
    expect(navigationKey(arrow)).toBe(key);
    for (const pane of ["commits", "files", "diff"] as const) {
      for (const [count, index] of [[3, 1], [3, -1], [0, -1]] as const) {
        expect(navigationAction(pane, arrow, count, index, count)).toEqual(navigationAction(pane, key, count, index, count));
      }
    }
  }
  expect(navigationKey("x")).toBe("x");
});

test("j and k move one item and stop at list boundaries", () => {
  for (const pane of ["commits", "files"] as const) {
    expect(navigationAction(pane, "j", 3, 0, 3)).toEqual({ pane, index: 1 });
    expect(navigationAction(pane, "k", 3, 2, 3)).toEqual({ pane, index: 1 });
    expect(navigationAction(pane, "j", 3, 2, 3)).toEqual({ pane, index: 2 });
    expect(navigationAction(pane, "k", 3, 0, 3)).toEqual({ pane, index: 0 });
    expect(navigationAction(pane, "j", 3, -1, 3)).toEqual({ pane, index: 0 });
    expect(navigationAction(pane, "k", 3, -1, 3)).toEqual({ pane, index: 0 });
    expect(navigationAction(pane, "j", 0, -1, 0)).toBeNull();
  }
});

test("l and h move focus through commits, files, and diff", () => {
  expect(navigationAction("commits", "l", 2, -1, 2)).toEqual({ pane: "files", index: 0 });
  expect(navigationAction("commits", "l", 2, 1, 2)).toEqual({ pane: "files" });
  expect(navigationAction("files", "l", 2, 1, 2)).toEqual({ pane: "diff" });
  expect(navigationAction("diff", "h", 2, 1, 2)).toEqual({ pane: "files" });
  expect(navigationAction("files", "h", 2, 1, 2)).toEqual({ pane: "commits" });
  expect(navigationAction("commits", "h", 2, 1, 2)).toEqual({ pane: "commits" });
  expect(navigationAction("diff", "l", 2, 1, 2)).toBeNull();
});

test("empty commits cannot move focus to files", () => {
  expect(navigationAction("commits", "l", 0, -1, 0)).toBeNull();
  expect(navigationAction("commits", "j", 3, 0, 0)).toEqual({ pane: "commits", index: 1 });
  expect(navigationAction("commits", "k", 3, 1, 0)).toEqual({ pane: "commits", index: 0 });
});

test("diff supports page scrolling and jumping to the start or end", () => {
  expect(navigationAction("diff", "PageDown", 2, 0, 2)).toEqual({ pane: "diff", page: 1 });
  expect(navigationAction("diff", "PageUp", 2, 0, 2)).toEqual({ pane: "diff", page: -1 });
  expect(navigationAction("diff", "Home", 2, 0, 2)).toEqual({ pane: "diff", edge: "start" });
  expect(navigationAction("diff", "End", 2, 0, 2)).toEqual({ pane: "diff", edge: "end" });
  for (const pane of ["commits", "files"] as const) {
    for (const key of ["PageDown", "PageUp", "Home", "End"]) {
      expect(navigationAction(pane, key, 2, 0, 2)).toBeNull();
    }
  }
});

test("n and p navigate parent items without changing the focused pane", () => {
  for (const pane of ["files", "diff"] as const) {
    expect(parentNavigationAction(pane, "n", 3, 0)).toEqual({ pane, index: 1 });
    expect(parentNavigationAction(pane, "p", 3, 2)).toEqual({ pane, index: 1 });
    expect(parentNavigationAction(pane, "n", 3, 2)).toEqual({ pane, index: 2 });
    expect(parentNavigationAction(pane, "p", 3, 0)).toEqual({ pane, index: 0 });
    expect(parentNavigationAction(pane, "n", 3, -1)).toEqual({ pane, index: 0 });
    expect(parentNavigationAction(pane, "p", 3, -1)).toEqual({ pane, index: 0 });
    expect(parentNavigationAction(pane, "n", 0, -1)).toBeNull();
    expect(parentNavigationAction(pane, "j", 3, 0)).toBeNull();
  }
  for (const key of ["n", "p"]) {
    expect(parentNavigationAction("commits", key, 3, 1)).toBeNull();
    expect(navigationAction("commits", key, 3, 1, 3)).toBeNull();
    expect(navigationAction("files", key, 3, 1, 3)).toBeNull();
    expect(navigationAction("diff", key, 3, 1, 3)).toEqual({ pane: "diff", index: key === "n" ? 2 : 0 });
    expect(navigationAction("diff", key, 0, -1, 0)).toBeNull();
  }
});

test("diff navigation scrolls instead of selecting items", () => {
  expect(navigationAction("diff", "j", 2, 0, 2)).toEqual({ pane: "diff", scroll: 60 });
  expect(navigationAction("diff", "k", 2, 0, 2)).toEqual({ pane: "diff", scroll: -60 });
  expect(navigationAction("files", "x", 2, 0, 2)).toBeNull();
});

test("coordinator dispatches exactly one action to the correct pane adapter", () => {
  const calls: unknown[] = [];
  const state: KeyboardNavigationState = {
    focusedPane: "commits",
    commits: { count: 300, selectedIndex: 24, select: index => calls.push(["select", index]), reveal: (index, focus) => calls.push(["reveal", index, focus]) },
    details: { current: { count: 3, selectedIndex: 1, apply: action => calls.push(action) } },
  };
  const run = (key: string) => { calls.length = 0; coordinateNavigation(state, key, () => calls.push("prevent")); return [...calls]; };
  expect(run("ArrowDown")).toEqual(["prevent", ["select", 25], ["reveal", 25, true]]);
  expect(run("l")).toEqual(["prevent", { pane: "files" }]);
  expect(run("h")).toEqual([]);
  state.focusedPane = "files";
  expect(run("n")).toEqual(["prevent", ["select", 25], ["reveal", 25, false]]);
  expect(run("p")).toEqual(["prevent", ["select", 23], ["reveal", 23, false]]);
  expect(run("j")).toEqual(["prevent", { pane: "files", index: 2 }]);
  expect(run("h")).toEqual(["prevent", { pane: "commits" }]);
  state.focusedPane = "diff";
  expect(run("n")).toEqual(["prevent", { pane: "diff", index: 2 }]);
  expect(run("p")).toEqual(["prevent", { pane: "diff", index: 0 }]);
  expect(run("End")).toEqual(["prevent", { pane: "diff", edge: "end" }]);
  expect(run("ArrowDown")).toEqual(["prevent", { pane: "diff", scroll: 60 }]);
  state.details.current = null;
  expect(run("h")).toEqual([]);
  state.focusedPane = "commits";
  expect(run("l")).toEqual([]);
  state.details.current = { count: 0, selectedIndex: -1, apply: action => calls.push(action) };
  expect(run("l")).toEqual([]);
});

test("keyboard listener cleanup and re-registration do not duplicate or retain old state", () => {
  const target = new EventTarget();
  const calls: number[] = [];
  const state: KeyboardNavigationState = {
    focusedPane: "commits",
    commits: { count: 10, selectedIndex: 0, select: index => calls.push(index), reveal: () => {} },
    details: { current: null },
  };
  const register = () => listenForNavigation(target as unknown as Window, state);
  const send = (overrides: Record<string, unknown> = {}) => {
    const event = new Event("keydown", { cancelable: true });
    Object.defineProperties(event, Object.fromEntries(Object.entries({ key: "j", ...overrides }).map(([key, value]) => [key, { value }])));
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const OriginalHTMLElement = globalThis.HTMLElement;
  // The event target is deliberately not an editable DOM element.
  globalThis.HTMLElement = class {} as typeof HTMLElement;
  try {
    const firstCleanup = register();
    firstCleanup();
    const cleanup = register();
    expect(send()).toBe(true);
    expect(calls).toEqual([1]);
    for (const flag of ["altKey", "ctrlKey", "metaKey", "shiftKey", "isComposing"]) expect(send({ [flag]: true })).toBe(false);
    expect(send({ defaultPrevented: true })).toBe(true);
    expect(calls).toEqual([1]);
    cleanup();
    state.commits.selectedIndex = 5;
    expect(send()).toBe(false);
    const remountCleanup = register();
    expect(send()).toBe(true);
    expect(calls).toEqual([1, 6]);
    remountCleanup();
    expect(send()).toBe(false);
  } finally {
    globalThis.HTMLElement = OriginalHTMLElement;
  }
});
