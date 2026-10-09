import { splitPatch } from "./diff";
import type { DiffEngine } from "./diffModel";
import { patchHighlights } from "./wordDiff";

export function diffModeChange(patch: string): string | undefined {
  const metadata = patch.split(/^@@/m, 1)[0] ?? "";
  const oldMode = /^old mode (\d+)$/m.exec(metadata)?.[1];
  const newMode = /^new mode (\d+)$/m.exec(metadata)?.[1];
  return oldMode && newMode ? `Mode ${oldMode} → ${newMode}` : undefined;
}

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
        metadata: !hunk && oldNumber === undefined,
        noNewline: line === "\\ No newline at end of file" || undefined,
        text: location.oldNumber !== undefined || location.newNumber !== undefined ? line.slice(1) : line,
        prefix: location.oldNumber !== undefined || location.newNumber !== undefined ? line[0] : undefined,
        kind: line.startsWith("+") ? "addition" : line.startsWith("-") ? "deletion" : line.startsWith("@@") ? "hunk" : undefined,
        segments,
      };
    }),
    split: splitPatch(patch, highlights).map(row => "header" in row && !row.header.startsWith("@@") ? { ...row, metadata: true } : row),
  };
};
