import type { CommitSummary } from "../repository/types";
import type { CommitGraph, GraphConnection } from "./graph";
import type { GraphTopology, Track } from "./graphTopology";

export interface RoutedConnection extends GraphConnection {
  start: number;
  end: number;
  join: number;
  from: number;
  lane: number;
  target: number;
}
export interface RoutedGraph { connections: RoutedConnection[]; lanes: number[]; width: number }

// Track nodes are ordered by row. Avoid scanning an entire long spine for
// every connection when finding the last dot before its intended endpoint.
function lastNodeBefore(nodes: number[], end: number): number | undefined {
  let low = 0;
  let high = nodes.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (nodes[middle]! < end) low = middle + 1;
    else high = middle;
  }
  return nodes[low - 1];
}

export function allocateRoutes(commits: CommitSummary[], topology: GraphTopology, previous?: CommitGraph): RoutedGraph {
  const { indexes, priorities, reusable, owners } = topology;
  const tracks: Track[] = topology.tracks.map(track => ({ ...track }));
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
    }
  });
  // Join the parent lane immediately unless intervening nodes would become
  // false junctions. In that case, join just after the last such node.
  const connections = commits.flatMap((commit, index) => commit.parents.map((parentId, parentIndex) => {
    const targetOwner = parentOwner(parentId);
    const end = indexes.get(parentId) ?? commits.length;
    const obstacle = lastNodeBefore(tracks[targetOwner]!.nodes, end);
    const join = parentIndex === 0 && owners[index] === targetOwner ? index : Math.max(index, obstacle ?? index);
    let routeOwner = owners[index]!;
    if (join > index && parentIndex > 0) {
      routeOwner = tracks.length;
      tracks.push({ nodes: [], priority: priorities[index]!, start: index, end: join, lane: -1, minimumOwner: targetOwner });
    }
    return { childId: commit.id, parentId, parentIndex, start: index, end,
      open: !indexes.has(parentId), join, routeOwner, targetOwner };
  }));
  // Node lifetimes and passing-route reservations have distinct contracts.
  // A delayed route reserves its side lane only through its bend row.
  const reservations = tracks.map(track => track.nodes.length ? [{ start: track.start, end: track.end }] : []);
  for (const connection of connections) {
    if (connection.join > connection.start) reservations[connection.routeOwner]!.push({ start: connection.start, end: connection.join });
    reservations[connection.targetOwner]!.push({ start: connection.join + 1, end: connection.end });
  }
  const occupied: number[][] = [];
  const allocating = new Set<number>();
  const allocate = (owner: number): number => {
    const track = tracks[owner]!;
    if (track.lane !== -1) return track.lane;
    if (allocating.has(owner)) return 0;
    allocating.add(owner);
    const oldest = track.nodes.at(-1);
    const parent = oldest === undefined ? undefined : commits[oldest]!.parents[0];
    const parentTrack = track.minimumOwner ?? (parent === undefined ? undefined : parentOwner(parent));
    const minimum = parentTrack !== undefined && parentTrack !== owner ? allocate(parentTrack) + 1 : 0;
    const pinned = reusable ? track.nodes.map(index => previous?.rows[index]?.lane).find(lane => lane !== undefined) : undefined;
    const available = (lane: number) => !(occupied[lane] ?? []).some(other =>
      reservations[owner]!.some(span => reservations[other]!.some(otherSpan => span.start <= otherSpan.end && otherSpan.start <= span.end)));
    let lane = pinned !== undefined && pinned >= minimum && available(pinned) ? pinned : minimum;
    while (!available(lane)) lane++;
    track.lane = lane;
    (occupied[lane] ??= []).push(owner);
    allocating.delete(owner);
    return lane;
  };
  tracks.map((_, index) => index).sort((a, b) => tracks[a]!.priority - tracks[b]!.priority || tracks[a]!.start - tracks[b]!.start).forEach(allocate);
  return { connections: connections.map(connection => ({ ...connection,
    from: tracks[owners[connection.start]!]!.lane,
    lane: tracks[connection.routeOwner]!.lane,
    target: tracks[connection.targetOwner]!.lane,
  })), lanes: owners.map(owner => tracks[owner]!.lane), width: Math.max(1, occupied.length) };
}
