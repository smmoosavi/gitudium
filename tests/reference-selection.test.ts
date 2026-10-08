import { expect, test } from "bun:test";
import type { Reference } from "../src/repository/types";
import { completeReference, completionIndex, normalizeSelection, referenceEnterAction, referenceOptions, selectionToken } from "../src/client/referenceSelection";

test("autocomplete groups commit refs by namespace and includes HEAD", () => {
  const options = referenceOptions(["refs/tags/v1", "refs/agents/task", "refs/remotes/origin/main", "refs/heads/main"].map((name): Reference => ({
    name, kind: "branch", objectId: "id", commitId: "id", symbolicTarget: null,
  })).concat({ name: "refs/tags/blob", kind: "tag", objectId: "blob", commitId: null, symbolicTarget: null }));
  expect(options.map(option => [option.value, option.group])).toEqual([
    ["all", ""], ["HEAD", ""], ["main", "refs/heads"], ["origin/main", "refs/remotes"], ["refs/agents/task", "refs/agents"], ["v1", "refs/tags"],
  ]);
});

test("Enter completes suggestions, closes autocomplete, then focuses commits", () => {
  expect(referenceEnterAction(true, true)).toBe("complete");
  expect(referenceEnterAction(true, false)).toBe("apply");
  expect(referenceEnterAction(false, false)).toBe("focus-commits");
  expect(referenceEnterAction(false, true)).toBe("focus-commits");
});

test("typed tokens select the first suggestion without arrow navigation", () => {
  const options = referenceOptions([]).filter(option => option.value.toLowerCase().includes("head"));
  const index = completionIndex("head", -1, options.length);
  expect(index).toBe(0);
  expect(completeReference("head", 4, options[index]).text).toBe("HEAD, ");
  expect(completionIndex("main", 1, 3)).toBe(1);
  expect(completionIndex("missing", -1, 0)).toBe(-1);
});

test("an empty token after a comma never auto-selects a suggestion", () => {
  const value = "HEAD, refs/heads/graph, ";
  const token = selectionToken(value, value.length);
  expect(token.query).toBe("");
  expect(completionIndex(token.query, -1, 4)).toBe(-1);
  expect(completionIndex("   ", -1, 4)).toBe(-1);
  expect(normalizeSelection(value)).toBe("HEAD, refs/heads/graph");
  expect(completionIndex("", 2, 4)).toBe(2);
});

test("comma starts the next completion and preserves negative selection", () => {
  const value = "HEAD, main, !ori";
  expect(selectionToken(value, value.length)).toEqual({ start: 11, end: 16, negative: true, query: "ori" });
  const completed = completeReference(value, value.length, { value: "origin/main", name: "refs/remotes/origin/main", group: "refs/remotes" });
  expect(completed.text).toBe("HEAD, main, !refs/remotes/origin/main, ");
  expect(completed.caret).toBe(completed.text.length);
  expect(selectionToken(completed.text, completed.caret).query).toBe("");
});

test("completion replaces only the token at the caret", () => {
  const completed = completeReference("ma, !vis", 2, { value: "main", name: "refs/heads/main", group: "refs/heads" });
  expect(completed.text).toBe("refs/heads/main, !vis");
  expect(normalizeSelection(" HEAD, main, !refs/agents/*, , ")).toBe("HEAD, main, !refs/agents/*");
  expect(normalizeSelection("docs/*")).toBe("docs/*");
});
