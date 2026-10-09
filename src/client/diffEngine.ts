import { splitPatch } from "./diff";
import type { DiffEngine } from "./diffModel";
import { patchHighlights } from "./wordDiff";

export const defaultDiffEngine: DiffEngine = patch => {
  const highlights = patchHighlights(patch);
  let oldNumber: number | undefined;
  let newNumber: number | undefined;
  return {
    unified: patch.split("\n").map((line, index) => {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (hunk) { oldNumber = Number(hunk[1]); newNumber = Number(hunk[2]); }
      const location: { oldNumber?: number; newNumber?: number } = {};
      if (!hunk && oldNumber !== undefined && newNumber !== undefined) {
        if (line.startsWith(" ")) { location.oldNumber = oldNumber++; location.newNumber = newNumber++; }
        else if (line.startsWith("-")) location.oldNumber = oldNumber++;
        else if (line.startsWith("+")) location.newNumber = newNumber++;
      }
      const segments = highlights.get(index);
      return {
        ...location,
        text: segments ? line.slice(1) : line,
        prefix: segments ? line[0] : undefined,
        kind: line.startsWith("+") ? "addition" : line.startsWith("-") ? "deletion" : line.startsWith("@@") ? "hunk" : undefined,
        segments,
      };
    }),
    split: splitPatch(patch, highlights),
  };
};
