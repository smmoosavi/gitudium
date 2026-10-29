import type { CommitSummary } from "../repository/types";

export interface GraphEdge { from: number; to: number }
export interface GraphRow {
  id: string;
  lane: number;
  root: boolean;
  above: number[];
  below: number[];
  outgoing: GraphEdge[];
}
export interface CommitGraph { rows: GraphRow[]; width: number; priorities: number[] }

export function referencePriority(reference: string): number {
  const name = reference.match(/^refs\/(?:heads\/|remotes\/(?:origin|upstream)\/)([^/]+)$/)?.[1] ?? "";
  if (["main", "trunk", "mainline", "default", "stable", "master"].includes(name)) return 0;
  if (["dev", "devel", "develop", "development"].includes(name)) return 1;
  return reference === "HEAD" ? 2 : 3;
}

export { layoutCommitGraph } from "./graphRouting";
