import { expect } from "bun:test";
import { layoutCommitGraph, type CommitGraph } from "../../src/client/graph";
import type { CommitSummary } from "../../src/repository/types";

// Follow each declared relationship independently, even when routes share space.
export function checkTopology(commits: CommitSummary[], previous?: CommitGraph, head: string | null = null) {
  const graph = layoutCommitGraph(commits, head, previous);
  for (const row of graph.rows) {
    for (const segment of row.segments) {
      expect(segment.from).toBeGreaterThanOrEqual(0);
      expect(segment.to).toBeLessThan(graph.width);
      const child = commits.find(commit => commit.id === segment.connection.childId)!;
      expect(child.parents[segment.connection.parentIndex]).toBe(segment.connection.parentId);
    }
  }
  commits.forEach((child, start) => child.parents.forEach((parent, position) => {
    const endIndex = commits.findIndex(commit => commit.id === parent);
    const end = endIndex < 0 ? commits.length : endIndex;
    const segments = (index: number) => graph.rows[index]!.segments.filter(segment =>
      segment.connection.childId === child.id && segment.connection.parentIndex === position);
    expect(graph.rows.flatMap(row => row.segments).filter(segment =>
      segment.connection.childId === child.id && segment.connection.parentIndex === position))
      .toHaveLength(2 * (end - start) - (endIndex < 0 ? 1 : 0));
    const first = segments(start);
    expect(first).toHaveLength(1);
    expect(first[0]!.connection).toMatchObject({ childId: child.id, parentId: parent, parentIndex: position, open: endIndex < 0 });
    expect(first[0]!.from).toBe(graph.rows[start]!.lane);
    let lane = first[0]!.to;
    for (let index = start + 1; index < end; index++) {
      const parts = segments(index);
      expect(parts).toHaveLength(2);
      const above = parts.find(segment => segment.part === "above")!;
      const below = parts.find(segment => segment.part !== "above")!;
      expect(above.from).toBe(lane);
      expect(above.to).toBe(lane);
      expect(graph.rows[index]!.lane).not.toBe(lane);
      expect(below.from).toBe(lane);
      lane = below.to;
    }
    if (endIndex >= 0) {
      expect(segments(end)).toHaveLength(1);
      expect(segments(end)[0]!.from).toBe(lane);
      expect(lane).toBe(graph.rows[end]!.lane);
    } else expect(graph.rows.at(-1)!.root && graph.rows.at(-1)!.lane === lane).toBe(false);
  }));
  return graph;
}

