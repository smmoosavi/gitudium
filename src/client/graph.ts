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

interface Track { nodes: number[]; priority: number; start: number; end: number; lane: number }

// Input is Git's child-before-parent topological order. Missing parents remain
// open at the page boundary rather than being mistaken for roots.
export function layoutCommitGraph(commits: CommitSummary[], head: string | null = null, previous?: CommitGraph): CommitGraph {
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
  const reusable = previous && previous.rows.length <= commits.length && previous.rows.every((row, index) =>
    row.id === commits[index]!.id && previous.priorities[index] === priorities[index]);
  const continuation = children.map((list, index) => {
    const ordered = [...list].sort((a, b) => priorities[a]! - priorities[b]! || a - b);
    return ordered.find(child => !reusable || !previous.rows[index] || !previous.rows[child]
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
  const missing = new Map<string, number>();
  const parentOwner = (id: string) => {
    const index = indexes.get(id);
    if (index !== undefined) return owners[index]!;
    let owner = missing.get(id);
    if (owner === undefined) {
      owner = tracks.length;
      tracks.push({ nodes: [], priority: 3, start: commits.length, end: commits.length, lane: -1 });
      missing.set(id, owner);
    }
    return owner;
  };
  commits.map((_, index) => index).sort((a, b) => priorities[a]! - priorities[b]! || a - b).forEach(index => {
    const id = commits[index]!.parents[0];
    if (id !== undefined && !indexes.has(id) && !missing.has(id)) {
      missing.set(id, owners[index]!);
      tracks[owners[index]!]!.end = commits.length;
    }
  });
  commits.forEach((commit, index) => commit.parents.forEach(id => {
    const target = tracks[parentOwner(id)]!;
    target.start = Math.min(target.start, index + 1);
  }));
  const occupied: Track[][] = [];
  const allocating = new Set<number>();
  const allocate = (owner: number): number => {
    const track = tracks[owner]!;
    if (track.lane !== -1) return track.lane;
    if (allocating.has(owner)) return 0;
    allocating.add(owner);
    const oldest = track.nodes.at(-1);
    const parent = oldest === undefined ? undefined : commits[oldest]!.parents[0];
    const parentTrack = parent === undefined ? undefined : parentOwner(parent);
    const minimum = parentTrack !== undefined && parentTrack !== owner ? allocate(parentTrack) + 1 : 0;
    const pinned = reusable ? track.nodes.map(index => previous.rows[index]?.lane).find(lane => lane !== undefined) : undefined;
    const available = (lane: number) => !(occupied[lane] ?? []).some(other => track.start <= other.end && other.start <= track.end);
    let lane = pinned !== undefined && pinned >= minimum && available(pinned) ? pinned : minimum;
    while (!available(lane)) lane++;
    track.lane = lane;
    (occupied[lane] ??= []).push(track);
    allocating.delete(owner);
    return lane;
  };
  tracks.map((_, index) => index).sort((a, b) => tracks[a]!.priority - tracks[b]!.priority || tracks[a]!.start - tracks[b]!.start).forEach(allocate);
  const rows: GraphRow[] = commits.map((commit, index) => ({
    id: commit.id, lane: tracks[owners[index]!]!.lane, root: commit.parents.length === 0,
    above: [], below: [], outgoing: [],
  }));
  const starts: number[][] = commits.map(() => []);
  const stops: number[][] = commits.map(() => []);
  commits.forEach((commit, index) => commit.parents.forEach(id => {
    const end = indexes.get(id) ?? commits.length;
    const lane = tracks[parentOwner(id)]!.lane;
    rows[index]!.outgoing.push({ from: rows[index]!.lane, to: lane });
    if (index + 1 < commits.length) starts[index + 1]!.push(lane);
    if (end < commits.length) stops[end]!.push(lane);
  }));
  const active = new Map<number, number>();
  rows.forEach((row, index) => {
    starts[index]!.forEach(lane => active.set(lane, (active.get(lane) ?? 0) + 1));
    row.above = [...active.keys()];
    stops[index]!.forEach(lane => {
      const count = active.get(lane)! - 1;
      if (count) active.set(lane, count); else active.delete(lane);
    });
    row.below = [...active.keys()];
  });
  return { rows, width: Math.max(1, occupied.length), priorities };
}
