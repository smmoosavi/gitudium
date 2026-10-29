import type { CommitSummary } from "../repository/types";
import type { GraphRow, GraphSegment } from "./graph";
import type { RoutedGraph } from "./graphRouting";

// This is the complete drawing contract: above ends at the dot's height;
// below and turn start there. A crossing away from that height is not a junction.
export function drawingRows(commits: CommitSummary[], routed: RoutedGraph): GraphRow[] {
  const rows: GraphRow[] = commits.map((commit, index) => ({
    id: commit.id, lane: routed.lanes[index]!, root: commit.parents.length === 0,
    segments: [],
  }));
  for (const connection of routed.connections) {
    const { start, end, join, from, target } = connection;
    const delayed = join > start && connection.lane !== target;
    const initial = delayed ? connection.lane : target;
    const turn = (index: number, from: number, to: number) => {
      rows[index]!.segments.push({ connection, from, to, part: "turn" });
    };
    turn(start, from, initial);
    for (let index = start + 1; index <= Math.min(end, rows.length - 1); index++) {
      const lane = delayed && index <= join ? initial : target;
      rows[index]!.segments.push({ connection, from: lane, to: lane, part: "above" });
      if (index === end) continue;
      if (delayed && index === join) turn(index, initial, target);
      else rows[index]!.segments.push({ connection, from: lane, to: lane, part: "below" });
    }
  }
  return rows;
}

export const graphLaneWidth = 16;
export const graphWidth = (lanes: number) => lanes * graphLaneWidth + 16;
export const laneX = (lane: number) => 16 + lane * graphLaneWidth;
export function segmentPath(segment: GraphSegment): string {
  const from = laneX(segment.from);
  const to = laneX(segment.to);
  if (segment.part === "above") return `M ${from} 0 V 22`;
  if (segment.part === "below" || from === to) return `M ${from} 22 V 10000`;
  return `M ${from} 22 C ${from} 36, ${to} 36, ${to} 50 V 10000`;
}

export function occupiedLanes(row: GraphRow): number {
  return row.segments.reduce((maximum, segment) => Math.max(maximum, segment.from + 1, segment.to + 1), row.lane + 1);
}
