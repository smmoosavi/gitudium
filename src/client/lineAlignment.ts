import { createWordHighlighter } from "./wordDiff";

export type LinePair = { before?: number; after?: number };
export type LineAligner = (before: string[], after: string[]) => LinePair[];

export function createLineAligner(): LineAligner {
  let remainingCandidates = 4096;
  const highlight = createWordHighlighter();
  return (before, after) => {
    const positional = () => Array.from({ length: Math.max(before.length, after.length) }, (_, index) => ({ before: index < before.length ? index : undefined, after: index < after.length ? index : undefined }));
    const candidates = before.length * after.length;
    if (Math.max(before.length, after.length) > 100 || candidates > remainingCandidates || [...before, ...after].some(line => line.length > 4096)) return positional();
    remainingCandidates -= candidates;
    const width = after.length + 1;
    const scores = new Float64Array((before.length + 1) * width);
    const similarities = new Float64Array(candidates);
    const meaningful = (text: string) => (text.match(/[\p{L}\p{N}\p{M}_]/gu) ?? []).length;
    for (let i = 0; i < before.length; i++) {
      for (let j = 0; j < after.length; j++) {
        const left = before[i]!;
        const right = after[j]!;
        if (left.trim() === right.trim()) { similarities[i * after.length + j] = 1; continue; }
        const punctuationOnly = meaningful(left) === 0 && meaningful(right) === 0;
        const change = highlight(punctuationOnly ? left.replace(/\s/g, "") : left, punctuationOnly ? right.replace(/\s/g, "") : right);
        if (!change) continue;
        const size = (text: string) => punctuationOnly ? text.replace(/\s/g, "").length : meaningful(text);
        const shared = change.before.reduce((sum, segment) => sum + (segment.changed ? 0 : size(segment.text)), 0);
        const similarity = shared / Math.max(size(left), size(right), 1);
        if (similarity >= 0.5) similarities[i * after.length + j] = similarity;
      }
    }
    for (let i = before.length - 1; i >= 0; i--) {
      for (let j = after.length - 1; j >= 0; j--) {
        const similarity = similarities[i * after.length + j]!;
        scores[i * width + j] = Math.max(scores[(i + 1) * width + j]!, scores[i * width + j + 1]!, similarity ? similarity + scores[(i + 1) * width + j + 1]! : 0);
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
  };
}
