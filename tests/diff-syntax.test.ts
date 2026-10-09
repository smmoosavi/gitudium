import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDiffModel } from "../src/client/diffModel";
import { expandDiffContext } from "../src/client/diffContext";
import { applyDiffSyntax, syntaxSegments } from "../src/client/diffSyntax";
import { DiffPatch } from "../src/client/DiffPatch";

const patch = "@@ -3 +3 @@\n-old value\n+new value\n";
const syntax = { before: [[], [], [{ text: "old ", color: "#ff0000" }, { text: "value", color: "#ffffff" }]], after: [[], [], [{ text: "new ", color: "#00ff00" }, { text: "value", color: "#ffffff" }]] };

test("syntax colors merge with word changes without altering text", () => {
  const words = [{ text: "new", changed: true }, { text: " value", changed: false }];
  const result = syntaxSegments("new value", syntax.after[2], words)!;
  expect(result.map(segment => segment.text).join("")).toBe("new value");
  expect(result[0]).toMatchObject({ text: "new", changed: true, color: "#00ff00" });
  expect(result[1]).toMatchObject({ text: " ", changed: false, color: "#00ff00" });
  expect(syntaxSegments("different", syntax.after[2], words)).toBe(words);
  expect(syntaxSegments("x", [{ text: "x", color: "url(evil)" }])?.[0]?.color).toBeUndefined();
});

test("unified and split lines map complete source tokens by their own coordinates", () => {
  const model = applyDiffSyntax(buildDiffModel(patch), syntax);
  expect(model.unified.find(line => line.oldNumber === 3)?.segments?.[0]?.color).toBe("#ff0000");
  expect(model.unified.find(line => line.newNumber === 3)?.segments?.[0]?.color).toBe("#00ff00");
  const row = model.split.find(row => "left" in row);
  expect(row && "left" in row && row.left?.segments?.[0]?.color).toBe("#ff0000");
  expect(applyDiffSyntax(model, undefined)).toBe(model);
});

test("expanded context retains distinct old/new coordinates after insertions", () => {
  const base = buildDiffModel("@@ -1,0 +2 @@\n+new\n");
  const expanded = expandDiffContext(base, { before: { text: "a\nb\n" }, after: { text: "a\nnew\nb\n" } }, {}, true);
  expect(expanded.unified.find(line => line.text === "b")).toMatchObject({ oldNumber: 2, newNumber: 3 });
});

test("excessive rendered token volume falls back to the existing model", () => {
  const text = "x".repeat(25_001);
  const base = buildDiffModel(`@@ -1 +1 @@\n-${text}\n+${text}\n`);
  const tokens = Array.from(text, text => ({ text, color: "#ffffff" }));
  expect(applyDiffSyntax(base, { before: [tokens], after: [tokens] })).toBe(base);
});

test("both modes safely render inline syntax alongside word marks", () => {
  for (const mode of ["unified", "split"] as const) {
    const html = renderToStaticMarkup(createElement(DiffPatch, { patch, mode, syntax, wrap: true }));
    expect(html).toContain("color:#00ff00");
    expect(html).toContain('class="word-change"');
    expect(html).toContain('class="syntax-token"');
  }
});
