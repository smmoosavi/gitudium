import { splitPatch } from "./diff";
import type { DiffEngine } from "./diffModel";
import { patchHighlights } from "./wordDiff";

export const defaultDiffEngine: DiffEngine = patch => {
  const highlights = patchHighlights(patch);
  return {
    unified: patch.split("\n").map((line, index) => {
      const segments = highlights.get(index);
      return {
        text: segments ? line.slice(1) : line,
        prefix: segments ? line[0] : undefined,
        kind: line.startsWith("+") ? "addition" : line.startsWith("-") ? "deletion" : line.startsWith("@@") ? "hunk" : undefined,
        segments,
      };
    }),
    split: splitPatch(patch, highlights),
  };
};
