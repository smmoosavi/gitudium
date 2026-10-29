import type { CommitSummary } from "../repository/types";
import type { CommitGraph } from "./graph";

export function referencePriority(reference: string): number {
  const name = reference.match(/^refs\/(?:heads\/|remotes\/(?:origin|upstream)\/)([^/]+)$/)?.[1] ?? "";
  if (["main", "trunk", "mainline", "default", "stable", "master"].includes(name)) return 0;
  if (["dev", "devel", "develop", "development"].includes(name)) return 1;
  return reference === "HEAD" ? 2 : 3;
}

export interface Track { nodes: number[]; priority: number; start: number; end: number; lane: number; minimumOwner?: number }

export interface GraphTopology {
  indexes: Map<string, number>;
  priorities: number[];
  reusable: boolean;
  tracks: Track[];
  owners: number[];
}

// Input is Git's child-before-parent topological order. Missing parents remain
// open at the page boundary rather than being mistaken for roots.
export function buildTracks(commits: CommitSummary[], head: string | null, previous?: CommitGraph): GraphTopology {
  const indexes = new Map(commits.map((commit, index) => [commit.id, index]));
  const priorities = commits.map(commit => Math.min(commit.id === head ? 2 : 3, ...commit.references.map(referencePriority)));
  const children: number[][] = commits.map(() => []);
  commits.forEach((commit, index) => {
    const parent = indexes.get(commit.parents[0] ?? "");
    if (parent !== undefined) {
      children[parent]!.push(index);
      priorities[parent] = Math.min(priorities[parent]!, priorities[index]!);
    }
  });
  const reusable = Boolean(previous && previous.rows.length <= commits.length && previous.rows.every((row, index) =>
    row.id === commits[index]!.id && previous.priorities[index] === priorities[index]));
  const continuation = children.map((list, index) => {
    const ordered = [...list].sort((a, b) => priorities[a]! - priorities[b]! || a - b);
    return ordered.find(child => !reusable || !previous?.rows[index] || !previous?.rows[child]
      || previous.rows[index]!.lane === previous.rows[child]!.lane);
  });
  const tracks: Track[] = [];
  const owners: number[] = [];
  commits.forEach((_, index) => {
    const child = continuation[index];
    const owner = child === undefined ? tracks.length : owners[child]!;
    if (child === undefined) tracks.push({ nodes: [], priority: 3, start: index, end: index, lane: -1 });
    owners[index] = owner;
    const track = tracks[owner]!;
    track.nodes.push(index);
    track.end = index;
    track.priority = Math.min(track.priority, priorities[index]!);
  });
  return { indexes, priorities, reusable, tracks, owners };
}

