import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffPatch } from "../src/client/DiffPatch";
import { diffStorageKey, effectiveDiffMode, readDiffMode, splitPatch, writeDiffMode } from "../src/client/diff";

test("diff mode persists and tolerates missing or blocked storage", () => {
  let saved: string | null = null;
  const storage = { getItem: () => saved, setItem: (key: string, value: string) => { expect(key).toBe(diffStorageKey); saved = value; } };
  expect(readDiffMode(storage)).toBe("unified");
  writeDiffMode(storage, "split");
  expect(readDiffMode(storage)).toBe("split");
  writeDiffMode(storage, "unified");
  expect(readDiffMode(storage)).toBe("unified");
  expect(readDiffMode({ getItem: () => "unknown" })).toBe("unified");
  expect(readDiffMode({ getItem: () => { throw Error(); } })).toBe("unified");
  expect(() => writeDiffMode({ setItem: () => { throw Error(); } }, "split")).not.toThrow();
});

test("added and deleted files use unified without changing the preferred mode", () => {
  for (const status of ["added", "deleted"]) expect(effectiveDiffMode("split", status)).toBe("unified");
  for (const status of ["modified", "type-changed", undefined]) expect(effectiveDiffMode("split", status)).toBe("split");
  expect(effectiveDiffMode("unified", "modified")).toBe("unified");
});

test("split patch aligns unequal replacements, context and multiple hunks", () => {
  const rows = splitPatch("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -2,4 +2,3 @@\n context\n-old one\n-old two\n+new\n tail\n@@ -20 +19,2 @@ title\n-old\n+new one\n+new two\n");
  expect(rows.slice(0, 4).every(row => "header" in row)).toBe(true);
  expect(rows[4]).toEqual({ left: { text: "context", number: 2, kind: "context" }, right: { text: "context", number: 2, kind: "context" } });
  expect(rows[5]).toEqual({ left: { text: "old one", number: 3, kind: "deletion" }, right: { text: "new", number: 3, kind: "addition" } });
  expect(rows[6]).toEqual({ left: { text: "old two", number: 4, kind: "deletion" }, right: undefined });
  expect(rows[7]).toEqual({ left: { text: "tail", number: 5, kind: "context" }, right: { text: "tail", number: 4, kind: "context" } });
  expect(rows.at(-1)).toEqual({ left: undefined, right: { text: "new two", number: 20, kind: "addition" } });
});

test("split patch preserves empty lines and no-newline markers", () => {
  const rows = splitPatch("@@ -1 +1 @@\n-\n\\ No newline at end of file\n+\n\\ No newline at end of file\n");
  expect(rows[1]).toEqual({ left: { text: "", number: 1, kind: "deletion", noNewline: true }, right: { text: "", number: 1, kind: "addition", noNewline: true } });
  expect(splitPatch("@@ -0,0 +1 @@\n+new\n")[1]).toEqual({ left: undefined, right: { text: "new", number: 1, kind: "addition" } });
});

test("renderer escapes file content and produces only one pane in unified mode", () => {
  const patch = "@@ -1 +1 @@\n-<script>old</script>\n+<b>new</b>\n";
  const split = renderToStaticMarkup(createElement(DiffPatch, { patch, mode: "split" }));
  expect(split).toContain("Before changes");
  expect(split).toContain("After changes");
  expect(split).toContain("&lt;script&gt;");
  expect(split).not.toContain("<script>");
  const unified = renderToStaticMarkup(createElement(DiffPatch, { patch, mode: effectiveDiffMode("split", "added") }));
  expect(unified).toContain('class="patch"');
  expect(unified).not.toContain("split-side");
});
