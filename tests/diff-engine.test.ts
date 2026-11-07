import { expect, test } from "bun:test";
import { createDiffEngine } from "../src/client/diffEngine";
import { createSyntaxDiffEngine } from "../src/client/syntaxDiffEngine";
import { createLineAligner } from "../src/client/lineAlignment";
import type { MatchResult } from "../src/client/syntaxMatcher";
import { createTextChangePolicy, patchChangeBlocks } from "../src/client/wordDiff";
import { diffCases } from "./fixtures/diff-cases";
import hashes from "./fixtures/diff-output-hashes.json";

for (const [name, patch] of Object.entries(diffCases)) {
  test(`diff engine preserves legacy serialized output: ${name}`, () => {
    for (const [index, paired] of [false, true].entries()) {
      const output = JSON.stringify(createDiffEngine(paired)(patch));
      expect(new Bun.CryptoHasher("sha256").update(output).digest("hex")).toBe(hashes[name as keyof typeof hashes][index]!);
    }
  });
}

test("change blocks align once and share segment references across both representations", () => {
  const align = createLineAligner();
  let calls = 0;
  const blocks = patchChangeBlocks(diffCases.markers!, createTextChangePolicy((before, after) => {
    calls++;
    return align(before, after);
  }));
  expect(calls).toBe(1);
  expect(blocks[0]?.pairs).toEqual([{ after: 0 }, { before: 0, after: 1 }, { before: 1, after: 2 }, { before: 2, after: 3 }]);
  const model = createDiffEngine(true)(diffCases.markers!);
  for (const row of model.split) {
    if ("header" in row || "gap" in row) continue;
    for (const [side, prefix] of [[row.left, "-"], [row.right, "+"]] as const) {
      if (!side?.segments) continue;
      const unified = model.unified.find(line => line.prefix === prefix && (prefix === "-" ? line.oldNumber : line.newNumber) === side.number);
      expect(side.segments).toBe(unified!.segments!);
    }
  }
});

test("syntax matching repairs context braces belonging to different JSON objects", () => {
  const token = (text: string, scope: string) => [{ text, type: "object/}", scope }];
  const syntax: MatchResult = {
    before: [token("},", '["peer"]'), token('"removed": {', '["removed"]'), token("}", '["removed"]'), token("}", "[]")],
    after: [token("}", '["peer"]'), token("}", "[]")],
  };
  const patch = '@@ -1,4 +1,2 @@\n-},\n-"removed": {\n }\n }';
  const model = createSyntaxDiffEngine(syntax)(patch);
  expect(model.unified.filter(line => line.prefix === " ")).toEqual([
    expect.objectContaining({ oldNumber: 4, newNumber: 2, text: "}" }),
  ]);
  expect(model.unified.filter(line => line.prefix === "-").map(line => line.oldNumber)).toEqual([1, 2, 3]);
  expect(model.unified.find(line => line.prefix === "+")).toMatchObject({ newNumber: 1, text: "}" });
  expect(model.unified.find(line => line.oldNumber === 3)?.segments).toEqual([{ text: "}", changed: true }]);
  expect(createSyntaxDiffEngine(syntax)(patch + "\n\\ No newline at end of file").unified.filter(line => line.prefix === " ")).toHaveLength(2);
  const stale = { ...syntax, before: [syntax.before![0]!, syntax.before![1]!, token("different", '["removed"]'), syntax.before![3]!] };
  expect(createSyntaxDiffEngine(stale)(patch).unified.filter(line => line.prefix === " ")).toHaveLength(2);
});

test("cumulative candidate, similarity and inline budgets retain independent exhaustion", () => {
  const candidates = createDiffEngine(true)(diffCases.candidateBudget!);
  expect(candidates.split.at(-1)).toMatchObject({ left: { text: "apple();" }, right: { text: "orange();" } });
  const similarity = patchChangeBlocks(diffCases.similarityBudget!, createTextChangePolicy(createLineAligner()));
  expect(similarity.slice(0, 24).every(block => block.pairs.length === 1)).toBe(true);
  expect(similarity.slice(24).every(block => block.pairs.length === 2)).toBe(true);
  const inline = patchChangeBlocks(diffCases.inlineBudget!, createTextChangePolicy(createLineAligner()));
  expect(inline[0]?.highlights.size).toBe(48);
  expect(inline[1]?.highlights.size).toBe(2);
  // Candidate overflow does not consume the alignment budget; inline exhaustion does not consume similarity cells.
  expect(inline[1]?.pairs).toEqual([{ before: 0, after: 0 }]);
});

test("block policy can withhold inline highlights without an implicit textual fallback", () => {
  const calls: unknown[] = [];
  const blocks = patchChangeBlocks("@@ -1 +1 @@\n-old value\n+new value", {
    align: (removed, added, before, after) => {
      calls.push({ removed, added, before, after });
      return [{ before: 0, after: 0 }];
    },
    highlight: () => undefined,
  });
  expect(calls).toEqual([{ removed: [1], added: [2], before: ["old value"], after: ["new value"] }]);
  expect(blocks[0]!.pairs).toEqual([{ before: 0, after: 0 }]);
  expect(blocks[0]!.highlights.size).toBe(0);
});

test("syntax without source tokens preserves legacy output and resets fallback budgets", () => {
  const engine = createSyntaxDiffEngine({ before: null, after: null });
  for (const [name, patch] of Object.entries(diffCases)) {
    // Syntax scope repair has always grouped alternating deletions/additions, even without tokens.
    const first = engine(patch);
    const output = JSON.stringify(first);
    expect(new Bun.CryptoHasher("sha256").update(output).digest("hex")).toBe(hashes[name as keyof typeof hashes][2]!);
    expect(engine(patch)).toEqual(first);
  }
});
