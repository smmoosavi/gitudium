import type { GraphRow } from "./graph";

export const graphLaneWidth = 16;
export const graphWidth = (lanes: number) => lanes * graphLaneWidth + 16;
export const commitRowHeight = 100;

export function visibleGraphLanes(rows: GraphRow[], indexes: number[]): number {
  let maximum = 0;
  for (const index of indexes) {
    const row = rows[index];
    if (!row) continue;
    maximum = Math.max(maximum, row.lane);
    for (const lane of row.above) maximum = Math.max(maximum, lane);
    for (const lane of row.below) maximum = Math.max(maximum, lane);
    for (const edge of row.outgoing) maximum = Math.max(maximum, edge.from, edge.to);
  }
  return maximum + 1;
}

export function graphViewportWidth(lanes: number, paneWidth: number): number {
  return Math.min(graphWidth(lanes), Math.max(0, paneWidth * 0.35), 180);
}

export function graphScrollOffset(offset: number, contentWidth: number, viewportWidth: number): number {
  return Math.max(0, Math.min(offset, contentWidth - viewportWidth));
}
