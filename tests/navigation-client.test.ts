import { expect, test } from "bun:test";
import { navigationAction } from "../src/client/navigation";

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

test("diff navigation scrolls instead of selecting items", () => {
  expect(navigationAction("diff", "j", 2, 0, 2)).toEqual({ pane: "diff", scroll: 60 });
  expect(navigationAction("diff", "k", 2, 0, 2)).toEqual({ pane: "diff", scroll: -60 });
  expect(navigationAction("files", "x", 2, 0, 2)).toBeNull();
});
