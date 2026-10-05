import { expect, test } from "bun:test";
import { focusNavigationTarget, navigationAction, navigationKey, parentNavigationAction } from "../src/client/navigation";

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
