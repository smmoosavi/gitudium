import { expect, test } from "bun:test";
import type { Reference } from "../src/repository/types";
import { completeReference, normalizeSelection, referenceOptions, selectionToken } from "../src/client/referenceSelection";

test("autocomplete groups commit refs by namespace and includes HEAD", () => {
  const options = referenceOptions(["refs/heads/main", "refs/remotes/origin/main", "refs/agents/task", "refs/tags/v1"].map((name): Reference => ({
    name, kind: "branch", objectId: "id", commitId: "id", symbolicTarget: null,
  })).concat({ name: "refs/tags/blob", kind: "tag", objectId: "blob", commitId: null, symbolicTarget: null }));
  expect(options.map(option => [option.value, option.group])).toEqual([
    ["HEAD", "HEAD"], ["main", "refs/heads"], ["origin/main", "refs/remotes"], ["refs/agents/task", "refs/agents"], ["v1", "refs/tags"],
  ]);
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
