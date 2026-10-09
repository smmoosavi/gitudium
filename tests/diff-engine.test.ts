import { expect, test } from "bun:test";
import { createDiffEngine } from "../src/client/diffEngine";
import { createLineAligner } from "../src/client/lineAlignment";
import { patchChangeBlocks } from "../src/client/wordDiff";
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
  const blocks = patchChangeBlocks(diffCases.markers!, (before, after) => {
    calls++;
    return align(before, after);
  });
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

test("cumulative candidate, similarity and inline budgets retain independent exhaustion", () => {
  const candidates = createDiffEngine(true)(diffCases.candidateBudget!);
  expect(candidates.split.at(-1)).toMatchObject({ left: { text: "apple();" }, right: { text: "orange();" } });
  const similarity = patchChangeBlocks(diffCases.similarityBudget!, createLineAligner());
  expect(similarity.slice(0, 24).every(block => block.pairs.length === 1)).toBe(true);
  expect(similarity.slice(24).every(block => block.pairs.length === 2)).toBe(true);
  const inline = patchChangeBlocks(diffCases.inlineBudget!, createLineAligner());
  expect(inline[0]?.highlights.size).toBe(48);
  expect(inline[1]?.highlights.size).toBe(2);
  // Candidate overflow does not consume the alignment budget; inline exhaustion does not consume similarity cells.
  expect(inline[1]?.pairs).toEqual([{ before: 0, after: 0 }]);
});
