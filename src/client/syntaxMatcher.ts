import type { DiffSegment } from "./diffModel";
import type { LinePair } from "./lineAlignment";
import type { InlineChange } from "./wordDiff";

export type MatchToken = { text: string; type: string };
export type MatchLines = MatchToken[][];
export type MatchResult = { before: MatchLines | null; after: MatchLines | null };

function append(segments: DiffSegment[], text: string, changed: boolean) {
  if (!text) return;
  const last = segments.at(-1);
  if (last?.changed === changed) last.text += text;
  else segments.push({ text, changed });
}

function common(left: MatchToken[], right: MatchToken[], exact: boolean): number {
  const width = right.length + 1;
  const scores = new Float64Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      const a = left[i]!;
      const b = right[j]!;
      const matches = a.type === b.type && (!exact || a.text === b.text);
      scores[i * width + j] = matches
        ? 1 + scores[(i + 1) * width + j + 1]!
        : Math.max(scores[(i + 1) * width + j]!, scores[i * width + j + 1]!);
    }
  }
  return scores[0]!;
}

export function createSyntaxMatcher() {
  let remainingCells = 1_000_000;
  let remainingCandidates = 4096;
  const meaningful = (line: MatchToken[]) => line.filter(token => token.type !== "");
  return {
    align(before: string[], after: string[], left: MatchLines, right: MatchLines, fallback: () => LinePair[]): LinePair[] {
      const candidates = before.length * after.length;
      if (Math.max(before.length, after.length) > 100 || candidates > remainingCandidates || [...before, ...after].some(line => line.length > 4096)) return fallback();
      remainingCandidates -= candidates;
      const a = left.map(meaningful);
      const b = right.map(meaningful);
      const required = a.reduce((sum, line) => sum + b.reduce((n, other) => n + 2 * (line.length + 1) * (other.length + 1), 0), 0);
      if (required > remainingCells || [...a, ...b].some(line => line.length > 512)) return fallback();
      remainingCells -= required;
      const width = after.length + 1;
      const scores = new Float64Array((before.length + 1) * width);
      const similarities = new Float64Array(candidates);
      for (let i = before.length - 1; i >= 0; i--) {
        for (let j = after.length - 1; j >= 0; j--) {
          const size = Math.max(a[i]!.length, b[j]!.length, 1);
          const similarity = before[i]!.trim() === after[j]!.trim() ? 1
            : (0.6 * common(a[i]!, b[j]!, false) + 0.4 * common(a[i]!, b[j]!, true)) / size;
          if (similarity >= 0.6) similarities[i * after.length + j] = similarity;
          scores[i * width + j] = Math.max(scores[(i + 1) * width + j]!, scores[i * width + j + 1]!, similarity >= 0.6 ? similarity + scores[(i + 1) * width + j + 1]! : 0);
        }
      }
      const pairs: LinePair[] = [];
      let i = 0;
      let j = 0;
      while (i < before.length || j < after.length) {
        const similarity = i < before.length && j < after.length ? similarities[i * after.length + j]! : 0;
        if (similarity && scores[i * width + j] === similarity + scores[(i + 1) * width + j + 1]!) pairs.push({ before: i++, after: j++ });
        else if (i < before.length && (j === after.length || scores[(i + 1) * width + j]! >= scores[i * width + j + 1]!)) pairs.push({ before: i++ });
        else pairs.push({ after: j++ });
      }
      return pairs;
    },
    highlight(left: MatchToken[], right: MatchToken[]): InlineChange | undefined {
      const cells = (left.length + 1) * (right.length + 1);
      if (left.length > 512 || right.length > 512 || cells > 65_536 || cells > remainingCells || [left, right].some(line => line.reduce((sum, token) => sum + token.text.length, 0) > 4096)) return;
      remainingCells -= cells;
      const width = right.length + 1;
      const scores = new Float64Array(cells);
      const equal = (i: number, j: number) => left[i]!.type === right[j]!.type && left[i]!.text === right[j]!.text;
      for (let i = left.length - 1; i >= 0; i--) {
        for (let j = right.length - 1; j >= 0; j--) {
          scores[i * width + j] = equal(i, j)
            ? left[i]!.text.length + scores[(i + 1) * width + j + 1]!
            : Math.max(scores[(i + 1) * width + j]!, scores[i * width + j + 1]!);
        }
      }
      const result: InlineChange = { before: [], after: [] };
      let i = 0;
      let j = 0;
      while (i < left.length || j < right.length) {
        if (i < left.length && j < right.length && equal(i, j)) {
          append(result.before, left[i++]!.text, false);
          append(result.after, right[j++]!.text, false);
        } else if (i < left.length && (j === right.length || scores[(i + 1) * width + j]! >= scores[i * width + j + 1]!)) append(result.before, left[i++]!.text, true);
        else append(result.after, right[j++]!.text, true);
      }
      return result;
    },
  };
}
