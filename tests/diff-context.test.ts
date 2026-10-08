import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDiffModel } from "../src/client/diffModel";
import { canShowFullFile, expandDiffContext } from "../src/client/diffContext";
import { DiffPatch } from "../src/client/DiffPatch";

const before = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
const after = [...before];
after[10] = "changed 11";
after[40] = "changed 41";
const sources = { before: { text: before.join("\n") + "\n" }, after: { text: after.join("\n") + "\n" } };
const patch = "@@ -11 +11 @@\n-line 11\n+changed 11\n@@ -41 +41 @@\n-line 41\n+changed 41\n";

test("context exposes leading, middle and trailing gaps and merges overlapping expansions", () => {
  const base = buildDiffModel(patch);
  const initial = expandDiffContext(base, sources, {});
  expect(initial.split.filter(row => "gap" in row).map(row => "gap" in row && row.gap.count)).toEqual([10, 29, 19]);
  const expanded = expandDiffContext(base, sources, { "12:12:29": { above: 20, below: 20 } });
  const context = expanded.split.filter(row => "left" in row && row.left?.kind === "context");
  expect(context).toHaveLength(29);
  expect(new Set(context.map(row => "left" in row && row.left?.number)).size).toBe(29);
  expect(expanded.split.filter(row => "gap" in row)).toHaveLength(2);
});

test("full-file context preserves source numbering and unified deletion-before-addition ordering", () => {
  const result = expandDiffContext(buildDiffModel(patch), sources, {}, true);
  expect(result.split.filter(row => "gap" in row)).toHaveLength(0);
  expect(result.split.filter(row => "left" in row)).toHaveLength(60);
  expect(result.unified.filter(line => line.prefix === " ")).toHaveLength(58);
  expect(result.unified.find(line => line.text === "line 60")).toMatchObject({ prefix: " " });
  const replacement = "@@ -1,2 +1,2 @@\n-old a\n-old b\n+new a\n+new b\n";
  const model = expandDiffContext(buildDiffModel(replacement), { before: { text: "old a\nold b\n" }, after: { text: "new a\nnew b\n" } }, {}, true);
  expect(model.unified.filter(line => line.prefix).map(line => line.prefix)).toEqual(["-", "-", "+", "+"]);
});

test("zero-length insertion and deletion hunks expand at correct boundaries", () => {
  const inserted = expandDiffContext(buildDiffModel("@@ -2,0 +3 @@\n+insert\n"), { before: { text: "a\nb\nc\n" }, after: { text: "a\nb\ninsert\nc\n" } }, {}, true);
  expect(inserted.split.at(-1)).toEqual({ left: { text: "c", number: 3, kind: "context" }, right: { text: "c", number: 4, kind: "context" } });
  const deleted = expandDiffContext(buildDiffModel("@@ -3 +2,0 @@\n-insert\n"), { before: { text: "a\nb\ninsert\nc\n" }, after: { text: "a\nb\nc\n" } }, {}, true);
  expect(deleted.split.at(-1)).toEqual({ left: { text: "c", number: 4, kind: "context" }, right: { text: "c", number: 3, kind: "context" } });
});

test("added/deleted files, missing newlines and mismatched source fail safely", () => {
  const added = buildDiffModel("@@ -0,0 +1 @@\n+one\n\\ No newline at end of file\n");
  expect(expandDiffContext(added, { before: null, after: { text: "one" } }, {}, true).unified.at(-1)?.text).toBe("\\ No newline at end of file");
  const deleted = buildDiffModel("@@ -1 +0,0 @@\n-one\n");
  expect(expandDiffContext(deleted, { before: { text: "one\n" }, after: null }, {}, true).split).toEqual(deleted.split);
  const base = buildDiffModel(patch);
  expect(expandDiffContext(base, { before: { text: "wrong" }, after: { text: "wrong" } }, {}, true)).toBe(base);
  expect(canShowFullFile({ before: null, after: { text: "x\n".repeat(20_001) } })).toBe(false);
});

test("metadata-only changes expose complete source and preserve final newline markers", () => {
  const source = { before: { text: "<script>\nlast" }, after: { text: "<script>\nlast" } };
  const base = buildDiffModel("diff --git a/old b/new\nsimilarity index 100%\nrename from old\nrename to new\n");
  expect(expandDiffContext(base, source, {}).split.at(-1)).toMatchObject({ gap: { count: 2 } });
  const full = expandDiffContext(base, source, {}, true);
  expect(full.split.at(-1)).toMatchObject({ left: { number: 2, noNewline: true }, right: { number: 2, noNewline: true } });
  expect(full.unified.at(-1)?.text).toBe("\\ No newline at end of file");
  const html = renderToStaticMarkup(createElement(DiffPatch, { patch: "", mode: "unified", sources: source, full: true }));
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
});

test("context expansion enforces a cumulative rendering budget", () => {
  const text = "x\n".repeat(20_010);
  const result = expandDiffContext(buildDiffModel(""), { before: { text }, after: { text } }, { "1:1:20010": { above: 15_000, below: 15_000 } });
  expect(result.split.filter(row => "left" in row)).toHaveLength(20_000);
  expect(result.split.filter(row => "gap" in row)).toEqual([{ gap: { id: "1:1:20010", count: 10 } }]);
});

test("small gaps have one icon control and large gaps have two accessible controls", () => {
  for (const mode of ["unified", "split"] as const) {
    const html = renderToStaticMarkup(createElement(DiffPatch, { patch, mode, sources }));
    expect(html.match(/aria-label="Show all hidden lines"/g)).toHaveLength(2);
    expect(html.match(/aria-label="Show more below"/g)).toHaveLength(1);
    expect(html.match(/aria-label="Show more above"/g)).toHaveLength(1);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("context-gap-row");
  }
});

test("both render modes expose context controls and safely render full source", () => {
  for (const mode of ["unified", "split"] as const) {
    const collapsed = renderToStaticMarkup(createElement(DiffPatch, { patch, mode, sources }));
    expect(collapsed).toContain("Show more above");
    expect(collapsed).toContain("Show more below");
    expect(collapsed).toContain("29 hidden lines");
    const full = renderToStaticMarkup(createElement(DiffPatch, { patch, mode, sources, full: true, wrap: true }));
    expect(full).toContain("line 60");
    expect(full).not.toContain("hidden lines");
  }
});
