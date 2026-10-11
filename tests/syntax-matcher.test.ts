import { expect, test } from "bun:test";
import { createDiffEngine } from "../src/client/diffEngine";
import { createSyntaxMatcher, type MatchToken } from "../src/client/syntaxMatcher";

const token = (text: string, type = "identifier"): MatchToken => ({ text, type });

test("syntax roles align renamed lines around inserted unrelated syntax", () => {
  const matcher = createSyntaxMatcher();
  const pairs = matcher.align(["old"], ["true", "new"], [[token("old")]], [[token("true", "true")], [token("new")]], () => []);
  expect(pairs).toEqual([{ after: 0 }, { before: 0, after: 1 }]);
});

test("inline matching does not preserve equal text in different syntax roles", () => {
  const result = createSyntaxMatcher().highlight([token("value", "property")], [token("value", "identifier")]);
  expect(result).toEqual({ before: [{ text: "value", changed: true }], after: [{ text: "value", changed: true }] });
});

test("syntax engine preserves source text, coordinates, markers and shared highlights", () => {
  const patch = "@@ -4,1 +8,2 @@\n-old\n\\ No newline at end of file\n+true\n+new\n\\ No newline at end of file";
  const model = createDiffEngine(true, {
    before: [[], [], [], [token("old")]],
    after: [[], [], [], [], [], [], [], [token("true", "true")], [token("new")]],
  })(patch);
  expect(model.split[1]).toMatchObject({ right: { text: "true", number: 8 } });
  expect(model.split[2]).toMatchObject({ left: { text: "old", number: 4, noNewline: true }, right: { text: "new", number: 9, noNewline: true } });
  const row = model.split[2]!;
  if (!("header" in row) && !("gap" in row)) expect(row.left?.segments).toBe(model.unified[1]?.segments);
  for (const line of model.unified) if (line.segments) expect(line.segments.map(segment => segment.text).join("")).toBe(line.text);
});

test("wrapping an expression retains identical leaves despite a different parent", () => {
  const result = createSyntaxMatcher().highlight(
    [token("item", "return_statement/identifier")],
    [token("box", "call_expression/identifier"), token("(", "arguments/("), token("item", "arguments/identifier"), token(")", "arguments/)")],
  )!;
  expect(result.before).toEqual([{ text: "item", changed: false }]);
  expect(result.after).toEqual([{ text: "box(", changed: true }, { text: "item", changed: false }, { text: ")", changed: true }]);
});

test("block matching retains tokens across line splits and isolates trailing commas", () => {
  const left = [[token("[", "array/["), token("oak", "array/identifier"), token(",", "array/,"), token(" ", ""), token("elm", "array/identifier"), token("]", "array/]")]];
  const right = [[token("[", "array/[")], [token("  ", ""), token("oak", "array/identifier"), token(",", "array/,")], [token("  ", ""), token("elm", "array/identifier"), token(",", "array/,")], [token("]", "array/]")]];
  const result = createSyntaxMatcher().highlightBlock(left, right)!;
  expect(result.before.flat().filter(segment => segment.changed).map(segment => segment.text).join("")).toBe(" ");
  expect(result.after[2]).toEqual([{ text: "  ", changed: true }, { text: "elm", changed: false }, { text: ",", changed: true }]);
  for (const [lines, segments] of [[left, result.before], [right, result.after]] as const) {
    expect(segments.map(line => line.map(segment => segment.text).join(""))).toEqual(lines.map(line => line.map(token => token.text).join("")));
  }
});

test("engine shares block-wide highlights across split and unified views", () => {
  const result = createDiffEngine(true, {
    before: [[token("oak", "arguments/identifier"), token(",", "arguments/,"), token("elm", "arguments/identifier")]],
    after: [[token("oak", "arguments/identifier"), token(",", "arguments/,")], [token("elm", "arguments/identifier"), token(",", "arguments/,")]],
  })("@@ -1 +1,2 @@\n-oak,elm\n+oak,\n+elm,");
  const added = result.unified.filter(line => line.prefix === "+");
  expect(added[1]?.segments).toEqual([{ text: "elm", changed: false }, { text: ",", changed: true }]);
  for (const row of result.split) {
    if ("header" in row || "gap" in row || !row.right) continue;
    expect(row.right.segments).toBe(added.find(line => line.newNumber === row.right!.number)?.segments);
  }
});

test("block matching remains bounded and safely handles empty lines", () => {
  expect(createSyntaxMatcher().highlightBlock([[]], [[]])).toEqual({ before: [[]], after: [[]] });
  expect(createSyntaxMatcher().highlightBlock(Array.from({ length: 513 }, () => [token("x")]), [[token("x")]])).toBeUndefined();
  expect(createSyntaxMatcher().highlightBlock([[token("a".repeat(4097))]], [[token("a")]])).toBeUndefined();
});

test("inline matching prioritizes syntax over long indentation", () => {
  const left = [token(" ".repeat(40), ""), token("shared", "call/identifier"), token(" ", ""), token("gone", "call/identifier")];
  const right = [token("shared", "call/identifier"), token(" ".repeat(40), ""), token("added", "call/identifier")];
  const result = createSyntaxMatcher().highlight(left, right)!;
  expect(result.before.some(segment => !segment.changed && segment.text.includes("shared"))).toBe(true);
  expect(result.after.some(segment => !segment.changed && segment.text.includes("shared"))).toBe(true);
  expect(result.before.map(segment => segment.text).join("")).toBe(left.map(token => token.text).join(""));
  expect(result.after.map(segment => segment.text).join("")).toBe(right.map(token => token.text).join(""));
});

test("mismatched token text and budget overflow safely use legacy fallback", () => {
  const patch = "@@ -1 +1 @@\n-old\n+new";
  expect(createDiffEngine(true, { before: [[token("wrong")]], after: [[token("wrong")]] })(patch)).toEqual(createDiffEngine(true)(patch));
  let called = false;
  expect(createSyntaxMatcher().align(["x".repeat(4097)], ["x"], [[]], [[]], () => { called = true; return [{ before: 0, after: 0 }]; })).toEqual([{ before: 0, after: 0 }]);
  expect(called).toBe(true);
  expect(createSyntaxMatcher().highlight(Array.from({ length: 513 }, () => token("x")), [token("x")])).toBeUndefined();
});
