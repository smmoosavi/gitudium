import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffPatch } from "../src/client/DiffPatch";
import { buildDiffModel, type DiffEngine } from "../src/client/diffModel";
import { createWordHighlighter, patchHighlights } from "../src/client/wordDiff";
import { diffStorageKey, effectiveDiffMode, readDiffMode, splitPatch, writeDiffMode, readDiffWrap, writeDiffWrap, wrapStorageKey } from "../src/client/diff";

test("wrapping defaults off and persists safely", () => {
  let saved: string | null = null;
  const storage = { getItem: () => saved, setItem: (key: string, value: string) => { expect(key).toBe(wrapStorageKey); saved = value; } };
  expect(readDiffWrap(storage)).toBe(false);
  writeDiffWrap(storage, true); expect(readDiffWrap(storage)).toBe(true);
  writeDiffWrap(storage, false); expect(readDiffWrap(storage)).toBe(false);
  expect(readDiffWrap({ getItem: () => "invalid" })).toBe(false);
  expect(readDiffWrap({ getItem: () => { throw Error(); } })).toBe(false);
  expect(() => writeDiffWrap({ setItem: () => { throw Error(); } }, true)).not.toThrow();
});

test("wrapped split rows share grid tracks to retain alignment", () => {
  const patch = "@@ -1 +1 @@\n-old\n+long new line\n";
  for (const mode of ["unified", "split"] as const) {
    const html = renderToStaticMarkup(createElement(DiffPatch, { patch, mode, wrap: true }));
    expect(html).toContain("wrap-lines");
    if (mode === "split") {
      expect(html).toContain("grid-template-rows:auto repeat(2, auto)");
      expect(html.match(/grid-row:1 \/ span 3/g)?.length).toBe(2);
    }
    expect(renderToStaticMarkup(createElement(DiffPatch, { patch, mode }))).not.toContain("wrap-lines");
  }
});

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
  expect(split.replace(/<[^>]+>/g, "")).toContain("&lt;script&gt;");
  expect(split).not.toContain("<script>");
  const unified = renderToStaticMarkup(createElement(DiffPatch, { patch, mode: effectiveDiffMode("split", "added") }));
  expect(unified).toContain('class="patch"');
  expect(unified).not.toContain("split-side");
});

test("word highlights preserve exact text and identify replacements, insertions and deletions", () => {
  for (const [before, after, removed, added] of [
    ["const value = old;", "const value = fresh;", "old", "fresh"],
    ["call(a)", "call(a, b)", "", ", b"],
    ["call(a, b)", "call(a)", ", b", ""],
    ["你好 café 👋", "你好 coffee 🌍", "café👋", "coffee🌍"],
    ["\tvalue  ", "  value ", "\t  ", "   "],
    ["value = ;", "value = added;", "", "added"],
  ]) {
    const result = createWordHighlighter()(before!, after!)!;
    expect(result.before.map(segment => segment.text).join("")).toBe(before!);
    expect(result.after.map(segment => segment.text).join("")).toBe(after!);
    expect(result.before.filter(segment => segment.changed).map(segment => segment.text).join("")).toBe(removed!);
    expect(result.after.filter(segment => segment.changed).map(segment => segment.text).join("")).toBe(added!);
  }
});

test("patch highlights pair only replacements and skip metadata, unmatched rows and markers", () => {
  const patch = "--- a/old\n+++ b/new\n@@ -1,3 +1,2 @@\n-const old = 1;\n\\ No newline at end of file\n-extra\n+const fresh = 1;\n\\ No newline at end of file\n context\n@@ -9 +8 @@\n-old\n+new\n";
  const highlights = patchHighlights(patch);
  expect([...highlights.keys()]).toEqual([3, 6]);
  const rows = splitPatch(patch, highlights);
  expect(rows[3]).toMatchObject({ left: { noNewline: true }, right: { noNewline: true } });
  expect(patchHighlights("@@ -0,0 +1 @@\n+added\n").size).toBe(0);
  expect(patchHighlights("@@ -1 +0,0 @@\n-deleted\n").size).toBe(0);
});

test("word matching falls back for long lines, expensive pairs and oversized blocks", () => {
  const highlight = createWordHighlighter();
  expect(highlight("same", "same")).toBeUndefined();
  expect(highlight("a".repeat(4097), "b")).toBeUndefined();
  expect(highlight("a ".repeat(200), "b ".repeat(200))).toBeUndefined();
  const patch = "@@ -1,101 +1,101 @@\n" + "-old\n".repeat(101) + "+new\n".repeat(101);
  expect(patchHighlights(patch).size).toBe(0);
  const budgeted = createWordHighlighter();
  let matches = 0;
  for (let i = 0; i < 100; i++) if (budgeted("a ".repeat(100), "a ".repeat(99) + "b ")) matches++;
  expect(matches).toBeGreaterThan(0);
  expect(matches).toBeLessThan(100);
});

test("both modes render inline changes safely without highlighting context or losing markers", () => {
  const patch = "@@ -1,2 +1,2 @@\n context\n-const value = old;\n\\ No newline at end of file\n+const value = <script>;\n\\ No newline at end of file\n";
  for (const mode of ["unified", "split"] as const) {
    for (const wrap of [false, true]) {
      const html = renderToStaticMarkup(createElement(DiffPatch, { patch, mode, wrap }));
      expect(html).toContain('<mark class="word-change">old</mark>');
      expect(html).toContain('<mark class="word-change">&lt;script&gt;</mark>');
      expect(html).toContain("const value = ");
      expect(html).toContain("No newline at end of file");
      expect(html).not.toContain("<script>");
      expect(html).not.toContain('<mark class="word-change">context');
    }
  }
});

test("unrelated replacement lines fall back while related edits keep inline highlights", () => {
  const before = 'const SUMMARY = "%H%x00%h%x00%P%x00%s%x00%an%x00%ae%x00%aI";';
  const after = 'import { SUMMARY_FORMAT, DETAILS_FORMAT, parseReferences, referenceNames, parseSummaries, parseDetails, parseChangedFiles } from "./parsers";';
  for (const [left, right] of [[before, after], ['old " ;', 'new " ;'], ['x short', 'x completely unrelated identifiers'], ['', 'added'], [';', ',']]) {
    expect(createWordHighlighter()(left!, right!)).toBeUndefined();
    const patch = `@@ -1 +1 @@\n-${left}\n+${right}\n`;
    expect(patchHighlights(patch).size).toBe(0);
    for (const mode of ["unified", "split"] as const) {
      const html = renderToStaticMarkup(createElement(DiffPatch, { patch, mode }));
      expect(html).not.toContain('class="word-change"');
      expect(html).toContain("addition");
      expect(html).toContain("deletion");
    }
  }
  const related = createWordHighlighter()("  ChangedFile, CommitDetails, CommitSummary,", "  ChangedFile, CommitDetails, DiffResult,");
  expect(related?.before.filter(segment => segment.changed).map(segment => segment.text).join("")).toBe("CommitSummary");
  expect(related?.after.filter(segment => segment.changed).map(segment => segment.text).join("")).toBe("DiffResult");
});

test("renderer consumes a replaceable diff engine without parsing the patch", () => {
  const engine: DiffEngine = patch => {
    expect(patch).toBe("opaque input");
    return {
      unified: [{ text: "shared new", prefix: "+", kind: "addition", segments: [{ text: "shared ", changed: false }, { text: "new", changed: true }] }],
      split: [{ left: { text: "shared old", number: 7, kind: "deletion", noNewline: true }, right: { text: "shared new", number: 9, kind: "addition", segments: [{ text: "shared ", changed: false }, { text: "new", changed: true }] } }],
    };
  };
  expect(buildDiffModel("opaque input", engine).split).toHaveLength(1);
  for (const mode of ["unified", "split"] as const) {
    const html = renderToStaticMarkup(createElement(DiffPatch, { patch: "opaque input", mode, engine }));
    expect(html).toContain('<mark class="word-change">new</mark>');
    expect(html).not.toContain("opaque input");
    if (mode === "split") {
      expect(html).toContain("shared old");
      expect(html).toContain("No newline at end of file");
      expect(html).toContain('aria-hidden="true">7');
    }
  }
});

test("default diff model preserves unified patch text and split parser behavior", () => {
  const patch = "--- a/file\n+++ b/file\n@@ -1,2 +1,2 @@\n context\n-const old = 1;\n+const fresh = 1;\n\\ No newline at end of file\n";
  const model = buildDiffModel(patch);
  expect(model.unified.map(line => (line.prefix ?? "") + line.text).join("\n")).toBe(patch);
  for (const line of model.unified) {
    if (line.segments) expect(line.segments.map(segment => segment.text).join("")).toBe(line.text);
  }
  expect(model.split).toEqual(splitPatch(patch, patchHighlights(patch)));
});
