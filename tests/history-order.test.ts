import { checkTopology } from "./helpers/graph";
import { expect, test } from "bun:test";
import type { CommitSummary } from "../src/repository/types";
import { orderHistoryPages } from "../src/client/historyOrder";
import { layoutCommitGraph } from "../src/client/graph";

const commit = (id: string, parents: string[] = [], references: string[] = []): CommitSummary => ({
  id, parents, references, shortId: id, subject: id, author: { name: "Test", email: "", date: "" },
});
const order = (commits: CommitSummary[], head: string | null = null) => orderHistoryPages([{ commits }], head);
const ids = (commits: CommitSummary[]) => commits.map(commit => commit.id);
function expectTopological(commits: CommitSummary[]) {
  const indexes = new Map(commits.map((commit, index) => [commit.id, index]));
  for (const [index, commit] of commits.entries()) for (const parent of commit.parents) {
    if (indexes.has(parent)) expect(index).toBeLessThan(indexes.get(parent)!);
  }
}

const reported = () => [commit("59a73f7", ["7a59bd8"], ["refs/heads/x"]),
  commit("3886481", ["c7c6b5e"], ["refs/heads/refactor/graph-routing-maintenance"]),
  commit("c7c6b5e", ["abca8b9"]), commit("abca8b9", ["b4721c1"]),
  commit("b4721c1", ["7a59bd8"]), commit("7a59bd8", [], ["refs/heads/main"])];

test("the reported independent tip sits below the HEAD chain and above their shared base", () => {
  const source = reported();
  const snapshot = JSON.stringify(source);
  const commits = order(source, "3886481");
  expect(ids(commits)).toEqual(["3886481", "c7c6b5e", "abca8b9", "b4721c1", "59a73f7", "7a59bd8"]);
  expect(JSON.stringify(source)).toBe(snapshot);
  expectTopological(commits);
  const graph = layoutCommitGraph(commits, "3886481");
  expect(graph.rows.map(row => row.lane)).toEqual([0, 0, 0, 0, 1, 0]);
  const side = graph.rows[4]!;
  expect(side.segments.filter(segment => segment.connection.childId === "59a73f7")).toHaveLength(1);
  expect(side.segments.find(segment => segment.connection.childId === "59a73f7"))
    .toMatchObject({ from: 1, to: 0, part: "turn" });
  expect(graph.width).toBe(2);
});

test("main, development, HEAD, and other histories use the same priorities as their lanes", () => {
  const commits = order([commit("f", ["root"]), commit("h", ["h1"]),
    commit("d", ["d1"], ["refs/remotes/upstream/development"]),
    commit("m", ["m1"], ["refs/remotes/origin/main"]), commit("f2", ["root"]),
    commit("h1", ["root"]), commit("d1", ["root"]), commit("m1", ["root"]), commit("root")], "h");
  expect(ids(commits)).toEqual(["m", "m1", "d", "d1", "h", "h1", "f", "f2", "root"]);
  expectTopological(commits);
});

test("merge parents wait for every child, even when a parent has higher priority", () => {
  const commits = order([commit("merge", ["a", "b", "c"]), commit("other", ["b"]),
    commit("a", ["root"], ["refs/heads/main"]), commit("b", ["root"]),
    commit("c", ["root"]), commit("root")], "merge");
  expectTopological(commits);
  expect(ids(commits).indexOf("merge")).toBeLessThan(ids(commits).indexOf("a"));
  expect(ids(commits).indexOf("other")).toBeLessThan(ids(commits).indexOf("b"));
  expect(ids(commits)).toHaveLength(6);
});

test("equal priorities retain source order for disconnected roots, merges, and open parents", () => {
  const commits = [commit("merge", ["a", "missing"]), commit("root"), commit("other", ["a"]), commit("a")];
  expect(order(commits)).toEqual(commits);
  expect(order([])).toEqual([]);
});

test("appended pages preserve displayed order and lanes while propagating HEAD priority across boundaries", () => {
  const source = reported();
  const pages = [{ commits: source.slice(0, 3) }, { commits: source.slice(3, 5) }, { commits: source.slice(5) }];
  let previous = layoutCommitGraph([]);
  let before: CommitSummary[] = [];
  for (let length = 1; length <= pages.length; length++) {
    const commits = orderHistoryPages(pages.slice(0, length), "3886481");
    expect(commits.slice(0, before.length)).toEqual(before);
    expectTopological(commits);
    const graph = layoutCommitGraph(commits, "3886481", previous);
    expect(graph.rows.slice(0, before.length).map(row => row.lane)).toEqual(previous.rows.map(row => row.lane));
    previous = graph;
    before = commits;
  }
  expect(ids(before)).toEqual(["3886481", "c7c6b5e", "59a73f7", "abca8b9", "b4721c1", "7a59bd8"]);
});

test("a refreshed snapshot recomputes order when HEAD changes rather than pinning stale priorities", () => {
  expect(ids(order(reported(), "59a73f7"))[0]).toBe("59a73f7");
  expect(ids(order(reported(), "3886481"))[0]).toBe("3886481");
});

test("seeded merge DAGs remain complete, topological, deterministic, and stable across page appends", () => {
  let seed = 1729;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 8; };
  for (let sample = 0; sample < 100; sample++) {
    const source = Array.from({ length: 30 }, (_, index) => commit(String(index),
      Array.from({ length: 29 - index }, (_, offset) => index + offset + 1)
        .filter(() => random() % 7 === 0).slice(0, 3).map(String)));
    source[random() % source.length]!.references = ["refs/heads/main"];
    source[random() % source.length]!.references = ["refs/heads/dev"];
    const head = String(random() % source.length);
    const pages = Array.from({ length: 3 }, (_, index) => ({ commits: source.slice(index * 10, (index + 1) * 10) }));
    let previous: CommitSummary[] = [];
    let previousGraph = layoutCommitGraph([]);
    for (let count = 1; count <= pages.length; count++) {
      const commits = orderHistoryPages(pages.slice(0, count), head);
      expectTopological(commits);
      previousGraph = checkTopology(commits, previousGraph, head);
      expect(new Set(ids(commits)).size).toBe(count * 10);
      expect(commits.slice(0, previous.length)).toEqual(previous);
      expect(commits).toEqual(orderHistoryPages(pages.slice(0, count), head));
      previous = commits;
    }
  }
});
