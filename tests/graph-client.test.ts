import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCommitGraph } from "../src/client/graph";
import { CommitGraph } from "../src/client/CommitGraph";

const commit = (id: string, ...parents: string[]) => ({ id, parents });

test("linear rebased history uses one lane and ends at its root", () => {
  const graph = buildCommitGraph([commit("c", "b"), commit("b", "a"), commit("a")]);
  expect(graph.columns).toBe(1);
  expect(graph.rows.map(row => row.column)).toEqual([0, 0, 0]);
  expect(graph.rows[0]!.incoming).toEqual([]);
  expect(graph.rows[1]!.incoming).toEqual([{ from: 0, to: 0, color: 0 }]);
  expect(graph.rows[2]!.outgoing).toEqual([]);
  expect(buildCommitGraph([])).toEqual({ rows: [], columns: 0 });
});

test("branch tips join their shared parent without interrupting its lane", () => {
  const graph = buildCommitGraph([commit("main", "base"), commit("side", "base"), commit("base")]);
  expect(graph.columns).toBe(2);
  expect(graph.rows.map(row => row.column)).toEqual([0, 1, 0]);
  expect(graph.rows[1]!.incoming).toEqual([{ from: 0, to: 0, color: 0 }]);
  expect(graph.rows[1]!.outgoing).toEqual([
    { from: 1, to: 1, color: 1 }, { from: 0, to: 0, color: 0 },
  ]);
  expect(graph.rows[2]!.incoming).toEqual([
    { from: 0, to: 0, color: 0 }, { from: 1, to: 0, color: 1 },
  ]);
});

test("disconnected roots and short histories reuse free lanes without crossing active spines", () => {
  const graph = buildCommitGraph([
    commit("main", "base"), commit("island-tip", "island-root"),
    commit("island-root"), commit("standalone"), commit("base"), commit("other-root"),
  ]);
  expect(graph.columns).toBe(2);
  expect(graph.rows.map(row => row.column)).toEqual([0, 1, 1, 1, 0, 0]);
  expect(graph.rows[2]!.outgoing).toEqual([{ from: 0, to: 0, color: 0 }]);
  expect(graph.rows[3]!.incoming).toEqual([{ from: 0, to: 0, color: 0 }]);
  expect(graph.rows[3]!.outgoing).toEqual([{ from: 0, to: 0, color: 0 }]);
  expect(graph.rows[5]!.incoming).toEqual([]);
  expect(graph.rows[5]!.outgoing).toEqual([]);
});

test("merge histories retain every parent connection", () => {
  const graph = buildCommitGraph([commit("merge", "left", "right"), commit("right", "base"), commit("left", "base"), commit("base")]);
  expect(graph.rows[0]!.outgoing).toEqual([
    { from: 0, to: 0, color: 0 }, { from: 0, to: 1, color: 1 },
  ]);
  expect(graph.rows.map(row => row.column)).toEqual([0, 1, 0, 0]);
  expect(graph.rows.at(-1)!.outgoing).toEqual([]);
});

test("appending a page preserves existing rows and connects pending parents", () => {
  const first = [commit("tip", "middle"), commit("side", "root")];
  const before = buildCommitGraph(first);
  const after = buildCommitGraph([...first, commit("middle", "root"), commit("root")]);
  expect(after.rows.slice(0, first.length)).toEqual(before.rows);
  expect(before.rows.at(-1)!.outgoing.length).toBe(2);
  for (let index = 0; index < after.rows.length - 1; index++) {
    const bottom = [...new Set(after.rows[index]!.outgoing.map(edge => edge.to))].sort();
    const top = after.rows[index + 1]!.incoming.map(edge => edge.from).sort();
    expect(bottom).toEqual(top);
  }
});

test("main, development, HEAD, and features keep ordered straight first-parent spines", () => {
  const commits = [
    commit("feature", "feature-base"), commit("head", "head-base"),
    commit("dev", "dev-base"), commit("main", "main-base"),
    commit("feature-base", "root"), commit("head-base", "root"),
    commit("dev-base", "root"), commit("main-base", "root"), commit("root"),
  ];
  for (const main of ["main", "trunk", "mainline", "default", "stable", "master"]) {
    for (const namespace of ["heads", "remotes/origin", "remotes/upstream"]) {
      for (const dev of ["dev", "devel", "develop", "development"]) {
        const graph = buildCommitGraph(commits, { head: "head", references: [
          { name: "refs/heads/feature", commitId: "feature" },
          { name: `refs/${namespace}/${dev}`, commitId: "dev" },
          { name: `refs/${namespace}/${main}`, commitId: "main" },
        ] });
        expect(graph.rows.map(row => row.column)).toEqual([3, 2, 1, 0, 3, 2, 1, 0, 0]);
        for (let index = 0; index < 8; index++) {
          const row = graph.rows[index]!;
          expect(row.outgoing[0]).toEqual({ from: row.column, to: row.column, color: row.column });
        }
        expect(graph.rows.at(-1)!.incoming).toEqual([
          { from: 0, to: 0, color: 0 }, { from: 1, to: 0, color: 1 },
          { from: 2, to: 0, color: 2 }, { from: 3, to: 0, color: 3 },
        ]);
      }
    }
  }
});

test("commit decorations establish priority and shared tips do not allocate duplicate lanes", () => {
  const graph = buildCommitGraph([
    { ...commit("feature", "base"), references: ["refs/heads/feature"] },
    { ...commit("main", "base"), references: ["refs/heads/main", "refs/remotes/origin/main"] },
    commit("base"),
  ], { head: "main" });
  expect(graph.columns).toBe(2);
  expect(graph.rows.map(row => row.column)).toEqual([1, 0, 0]);
});

test("a main tip below the first page reserves the left lane without shifting feature rows", () => {
  const options = { references: [
    { name: "refs/heads/main", commitId: "main" },
    { name: "refs/heads/feature", commitId: "feature" },
    { name: "refs/heads/unloaded-feature", commitId: "unloaded" },
  ] };
  const page = [commit("feature", "feature-base"), commit("feature-base", "root")];
  const before = buildCommitGraph(page, options);
  const after = buildCommitGraph([...page, commit("main", "root"), commit("root")], options);
  expect(before.rows.map(row => row.column)).toEqual([1, 1]);
  expect(before.columns).toBe(2);
  expect(after.rows.slice(0, page.length)).toEqual(before.rows);
  expect(after.rows.map(row => row.column)).toEqual([1, 1, 0, 0]);
});

test("merge secondary-parent lanes open on the right even when the parent has higher priority", () => {
  const graph = buildCommitGraph([commit("merge", "feature", "main"), commit("feature", "root"), commit("main", "root"), commit("root")], {
    head: "merge", references: [{ name: "refs/heads/main", commitId: "main" }],
  });
  expect(graph.rows.map(row => row.column)).toEqual([1, 1, 0, 0]);
  expect(graph.rows[0]!.outgoing).toEqual([
    { from: 1, to: 1, color: 1 }, { from: 1, to: 2, color: 2 },
  ]);
  expect(graph.rows[2]!.incoming).toContainEqual({ from: 2, to: 0, color: 2 });
});

test("equal-priority ancestor refs continue straight regardless of reference ordering", () => {
  const commits = [commit("web", "api"), commit("api", "base"), commit("base")];
  const refs = [
    { name: "refs/heads/api", commitId: "api" },
    { name: "refs/heads/web", commitId: "web" },
  ];
  for (const references of [refs, [...refs].reverse()]) {
    const graph = buildCommitGraph(commits, { references });
    expect(graph.columns).toBe(1);
    expect(graph.rows.map(row => row.column)).toEqual([0, 0, 0]);
    expect(graph.rows[1]!.incoming).toEqual([{ from: 0, to: 0, color: 0 }]);
  }
});

test("many independent short histories do not permanently widen the graph", () => {
  const commits = Array.from({ length: 30 }, (_, index) => commit(`root-${index}`));
  const graph = buildCommitGraph(commits, { references: commits.map(item => ({ name: `refs/heads/${item.id}`, commitId: item.id })) });
  expect(graph.columns).toBe(1);
  expect(graph.rows.every(row => row.column === 0 && !row.incoming.length && !row.outgoing.length)).toBe(true);
});

test("graph renders decorative connectors and distinct root markers", () => {
  const graph = buildCommitGraph([commit("tip", "root"), commit("root")]);
  const tip = renderToStaticMarkup(createElement(CommitGraph, { row: graph.rows[0]!, columns: graph.columns, root: false }));
  const root = renderToStaticMarkup(createElement(CommitGraph, { row: graph.rows[1]!, columns: graph.columns, root: true }));
  expect(tip).toContain('aria-hidden="true"');
  expect(tip).toContain("<path");
  expect(tip).not.toContain("graph-root");
  expect(root).toContain("graph-root");
});
