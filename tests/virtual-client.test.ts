import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { rowOffsets, visibleRows, revealRow, rowAt } from "../src/client/virtual";
import { CommitList } from "../src/client/CommitList";
import { buildCommitGraph } from "../src/client/graph";
import type { CommitSummary } from "../src/repository/types";
import { focusNavigationTarget } from "../src/client/navigation";

const ids = Array.from({ length: 10_000 }, (_, index) => String(index));
test("10k rows render a bounded window with modest overscan and a pinned focus", () => {
  const offsets = rowOffsets(ids, new Map());
  expect(visibleRows(offsets, 450_000, 600)).toEqual(Array.from({ length: 17 }, (_, index) => 4995 + index));
  expect(visibleRows(offsets, 450_000, 600, 3)).toContain(3);
  expect(visibleRows(offsets, 450_000, 600, 3)).toHaveLength(18);
  expect(visibleRows([0], 0, 600)).toEqual([]);
  expect(visibleRows(offsets, 9999999, 600).at(-1)).toBe(9999);
});

test("measurements account for wrapping, resize invalidation, and offscreen navigation", () => {
  const heights = new Map([["0", 150], ["1", 250]]);
  const offsets = rowOffsets(ids, heights);
  expect(offsets.slice(0, 4)).toEqual([0, 150, 400, 490]);
  expect(rowAt(offsets, 399)).toBe(1);
  expect(revealRow(offsets, 1, 0, 300)).toBe(150);
  expect(revealRow(offsets, 0, 400, 300)).toBe(0);
  const top = revealRow(offsets, 9999, 0, 600);
  expect(visibleRows(offsets, top, 600)).toContain(9999);
  heights.clear();
  expect(rowOffsets(ids, heights).slice(0, 4)).toEqual([0, 90, 180, 270]);
  expect(revealRow(offsets, -1, 100, 600)).toBe(100);
});

test("virtual markup preserves graph, selection, labels, and logical list positions", () => {
  const commits: CommitSummary[] = ids.map((id, index) => ({
    id, shortId: id, parents: index < ids.length - 1 ? [ids[index + 1]!] : [],
    subject: "A wrapped subject", author: { name: "Author", email: "", date: "2026-01-01" },
    references: index === 0 ? ["refs/heads/main"] : [],
  }));
  const html = renderToStaticMarkup(createElement(CommitList, {
    commits, graph: buildCommitGraph(commits), selected: "0", onSelect: () => {}, scroller: { current: null },
  }));
  expect((html.match(/<button /g) ?? []).length).toBe(12);
  expect(html).toContain('aria-setsize="10000"');
  expect(html).toContain('aria-posinset="1"');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('class="ref-label"');
  expect(html).toContain('class="commit-graph"');
  expect(html).toContain('aria-hidden="true" style="height:');
});

test("navigation delegates absolute indices and preserves parent-pane focus", () => {
  const details: unknown[] = [];
  const viewer = { querySelector: () => ({ dispatchEvent: (event: CustomEvent) => details.push(event.detail) }) } as unknown as HTMLElement;
  focusNavigationTarget(viewer, "commits", 9999);
  focusNavigationTarget(viewer, "commits", undefined, false);
  expect(details).toEqual([{ index: 9999, focus: true }, { index: undefined, focus: false }]);
});
