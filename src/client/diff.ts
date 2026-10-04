export type DiffMode = "unified" | "split";
export const diffStorageKey = "gitudium.diff-mode.v1";
export const wrapStorageKey = "gitudium.diff-wrap.v1";
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

export type DiffLine = { text: string; number?: number; kind: "context" | "addition" | "deletion"; noNewline?: boolean };
export type DiffRow = { header: string } | { left?: DiffLine; right?: DiffLine };

export function splitPatch(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNumber = 0;
  let newNumber = 0;
  let inHunk = false;
  let removed: DiffLine[] = [];
  let added: DiffLine[] = [];
  let previous: DiffLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) rows.push({ left: removed[i], right: added[i] });
    removed = []; added = [];
  };
  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      flush(); oldNumber = Number(hunk[1]); newNumber = Number(hunk[2]); inHunk = true;
      previous = []; rows.push({ header: line });
    } else if (inHunk && line.startsWith("\\ No newline at end of file")) {
      for (const item of previous) item.noNewline = true;
    } else if (inHunk && line.startsWith("-")) {
      if (added.length) flush();
      const item: DiffLine = { text: line.slice(1), number: oldNumber++, kind: "deletion" };
      removed.push(item); previous = [item];
    } else if (inHunk && line.startsWith("+")) {
      const item: DiffLine = { text: line.slice(1), number: newNumber++, kind: "addition" };
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
