import { expect, test } from "bun:test";
import { layoutCommitGraph, type CommitGraph } from "../src/client/graph";
import type { CommitSummary } from "../src/repository/types";

const commit = (id: string, parents: string[] = []): CommitSummary => ({
  id, parents, references: [], shortId: id, subject: id, author: { name: "Test", email: "", date: "" },
});

// Follow each declared relationship independently, even when routes share space.
function checkTopology(commits: CommitSummary[], previous?: CommitGraph) {
  const graph = layoutCommitGraph(commits, null, previous);
  for (const row of graph.rows) {
    for (const segment of row.segments) {
      const child = commits.find(commit => commit.id === segment.connection.childId)!;
      expect(child.parents[segment.connection.parentIndex]).toBe(segment.connection.parentId);
    }
  }
  commits.forEach((child, start) => child.parents.forEach((parent, position) => {
    const endIndex = commits.findIndex(commit => commit.id === parent);
    const end = endIndex < 0 ? commits.length : endIndex;
    const segments = (index: number) => graph.rows[index]!.segments.filter(segment =>
      segment.connection.childId === child.id && segment.connection.parentIndex === position);
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

test("relationship paths avoid unrelated dots in the reported history and partial pages", () => {
  const commits = [commit("46324b3", ["83dbdee"]), commit("83dbdee", ["cfc68e0"]),
    commit("cfc68e0", ["e02d6f0"]), commit("5ce8a37", ["e02d6f0"]),
    commit("e02d6f0", ["e2a8b1f"]), commit("e2a8b1f")];
  commits[3]!.references = ["HEAD"];
  for (let length = 1; length <= commits.length; length++) checkTopology(commits.slice(0, length));
});

test("deterministic fork histories preserve topology in alternate topological orders", () => {
  for (let size = 1; size <= 12; size++) {
    const left = Array.from({ length: size }, (_, index) => commit(`l${index}`, [index + 1 < size ? `l${index + 1}` : "root"]));
    const right = Array.from({ length: size }, (_, index) => commit(`r${index}`, [index + 1 < size ? `r${index + 1}` : "root"]));
    for (const branches of [[left, right], [right, left]]) {
      const commits = branches[0]!.flatMap((node, index) => [node, branches[1]![index]!]);
      commits.push(commit("root"), commit("disconnected"));
      for (let length = 1; length <= commits.length; length++) checkTopology(commits.slice(0, length));
    }
  }
});


test("merge routes skip unrelated nodes on both the target and source spines", () => {
  for (const commits of [
    [commit("merge", ["a", "root"]), commit("a", ["root"]), commit("root")],
    [commit("merge", ["a", "b", "root"]), commit("b", ["root"]), commit("a", ["root"]), commit("root")],
    [commit("merge", ["a", "b"]), commit("b1", ["b"]), commit("a", ["ar"]), commit("b"), commit("ar")],
  ]) {
    for (let length = 1; length <= commits.length; length++) checkTopology(commits.slice(0, length));
  }
});

test("small seeded DAGs preserve every merge relationship across pages and orders", () => {
  let seed = 1729;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let sample = 0; sample < 80; sample++) {
    const commits = Array.from({ length: 9 }, (_, index) => {
      const parents = Array.from({ length: 8 - index }, (_, offset) => index + offset + 1)
        .filter(() => random() % 4 === 0).slice(0, 3).map(parent => String(parent));
      return commit(String(index), parents);
    });
    commits[random() % commits.length]!.references = ["refs/heads/main"];
    let previous: CommitGraph | undefined;
    for (let length = 1; length <= commits.length; length++) previous = checkTopology(commits.slice(0, length), previous);
    const remaining = [...commits];
    const reordered: CommitSummary[] = [];
    while (remaining.length) {
      const ready = remaining.filter(node => !remaining.some(other => other.parents.includes(node.id)));
      const next = ready[random() % ready.length]!;
      reordered.push(next);
      remaining.splice(remaining.indexOf(next), 1);
    }
    checkTopology(reordered);
  }
});
