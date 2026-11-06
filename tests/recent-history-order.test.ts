import { expect, test } from "bun:test";
import { recentHistoryOrder } from "../src/repository/recentHistoryOrder";
import type { HistoryOrderNode } from "../src/repository/historyOrdering";
import type { CommitSummary } from "../src/repository/types";
import { checkTopology } from "./helpers/graph";
import { layoutCommitGraph } from "../src/client/graph";

const node = (id: string, committerTimestamp: number, parents: string[] = []): HistoryOrderNode => ({ id, parents, references: [], committerTimestamp });

test("recent activity prioritizes ready timestamps despite skew and every merge parent", () => {
  const source = [node("root", 999), node("main", 800, ["root"]), node("side", 900, ["root"]), node("merge", 1, ["main", "side"]), node("other", 10, ["missing"])];
  const before = JSON.stringify(source);
  expect(recentHistoryOrder({ source, head: "main" })).toEqual(["other", "merge", "side", "main", "root"]);
  expect(JSON.stringify(source)).toBe(before);
});

test("ties use source order across disconnected histories and newly ready nodes", () => {
  const source = [node("parent", 1), node("child", 1, ["parent"]), node("other", 1)];
  expect(recentHistoryOrder({ source, head: null })).toEqual(["child", "parent", "other"]);
});

test("100K chains and ready frontiers are iterative", () => {
  for (const chain of [true, false]) {
    const source = Array.from({ length: 100_000 }, (_, index) => node(String(index), index, chain && index ? [String(index - 1)] : []));
    const ordered = recentHistoryOrder({ source, head: null });
    expect(ordered).toHaveLength(source.length);
    expect(ordered[0]).toBe("99999");
    expect(ordered.at(-1)).toBe("0");
  }
});

test("recent merge DAGs retain graph routing and priority lanes across page appends", () => {
  let seed = 1729;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 8; };
  for (let sample = 0; sample < 50; sample++) {
    const source = Array.from({ length: 30 }, (_, index) => ({
      ...node(String(index), random(), Array.from({ length: 29 - index }, (_, offset) => String(index + offset + 1)).filter(() => random() % 7 === 0).slice(0, 3)),
      shortId: String(index), subject: String(index), author: { name: "Test", email: "", date: "" },
      references: index === 20 ? ["refs/heads/main"] : index === 15 ? ["refs/heads/dev"] : [],
    }));
    const byId = new Map(source.map(commit => [commit.id, commit]));
    const ordered: CommitSummary[] = recentHistoryOrder({ source, head: "10" }).map(id => ({ ...byId.get(id)!, parents: [...byId.get(id)!.parents] }));
    let graph = layoutCommitGraph([]);
    for (let count = 10; count <= 30; count += 10) graph = checkTopology(ordered.slice(0, count), graph, "10");
  }
});
