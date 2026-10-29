import { expect, test } from "bun:test";
import { layoutCommitGraph } from "../src/client/graph";
import type { CommitSummary } from "../src/repository/types";

const commit = (id: string, parents: string[] = []): CommitSummary => ({
  id, parents, references: [], shortId: id, subject: id, author: { name: "Test", email: "", date: "" },
});

// Follow each declared relationship independently, even when routes share space.
function checkTopology(commits: CommitSummary[]) {
  const graph = layoutCommitGraph(commits);
  commits.forEach((child, start) => child.parents.forEach((parent, position) => {
    const endIndex = commits.findIndex(commit => commit.id === parent);
    const end = endIndex < 0 ? commits.length : endIndex;
    let lane = graph.rows[start]!.outgoing[position]!.to;
    for (let index = start + 1; index < end; index++) {
      const row = graph.rows[index]!;
      expect(row.above).toContain(lane);
      expect(row.lane).not.toBe(lane);
      const turn = row.outgoing.find(edge => edge.from === lane);
      if (turn) lane = turn.to;
      else expect(row.below).toContain(lane);
    }
    if (endIndex >= 0) {
      expect(graph.rows[end]!.above).toContain(lane);
      expect(lane).toBe(graph.rows[end]!.lane);
    } else expect(graph.rows.at(-1)!.root && graph.rows.at(-1)!.lane === lane).toBe(false);
  }));
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
