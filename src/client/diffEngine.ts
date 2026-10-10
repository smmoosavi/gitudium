import { splitChangeBlocks } from "./diff";
import type { DiffEngine } from "./diffModel";
import { patchChangeBlocks } from "./wordDiff";
import { createLineAligner } from "./lineAlignment";
import { createSyntaxMatcher, type MatchResult, type MatchToken } from "./syntaxMatcher";

export function diffModeChange(patch: string): string | undefined {
  const metadata = patch.split(/^@@/m, 1)[0] ?? "";
  const oldMode = /^old mode (\d+)$/m.exec(metadata)?.[1];
  const newMode = /^new mode (\d+)$/m.exec(metadata)?.[1];
  return oldMode && newMode ? `Mode ${oldMode} → ${newMode}` : undefined;
}

export function createDiffEngine(pairLines = false, syntax?: MatchResult): DiffEngine {
  return patch => {
    const align = createLineAligner();
    const matcher = syntax ? createSyntaxMatcher() : undefined;
    const tokens = new Map<number, MatchToken[]>();
    if (syntax) {
      let old = 0;
      let next = 0;
      let inHunk = false;
      for (const [index, line] of patch.split("\n").entries()) {
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (hunk) { old = Number(hunk[1]) - 1; next = Number(hunk[2]) - 1; inHunk = true; continue; }
        if (!inHunk) continue;
        const source = line.startsWith("-") ? syntax.before?.[old++] : line.startsWith("+") ? syntax.after?.[next++] : undefined;
        if (line.startsWith(" ")) { old++; next++; }
        else if (!line.startsWith("-") && !line.startsWith("+") && !line.startsWith("\\ No newline")) inHunk = false;
        if (source && source.map(token => token.text).join("") === line.slice(1)) tokens.set(index, source);
      }
    }
    const blocks = patchChangeBlocks(patch, pairLines ? align : undefined, matcher ? {
      align: (removed, added, before, after) => {
        const fallback = () => align(before, after);
        if (![...removed, ...added].every(index => tokens.has(index))) return fallback();
        return matcher.align(before, after, removed.map(index => tokens.get(index)!), added.map(index => tokens.get(index)!), fallback);
      },
      highlight: (oldIndex, newIndex) => {
        const before = tokens.get(oldIndex);
        const after = tokens.get(newIndex);
        return before && after ? matcher.highlight(before, after) : undefined;
      },
    } : undefined);
    const highlights = new Map(blocks.flatMap(block => [...block.highlights]));
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
      split: splitChangeBlocks(patch, blocks).map(row => "header" in row && !row.header.startsWith("@@") ? { ...row, metadata: true } : row),
    };
  };
}

export const defaultDiffEngine = createDiffEngine();
export const pairedDiffEngine = createDiffEngine(true);
