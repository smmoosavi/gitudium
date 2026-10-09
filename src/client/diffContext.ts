import type { DiffLine, DiffModel, DiffRow, UnifiedDiffLine } from "./diffModel";

export type ContextSources = { before: { text: string } | null; after: { text: string } | null };
export type ContextGap = { id: string; count: number };
export type ContextExpansion = Record<string, { above: number; below: number }>;
export const contextPageSize = 20;
export const maxFullFileLines = 20_000;

function sourceLines(text?: string) {
  if (!text) return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function pendingDiffContext(base: DiffModel, sources?: ContextSources): DiffModel {
  const inferGaps = () => {
    let oldNext = 1;
    let newNext = 1;
    let hasHunk = false;
    return (header?: string): ContextGap | undefined => {
      if (header === undefined) {
        if (!sources || !hasHunk) return;
        const count = sourceLines(sources.before?.text).length + 1 - oldNext;
        const afterCount = sourceLines(sources.after?.text).length + 1 - newNext;
        return count > 0 && count === afterCount ? { id: `${oldNext}:${newNext}:${count}`, count } : undefined;
      }
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
      if (!match) return;
      hasHunk = true;
      const oldCount = Number(match[2] ?? 1);
      const newCount = Number(match[4] ?? 1);
      const oldStart = Number(match[1]) + (oldCount === 0 ? 1 : 0);
      const newStart = Number(match[3]) + (newCount === 0 ? 1 : 0);
      const count = oldStart - oldNext;
      const gap = count > 0 && count === newStart - newNext ? { id: `${oldNext}:${newNext}:${count}`, count } : undefined;
      oldNext = oldStart + oldCount;
      newNext = newStart + newCount;
      return gap;
    };
  };
  const splitGap = inferGaps();
  const unifiedGap = inferGaps();
  const result: DiffModel = {
    split: base.split.flatMap((row): DiffRow[] => {
      const gap = "header" in row ? splitGap(row.header) : undefined;
      return gap ? [{ gap }, row] : [row];
    }),
    unified: base.unified.flatMap((line): UnifiedDiffLine[] => {
      const gap = line.kind === "hunk" && !line.metadata ? unifiedGap(line.text) : undefined;
      return gap ? [{ text: "", gap }, line] : [line];
    }),
  };
  const trailingSplit = splitGap();
  const trailingUnified = unifiedGap();
  if (trailingSplit) result.split.push({ gap: trailingSplit });
  if (trailingUnified) result.unified.push({ text: "", gap: trailingUnified });
  return result;
}

export function expandDiffContext(base: DiffModel, sources: ContextSources, expansion: ContextExpansion, full = false, filtered = false): DiffModel {
  const before = sourceLines(sources.before?.text);
  const after = sourceLines(sources.after?.text);
  const rows: DiffRow[] = [];
  let oldNext = 1;
  let newNext = 1;
  let revealed = 0;
  const gap = (oldEnd: number, newEnd: number) => {
    const oldCount = oldEnd - oldNext;
    const newCount = newEnd - newNext;
    if (oldCount < 0 || newCount < 0 || (!filtered && oldCount !== newCount)) throw new Error("Source and patch context do not align.");
    const count = Math.max(oldCount, newCount);
    if (!count) return;
    const id = `${oldNext}:${newNext}:${count}`;
    const requested = expansion[id] ?? { above: 0, below: 0 };
    const available = Math.max(0, maxFullFileLines - revealed);
    const above = Math.min(count, available, full ? count : requested.above);
    const below = Math.min(count - above, available - above, requested.below);
    revealed += above + below;
    const append = (offset: number) => {
      const oldNumber = oldNext + offset;
      const newNumber = newNext + offset;
      const text = offset < oldCount ? before[oldNumber - 1] : undefined;
      const newText = offset < newCount ? after[newNumber - 1] : undefined;
      if (filtered && (offset >= oldCount || offset >= newCount)) {
        rows.push({
          ...(text !== undefined ? { left: { text, number: oldNumber, kind: "context" as const, ...(oldNumber === before.length && !sources.before?.text.endsWith("\n") ? { noNewline: true } : {}) } } : {}),
          ...(newText !== undefined ? { right: { text: newText, number: newNumber, kind: "context" as const, ...(newNumber === after.length && !sources.after?.text.endsWith("\n") ? { noNewline: true } : {}) } } : {}),
        });
        return;
      }
      if (text === undefined || newText === undefined || (!filtered && text !== newText)) throw new Error("Source and patch context do not match.");
      rows.push({ left: { text, number: oldNumber, kind: "context", ...(oldNumber === before.length && !sources.before?.text.endsWith("\n") ? { noNewline: true } : {}) }, right: { text: newText, number: newNumber, kind: "context", ...(newNumber === after.length && !sources.after?.text.endsWith("\n") ? { noNewline: true } : {}) } });
    };
    for (let i = 0; i < above; i++) append(i);
    if (above + below < count) rows.push({ gap: { id, count: count - above - below } });
    for (let i = count - below; i < count; i++) append(i);
    oldNext = oldEnd; newNext = newEnd;
  };
  try {
    for (const row of base.split) {
      if ("gap" in row) return base;
      if ("header" in row) {
        const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(row.header);
        if (match) {
          gap(Number(match[1]) + (match[2] === "0" ? 1 : 0), Number(match[3]) + (match[4] === "0" ? 1 : 0));
        }
        rows.push(row);
      } else {
        const sourceLine = (line?: DiffLine, text?: string): DiffLine | undefined => line && text !== undefined ? { ...line, text } : line;
        rows.push(filtered ? {
          left: sourceLine(row.left, row.left?.number === undefined ? undefined : before[row.left.number - 1]),
          right: sourceLine(row.right, row.right?.number === undefined ? undefined : after[row.right.number - 1]),
        } : row);
        if (row.left?.number !== undefined) oldNext = row.left.number + 1;
        if (row.right?.number !== undefined) newNext = row.right.number + 1;
      }
    }
    gap(before.length + 1, after.length + 1);
  } catch {
    return base;
  }
  const unified: UnifiedDiffLine[] = [];
  const appendLine = (line: DiffLine, prefix: string, newNumber = line.number) => {
    unified.push({ text: line.text, prefix, oldNumber: prefix !== "+" ? line.number : undefined, newNumber: prefix !== "-" ? newNumber : undefined, kind: line.kind === "context" ? undefined : line.kind, segments: line.segments });
    if (line.noNewline) unified.push({ text: "\\ No newline at end of file", noNewline: true });
  };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if ("header" in row) unified.push({ text: row.header, kind: "hunk", metadata: row.metadata });
    else if ("gap" in row) unified.push({ text: "", gap: row.gap });
    else if (row.left?.kind === "context" || row.right?.kind === "context") {
      const line = row.right ?? row.left!;
      unified.push({ text: line.text, prefix: " ", oldNumber: row.left?.number, newNumber: row.right?.number, segments: line.segments });
      if (line.noNewline) unified.push({ text: "\\ No newline at end of file", noNewline: true });
    }
    else {
      const block: typeof row[] = [row];
      while (i + 1 < rows.length) {
        const next = rows[i + 1]!;
        if ("header" in next || "gap" in next || next.left?.kind === "context" || next.right?.kind === "context") break;
        block.push(next); i++;
      }
      for (const changed of block) if (changed.left) appendLine(changed.left, "-");
      for (const changed of block) if (changed.right) appendLine(changed.right, "+");
    }
  }
  return { unified, split: rows };
}

export function canShowFullFile(sources: ContextSources) {
  return Math.max(sourceLines(sources.before?.text).length, sourceLines(sources.after?.text).length) <= maxFullFileLines;
}
