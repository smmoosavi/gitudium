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

export function expandDiffContext(base: DiffModel, sources: ContextSources, expansion: ContextExpansion, full = false): DiffModel {
  const before = sourceLines(sources.before?.text);
  const after = sourceLines(sources.after?.text);
  const rows: DiffRow[] = [];
  let oldNext = 1;
  let newNext = 1;
  let revealed = 0;
  const gap = (oldEnd: number, newEnd: number) => {
    const count = oldEnd - oldNext;
    if (count < 0 || count !== newEnd - newNext) throw new Error("Source and patch context do not align.");
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
      const text = before[oldNumber - 1];
      if (text === undefined || text !== after[newNumber - 1]) throw new Error("Source and patch context do not match.");
      rows.push({ left: { text, number: oldNumber, kind: "context", ...(oldNumber === before.length && !sources.before?.text.endsWith("\n") ? { noNewline: true } : {}) }, right: { text, number: newNumber, kind: "context", ...(newNumber === after.length && !sources.after?.text.endsWith("\n") ? { noNewline: true } : {}) } });
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
        rows.push(row);
        if (row.left?.number !== undefined) oldNext = row.left.number + 1;
        if (row.right?.number !== undefined) newNext = row.right.number + 1;
      }
    }
    gap(before.length + 1, after.length + 1);
  } catch {
    return base;
  }
  const unified: UnifiedDiffLine[] = [];
  const appendLine = (line: DiffLine, prefix: string) => {
    unified.push({ text: line.text, prefix, kind: line.kind === "context" ? undefined : line.kind, segments: line.segments });
    if (line.noNewline) unified.push({ text: "\\ No newline at end of file" });
  };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if ("header" in row) unified.push({ text: row.header, kind: "hunk" });
    else if ("gap" in row) unified.push({ text: "", gap: row.gap });
    else if (row.left?.kind === "context") appendLine(row.left, " ");
    else {
      const block: typeof row[] = [row];
      while (i + 1 < rows.length) {
        const next = rows[i + 1]!;
        if ("header" in next || "gap" in next || next.left?.kind === "context") break;
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
