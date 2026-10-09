import type { DiffLine, DiffRow, DiffSegment } from "./diffModel";
import type { LineAligner } from "./lineAlignment";
import type { ChangeBlock } from "./wordDiff";
export type { DiffLine, DiffRow } from "./diffModel";

export type DiffMode = "unified" | "split";
export type WhitespaceMode = "none" | "all";
export const whitespaceStorageKey = "gitudium.diff-whitespace.v1";
export function readWhitespaceMode(storage: Pick<Storage, "getItem">): WhitespaceMode {
  try {
    const saved = storage.getItem(whitespaceStorageKey);
    return saved === "all" || saved === "trailing" || saved === "all-and-blank-lines" ? "all" : "none";
  } catch { return "none"; }
}
export function writeWhitespaceMode(storage: Pick<Storage, "setItem">, mode: WhitespaceMode) {
  try { storage.setItem(whitespaceStorageKey, mode); } catch { /* Storage can be blocked or full. */ }
}
export const diffStorageKey = "gitudium.diff-mode.v1";
export const wrapStorageKey = "gitudium.diff-wrap.v1";
export const pairingStorageKey = "gitudium.diff-pairing.v1";
export function readLinePairing(storage: Pick<Storage, "getItem">): boolean {
  try { return storage.getItem(pairingStorageKey) === "true"; } catch { return false; }
}
export function writeLinePairing(storage: Pick<Storage, "setItem">, enabled: boolean) {
  try { storage.setItem(pairingStorageKey, String(enabled)); } catch { /* Storage can be blocked or full. */ }
}
export function readDiffWrap(storage: Pick<Storage, "getItem">): boolean {
  try { return storage.getItem(wrapStorageKey) === "true"; } catch { return false; }
}
export function writeDiffWrap(storage: Pick<Storage, "setItem">, wrap: boolean) {
  try { storage.setItem(wrapStorageKey, String(wrap)); } catch { /* Storage can be blocked or full. */ }
}

export function readDiffMode(storage: Pick<Storage, "getItem">): DiffMode {
  try { return storage.getItem(diffStorageKey) === "split" ? "split" : "unified"; }
  catch { return "unified"; }
}

export function writeDiffMode(storage: Pick<Storage, "setItem">, mode: DiffMode) {
  try { storage.setItem(diffStorageKey, mode); } catch { /* Storage can be blocked or full. */ }
}

export function effectiveDiffMode(mode: DiffMode, status?: string): DiffMode {
  return status === "added" || status === "deleted" ? "unified" : mode;
}

export function splitPatch(patch: string, highlights?: Map<number, DiffSegment[]>, align?: LineAligner): DiffRow[] {
  return splitPatchRows(patch, highlights, align);
}

/** Engine-only path: consume decisions rather than running a second aligner. */
export function splitChangeBlocks(patch: string, blocks: ChangeBlock[]): DiffRow[] {
  return splitPatchRows(patch, undefined, undefined, blocks);
}

function splitPatchRows(patch: string, highlights?: Map<number, DiffSegment[]>, align?: LineAligner, blocks?: ChangeBlock[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let blockIndex = 0;
  const segmentsAt = (index: number) => blocks ? blocks[blockIndex]?.highlights.get(index) : highlights?.get(index);
  let oldNumber = 0;
  let newNumber = 0;
  let inHunk = false;
  let removed: DiffLine[] = [];
  let added: DiffLine[] = [];
  let previous: DiffLine[] = [];
  const flush = () => {
    if (blocks) {
      if (!removed.length && !added.length) return;
      for (const pair of blocks[blockIndex++]!.pairs) rows.push({ left: pair.before === undefined ? undefined : removed[pair.before], right: pair.after === undefined ? undefined : added[pair.after] });
    } else if (align) {
      for (const pair of align(removed.map(line => line.text), added.map(line => line.text))) rows.push({ left: pair.before === undefined ? undefined : removed[pair.before], right: pair.after === undefined ? undefined : added[pair.after] });
    } else for (let i = 0; i < Math.max(removed.length, added.length); i++) rows.push({ left: removed[i], right: added[i] });
    removed = []; added = [];
  };
  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const [index, line] of lines.entries()) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      flush(); oldNumber = Number(hunk[1]); newNumber = Number(hunk[2]); inHunk = true;
      previous = []; rows.push({ header: line });
    } else if (inHunk && line.startsWith("\\ No newline at end of file")) {
      for (const item of previous) item.noNewline = true;
    } else if (inHunk && line.startsWith("-")) {
      if (added.length) flush();
      const item: DiffLine = { text: line.slice(1), number: oldNumber++, kind: "deletion" };
      const segments = segmentsAt(index);
      if (segments) item.segments = segments;
      removed.push(item); previous = [item];
    } else if (inHunk && line.startsWith("+")) {
      const item: DiffLine = { text: line.slice(1), number: newNumber++, kind: "addition" };
      const segments = segmentsAt(index);
      if (segments) item.segments = segments;
      added.push(item); previous = [item];
    } else if (inHunk && line.startsWith(" ")) {
      flush();
      const left: DiffLine = { text: line.slice(1), number: oldNumber++, kind: "context" };
      const right: DiffLine = { text: line.slice(1), number: newNumber++, kind: "context" };
      rows.push({ left, right }); previous = [left, right];
    } else {
      flush(); inHunk = false; previous = []; rows.push({ header: line });
    }
  }
  flush();
  return rows;
}
