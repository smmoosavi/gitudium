export const rowEstimate = 90;
export const rowOverscan = 5;

export function rowOffsets(ids: string[], heights: ReadonlyMap<string, number>) {
  const offsets = [0];
  for (const id of ids) offsets.push(offsets.at(-1)! + (heights.get(id) ?? rowEstimate));
  return offsets;
}

export function rowAt(offsets: number[], position: number) {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (offsets[middle]! <= position) low = middle;
    else high = middle - 1;
  }
  return Math.min(low, offsets.length - 2);
}

export function visibleRows(offsets: number[], top: number, height: number, pinned = -1) {
  if (offsets.length < 2) return [];
  const start = Math.max(0, rowAt(offsets, top) - rowOverscan);
  const end = Math.min(offsets.length - 2, rowAt(offsets, top + height) + rowOverscan);
  const rows = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  if (pinned >= 0 && pinned < offsets.length - 1 && !rows.includes(pinned)) rows.push(pinned);
  return rows.sort((a, b) => a - b);
}

export function revealRow(offsets: number[], index: number, top: number, height: number) {
  if (offsets[index] === undefined || offsets[index + 1] === undefined) return top;
  if (offsets[index]! < top) return offsets[index]!;
  if (offsets[index + 1]! > top + height) return Math.max(offsets[index]!, offsets[index + 1]! - height);
  return top;
}
