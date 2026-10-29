import { allocateRoutes } from "./graphRouting";
import { buildTracks } from "./graphTopology";
import { drawingRows } from "./graphGeometry";
import type { CommitSummary } from "../repository/types";

export { referencePriority } from "./commitTopology";

export interface GraphConnection { childId: string; parentId: string; parentIndex: number; open: boolean }
export interface GraphSegment { connection: GraphConnection; from: number; to: number; part: "above" | "below" | "turn" }
export interface GraphRow {
  id: string;
  lane: number;
  root: boolean;
  segments: GraphSegment[];
}
export interface CommitGraph { rows: GraphRow[]; width: number; priorities: number[] }

// Input is child-before-parent topological order. Display dimensions never
// participate in topology, connection constraints, or lane allocation.
export function layoutCommitGraph(commits: CommitSummary[], head: string | null = null, previous?: CommitGraph): CommitGraph {
  const topology = buildTracks(commits, head, previous);
  const routed = allocateRoutes(commits, topology, previous);
  const rows = drawingRows(commits, routed);
  return { rows, width: routed.width, priorities: topology.priorities };
}
