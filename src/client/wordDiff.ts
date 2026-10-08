import type { DiffSegment } from "./diffModel";
export type InlineChange = { before: DiffSegment[]; after: DiffSegment[] };

const maxLineLength = 4096;
const maxTokens = 512;
const maxPairCells = 65_536;
const maxPatchCells = 1_000_000;
const maxBlockLines = 100;

export function createWordHighlighter() {
  let remainingCells = maxPatchCells;
  return (before: string, after: string): InlineChange | undefined => {
    if (before === after || before.length > maxLineLength || after.length > maxLineLength) return undefined;
    const tokenize = (text: string) => text.match(/[\p{L}\p{N}\p{M}_]+|\s+|[^\p{L}\p{N}\p{M}_\s]/gu) ?? [];
    const left = tokenize(before);
    const right = tokenize(after);
    const cells = (left.length + 1) * (right.length + 1);
    if (left.length > maxTokens || right.length > maxTokens || cells > maxPairCells || cells > remainingCells) return undefined;
    remainingCells -= cells;
    const width = right.length + 1;
    // Weight matching tokens by length so a whitespace tie cannot displace an unchanged word.
    const lengths = new Uint16Array(cells);
    for (let i = left.length - 1; i >= 0; i--) {
      for (let j = right.length - 1; j >= 0; j--) {
        lengths[i * width + j] = left[i] === right[j]
          ? left[i]!.length + lengths[(i + 1) * width + j + 1]!
          : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
      }
    }
    const result: InlineChange = { before: [], after: [] };
    const append = (segments: DiffSegment[], text: string, changed: boolean) => {
      const previous = segments.at(-1);
      if (previous?.changed === changed) previous.text += text;
      else segments.push({ text, changed });
    };
    let i = 0;
    let j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        append(result.before, left[i++]!, false);
        append(result.after, right[j++]!, false);
      } else if (i < left.length && (j === right.length || lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!)) {
        append(result.before, left[i++]!, true);
      } else {
        append(result.after, right[j++]!, true);
      }
    }
    const meaningfulLength = (text: string) => (text.match(/[\p{L}\p{N}\p{M}_]/gu) ?? []).length;
    const sharedLength = result.before.reduce((total, segment) => total + (segment.changed ? 0 : meaningfulLength(segment.text)), 0);
    const contentLength = Math.max(meaningfulLength(before), meaningfulLength(after));
    // Spaces and punctuation alone do not make unrelated lines a useful inline comparison.
    if (contentLength === 0 || sharedLength / contentLength < 0.25) return undefined;
    return result;
  };
}

export function patchHighlights(patch: string): Map<number, DiffSegment[]> {
  const highlights = new Map<number, DiffSegment[]>();
  const highlight = createWordHighlighter();
  const lines = patch.split("\n");
  let removed: number[] = [];
  let added: number[] = [];
  let inHunk = false;
  const flush = () => {
    if (Math.max(removed.length, added.length) <= maxBlockLines) {
      for (let i = 0; i < Math.min(removed.length, added.length); i++) {
        const oldIndex = removed[i]!;
        const newIndex = added[i]!;
        const change = highlight(lines[oldIndex]!.slice(1), lines[newIndex]!.slice(1));
        if (change) {
          highlights.set(oldIndex, change.before);
          highlights.set(newIndex, change.after);
        }
      }
    }
    removed = []; added = [];
  };
  for (const [index, line] of lines.entries()) {
    if (/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line)) {
      flush(); inHunk = true;
    } else if (inHunk && line.startsWith("-")) {
      if (added.length) flush();
      removed.push(index);
    } else if (inHunk && line.startsWith("+")) {
      added.push(index);
    } else if (inHunk && line.startsWith("\\ No newline at end of file")) {
      continue;
    } else {
      flush();
      if (!line.startsWith(" ")) inHunk = false;
    }
  }
  flush();
  return highlights;
}
