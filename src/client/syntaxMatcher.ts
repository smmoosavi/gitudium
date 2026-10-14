import type { DiffSegment } from "./diffModel";
import type { LinePair } from "./lineAlignment";
import type { InlineChange } from "./wordDiff";

export type MatchToken = { text: string; type: string; scope?: string };
export type MatchLines = MatchToken[][];
export type MatchResult = { before: MatchLines | null; after: MatchLines | null };

function append(segments: DiffSegment[], text: string, changed: boolean) {
  if (!text) return;
  const last = segments.at(-1);
  if (last?.changed === changed) last.text += text;
  else segments.push({ text, changed });
}

function leafType(token: MatchToken): string { return token.type.split("/").at(-1)!; }

function tokenWeight(token: MatchToken): number {
  if (!token.type) return 0;
  if (token.type === "json/json_key" || token.type === "json/json_value") return 2;
  return /^[\p{L}\p{N}_]/u.test(token.text) ? 2 : 0.5;
}

function matchWeight(left: MatchToken, right: MatchToken, exact: boolean): number {
  if (left.scope !== right.scope || !left.type || !right.type || (exact && left.text !== right.text)) return 0;
  if (left.type === right.type) return Math.min(tokenWeight(left), tokenWeight(right));
  // Wrapping an expression changes its parent, but not the identity of its leaves.
  return exact && left.type.includes("/") && right.type.includes("/") && leafType(left) === leafType(right)
    ? Math.min(tokenWeight(left), tokenWeight(right)) * 0.8 : 0;
}

function common(left: MatchToken[], right: MatchToken[], exact: boolean): number {
  const width = right.length + 1;
  const scores = new Float64Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      const a = left[i]!;
      const b = right[j]!;
      const weight = matchWeight(a, b, exact);
      scores[i * width + j] = Math.max(
        weight + scores[(i + 1) * width + j + 1]!,
        scores[(i + 1) * width + j]!, scores[i * width + j + 1]!,
      );
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
          const size = Math.max(a[i]!.reduce((sum, token) => sum + tokenWeight(token), 0), b[j]!.reduce((sum, token) => sum + tokenWeight(token), 0), 1);
          const sameScopes = JSON.stringify(a[i]!.map(token => token.scope)) === JSON.stringify(b[j]!.map(token => token.scope));
          const closing = (tokens: MatchToken[]) => tokens.filter(token => token.text !== ",");
          const oldClosing = closing(a[i]!);
          const newClosing = closing(b[j]!);
          const sameClosing = oldClosing.length === 1 && newClosing.length === 1
            && oldClosing[0]!.scope !== undefined && /^[}\]]$/.test(oldClosing[0]!.text)
            && matchWeight(oldClosing[0]!, newClosing[0]!, true) > 0;
          const similarity = sameScopes && before[i]!.trim() === after[j]!.trim() ? 1 : sameClosing ? 0.9
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
    highlightBlock(left: MatchLines, right: MatchLines): { before: DiffSegment[][]; after: DiffSegment[][] } | undefined {
      const pairs = this.align(left.map(line => line.map(token => token.text).join("")), right.map(line => line.map(token => token.text).join("")), left, right, () => []);
      const anchors = pairs.filter(pair => {
        if (pair.before === undefined || pair.after === undefined) return false;
        const before = meaningful(left[pair.before]!);
        const after = meaningful(right[pair.after]!);
        const weight = Math.min(...[before, after].map(tokens => tokens.reduce((sum, token) => sum + tokenWeight(token), 0)));
        return weight >= 4 && common(before, after, true) / weight >= 0.8;
      });
      const result: InlineChange = { before: [], after: [] };
      let old = 0;
      let next = 0;
      for (const anchor of [...anchors, { before: left.length, after: right.length }]) {
        const gap = this.highlight(left.slice(old, anchor.before).flat(), right.slice(next, anchor.after).flat());
        if (!gap) return;
        result.before.push(...gap.before);
        result.after.push(...gap.after);
        if (anchor.before! < left.length && anchor.after! < right.length) {
          const pair = this.highlight(left[anchor.before!]!, right[anchor.after!]!);
          if (!pair) return;
          result.before.push(...pair.before);
          result.after.push(...pair.after);
        }
        old = anchor.before! + 1;
        next = anchor.after! + 1;
      }
      const distribute = (lines: MatchLines, other: MatchLines, segments: DiffSegment[]) => {
        let index = 0;
        let offset = 0;
        return lines.map(line => {
          const output: DiffSegment[] = [];
          let remaining = line.reduce((sum, token) => sum + token.text.length, 0);
          while (remaining > 0) {
            const segment = segments[index]!;
            const length = Math.min(remaining, segment.text.length - offset);
            append(output, segment.text.slice(offset, offset + length), segment.changed);
            remaining -= length;
            offset += length;
            if (offset === segment.text.length) { index++; offset = 0; }
          }
          const first = line.findIndex(token => !!token.type);
          const leading = line.slice(0, first).map(token => token.text).join("");
          const anchor = line[first];
          if (anchor?.scope !== undefined && /^[ \t]+$/.test(leading) && other.some(candidate => {
            const index = candidate.findIndex(token => !!token.type);
            return index >= 0 && candidate.slice(0, index).map(token => token.text).join("") === leading
              && matchWeight(anchor, candidate[index]!, true) > 0;
          })) {
            const normalized: DiffSegment[] = [];
            let position = 0;
            for (const segment of output) {
              const prefix = Math.min(segment.text.length, Math.max(0, leading.length - position));
              if (prefix) append(normalized, segment.text.slice(0, prefix), false);
              if (prefix < segment.text.length) append(normalized, segment.text.slice(prefix), segment.changed);
              position += segment.text.length;
            }
            return normalized;
          }
          return output;
        });
      };
      return { before: distribute(left, right, result.before), after: distribute(right, left, result.after) };
    },
    highlight(left: MatchToken[], right: MatchToken[]): InlineChange | undefined {
      const cells = (left.length + 1) * (right.length + 1);
      if (left.length > 512 || right.length > 512 || cells > 65_536 || cells > remainingCells || [left, right].some(line => line.reduce((sum, token) => sum + token.text.length, 0) > 4096)) return;
      remainingCells -= cells;
      const width = right.length + 1;
      const scores = new Float64Array(cells);
      const weight = (i: number, j: number) => {
        const a = left[i]!;
        const b = right[j]!;
        if (!a.type && !b.type && a.text === b.text) {
          const sameNeighbor = (x: MatchToken | undefined, y: MatchToken | undefined) => !x && !y || !!x && !!y && matchWeight(x, y, true) > 0;
          return sameNeighbor(left[i - 1], right[j - 1]) && sameNeighbor(left[i + 1], right[j + 1]) ? 0.001 : 0;
        }
        return matchWeight(a, b, true);
      };
      for (let i = left.length - 1; i >= 0; i--) {
        for (let j = right.length - 1; j >= 0; j--) {
          scores[i * width + j] = Math.max(weight(i, j) + scores[(i + 1) * width + j + 1]!, scores[(i + 1) * width + j]!, scores[i * width + j + 1]!);
        }
      }
      const result: InlineChange = { before: [], after: [] };
      let i = 0;
      let j = 0;
      while (i < left.length || j < right.length) {
        if (i < left.length && j < right.length && weight(i, j) > 0 && scores[i * width + j] === weight(i, j) + scores[(i + 1) * width + j + 1]!) {
          append(result.before, left[i++]!.text, false);
          append(result.after, right[j++]!.text, false);
        } else if (i < left.length && (j === right.length || scores[(i + 1) * width + j]! >= scores[i * width + j + 1]!)) append(result.before, left[i++]!.text, true);
        else append(result.after, right[j++]!.text, true);
      }
      return result;
    },
  };
}
