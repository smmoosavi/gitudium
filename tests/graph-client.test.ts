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
    { from: 1, to: 0, color: 0 }, { from: 0, to: 0, color: 0 },
  ]);
});

test("disconnected roots and short histories remain disconnected and reuse free lanes", () => {
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
  expect(graph.rows.map(row => row.column)).toEqual([0, 1, 0, 1]);
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

test("graph renders decorative connectors and distinct root markers", () => {
  const graph = buildCommitGraph([commit("tip", "root"), commit("root")]);
  const tip = renderToStaticMarkup(createElement(CommitGraph, { row: graph.rows[0]!, columns: graph.columns, root: false }));
  const root = renderToStaticMarkup(createElement(CommitGraph, { row: graph.rows[1]!, columns: graph.columns, root: true }));
  expect(tip).toContain('aria-hidden="true"');
  expect(tip).toContain("<path");
  expect(tip).not.toContain("graph-root");
  expect(root).toContain("graph-root");
});
