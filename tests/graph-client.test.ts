import { expect, test } from "bun:test";
import { layoutCommitGraph, referencePriority } from "../src/client/graph";
import type { CommitSummary } from "../src/repository/types";

const commit = (id: string, parents: string[] = [], references: string[] = []): CommitSummary => ({
  id, parents, references, shortId: id, subject: id, author: { name: "Test", email: "", date: "" },
});

test("priority recognizes only supported branch namespaces and HEAD", () => {
  for (const prefix of ["refs/heads/", "refs/remotes/origin/", "refs/remotes/upstream/"]) {
    for (const name of ["main", "trunk", "mainline", "default", "stable", "master"]) expect(referencePriority(prefix + name)).toBe(0);
    for (const name of ["dev", "devel", "develop", "development"]) expect(referencePriority(prefix + name)).toBe(1);
  }
  expect(referencePriority("HEAD")).toBe(2);
  expect(referencePriority("refs/tags/main")).toBe(3);
  expect(referencePriority("refs/remotes/fork/main")).toBe(3);
});

test("main, development, HEAD and features keep straight ordered spines", () => {
  const commits = [commit("f", ["f1"]), commit("h", ["h1"]), commit("d", ["d1"], ["refs/heads/dev"]),
    commit("m", ["m1"], ["refs/heads/main"]), commit("f1", ["r"]), commit("h1", ["r"]),
    commit("d1", ["r"]), commit("m1", ["r"]), commit("r")];
  const graph = layoutCommitGraph(commits, "h");
  expect(graph.rows.map(row => row.lane)).toEqual([3, 2, 1, 0, 3, 2, 1, 0, 0]);
  expect(graph.width).toBe(4);
});

test("references do not bend a linear history, and important tips extend upward", () => {
  const graph = layoutCommitGraph([commit("a", ["b"]), commit("b", ["c"], ["refs/heads/main"]), commit("c")]);
  expect(graph.rows.map(row => row.lane)).toEqual([0, 0, 0]);
  const fork = layoutCommitGraph([commit("a", ["m"]), commit("b", ["m"]), commit("m", [], ["refs/heads/main"])]);
  expect(fork.rows.map(row => row.lane)).toEqual([0, 1, 0]);
});

test("side branches join the parent lane immediately below their oldest unique commit", () => {
  const graph = layoutCommitGraph([commit("f", ["r"]), commit("m", ["m1"], ["refs/heads/main"]), commit("m1", ["r"]), commit("r")]);
  expect(graph.rows.map(row => row.lane)).toEqual([1, 0, 0, 0]);
  expect(graph.rows[0]!.outgoing[0]!.to).toBe(0);
  expect(graph.rows[1]!.above).toEqual([0]);
  expect(graph.rows[2]!.above).toEqual([0]);
});

test("merges connect every parent while preserving the first-parent spine", () => {
  const graph = layoutCommitGraph([commit("m", ["a", "b", "c"], ["refs/heads/main"]), commit("b", ["r"]), commit("c", ["r"]), commit("a", ["r"]), commit("r")]);
  expect(graph.rows[0]!.lane).toBe(graph.rows[3]!.lane);
  expect(graph.rows[0]!.outgoing.map(edge => edge.to)).toEqual([0, 1, 2]);
  expect(graph.rows[1]!.above).toEqual([0, 1, 2]);
});

test("standalone commits and disconnected non-overlapping histories reuse lanes", () => {
  const graph = layoutCommitGraph([commit("a", ["b"]), commit("b"), commit("x"), commit("y", ["z"]), commit("z")]);
  expect(graph.width).toBe(1);
  expect(graph.rows.map(row => row.root)).toEqual([false, true, true, false, true]);
  expect(graph.rows[2]!.above).toEqual([]);
  expect(graph.rows[2]!.outgoing).toEqual([]);
});

test("overlapping disconnected histories do not cross", () => {
  const graph = layoutCommitGraph([commit("a", ["ar"], ["refs/heads/main"]), commit("b", ["br"]), commit("ar"), commit("br")]);
  expect(graph.rows.map(row => row.lane)).toEqual([0, 1, 0, 1]);
});

test("many sequential side branches reuse one column", () => {
  const commits: CommitSummary[] = [];
  for (let index = 0; index < 100; index++) {
    commits.push(commit(`f${index}`, [`m${index + 1}`]));
    commits.push(commit(`m${index}`, [`m${index + 1}`], index === 0 ? ["refs/heads/main"] : []));
  }
  commits.push(commit("m100"));
  const graph = layoutCommitGraph(commits);
  expect(graph.width).toBe(2);
  expect(graph.rows.filter(row => row.id.startsWith("m")).every(row => row.lane === 0)).toBe(true);
});

test("a newly loaded priority spine can shift lanes when the original page has no branch evidence", () => {
  const commits = [commit("f", ["r"]), commit("m", ["r"], ["refs/heads/main"]), commit("r")];
  const before = layoutCommitGraph(commits.slice(0, 1));
  const after = layoutCommitGraph(commits, null, before);
  expect(after.rows.map(row => row.lane)).toEqual([1, 0, 0]);
});

test("page boundaries stay open and appending history preserves existing lanes", () => {
  const commits = [commit("f", ["r"]), commit("m", ["a"], ["refs/heads/main"]), commit("a", ["r"]), commit("r")];
  for (let count = 2; count < commits.length; count++) {
    const before = layoutCommitGraph(commits.slice(0, count));
    const after = layoutCommitGraph(commits, null, before);
    expect(after.rows.slice(0, count).map(row => row.lane)).toEqual(before.rows.map(row => row.lane));
    expect(before.rows[0]!.root).toBe(false);
  }
});
