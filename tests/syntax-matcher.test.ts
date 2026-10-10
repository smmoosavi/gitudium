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

test("mismatched token text and budget overflow safely use legacy fallback", () => {
  const patch = "@@ -1 +1 @@\n-old\n+new";
  expect(createDiffEngine(true, { before: [[token("wrong")]], after: [[token("wrong")]] })(patch)).toEqual(createDiffEngine(true)(patch));
  let called = false;
  expect(createSyntaxMatcher().align(["x".repeat(4097)], ["x"], [[]], [[]], () => { called = true; return [{ before: 0, after: 0 }]; })).toEqual([{ before: 0, after: 0 }]);
  expect(called).toBe(true);
  expect(createSyntaxMatcher().highlight(Array.from({ length: 513 }, () => token("x")), [token("x")])).toBeUndefined();
});
