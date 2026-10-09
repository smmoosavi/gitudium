import type { DiffModel, DiffSegment } from "./diffModel";
import type { SyntaxResult, SyntaxToken } from "./syntaxTypes";

export const maxRenderedSyntaxSegments = 50_000;

export function syntaxSegments(text: string, tokens: SyntaxToken[] | undefined, words?: DiffSegment[]): DiffSegment[] | undefined {
  if (!tokens || tokens.map(token => token.text).join("") !== text) return words;
  if (words && words.map(word => word.text).join("") !== text) return words;
  const changes = words ?? [{ text, changed: false }];
  const result: DiffSegment[] = [];
  let wordIndex = 0;
  let wordOffset = 0;
  for (const token of tokens) {
    let offset = 0;
    while (offset < token.text.length) {
      while (wordIndex < changes.length && wordOffset === changes[wordIndex]!.text.length) { wordIndex++; wordOffset = 0; }
      const word = changes[wordIndex];
      if (!word) return words;
      const length = Math.min(token.text.length - offset, word.text.length - wordOffset);
      const color = token.color && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(token.color) ? token.color : undefined;
      result.push({ text: token.text.slice(offset, offset + length), changed: word.changed, color });
      offset += length;
      wordOffset += length;
    }
  }
  return result;
}

export function applyDiffSyntax(model: DiffModel, syntax: SyntaxResult | undefined): DiffModel {
  if (!syntax) return model;
  let count = 0;
  const style = (text: string, tokens: SyntaxToken[] | undefined, words?: DiffSegment[]) => {
    if (count > maxRenderedSyntaxSegments) return words;
    const segments = syntaxSegments(text, tokens, words);
    count += segments?.length ?? 0;
    return segments;
  };
  const split = model.split.map(row => {
    if ("header" in row || "gap" in row) return row;
    return {
      left: row.left && { ...row.left, segments: style(row.left.text, syntax.before?.[(row.left.number ?? 0) - 1], row.left.segments) },
      right: row.right && { ...row.right, segments: style(row.right.text, syntax.after?.[(row.right.number ?? 0) - 1], row.right.segments) },
    };
  });
  const unified = model.unified.map(line => {
    const tokens = line.newNumber !== undefined ? syntax.after?.[line.newNumber - 1] : line.oldNumber !== undefined ? syntax.before?.[line.oldNumber - 1] : undefined;
    if (!tokens) return line;
    const prefix = line.prefix ?? line.text[0];
    const text = line.prefix === undefined ? line.text.slice(1) : line.text;
    const segments = style(text, tokens, line.segments);
    return segments ? { ...line, prefix, text, segments } : line;
  });
  return count > maxRenderedSyntaxSegments ? model : { split, unified };
}
