import { expect, test } from "bun:test";
import { commitRowHeight, graphWidth, graphViewportWidth, graphScrollOffset, visibleGraphLanes } from "../src/client/graphViewport";
import type { GraphRow } from "../src/client/graph";

const row = (lane: number, extra: Partial<GraphRow> = {}): GraphRow => ({
  id: String(lane), lane, root: false, above: [], below: [], outgoing: [], ...extra,
});

test("distant wide history does not reserve graph width", () => {
  const rows = [row(0), row(1), ...Array.from({ length: 3000 }, () => row(0)), row(80)];
  expect(visibleGraphLanes(rows, [0, 1, 2])).toBe(2);
  expect(visibleGraphLanes(rows, [3001, 3002])).toBe(81);
});

test("visible graph width includes passing lines and both edge endpoints", () => {
  expect(visibleGraphLanes([row(0, { above: [7], below: [9], outgoing: [{ from: 12, to: 15 }] })], [0])).toBe(16);
  expect(visibleGraphLanes([row(0, { above: [7] })], [0])).toBe(8);
  expect(visibleGraphLanes([row(0, { below: [9] })], [0])).toBe(10);
  expect(visibleGraphLanes([], [])).toBe(1);
});

test("graph viewport respects content, pane fraction and absolute maximum", () => {
  expect(graphViewportWidth(1, 600)).toBe(graphWidth(1));
  expect(graphViewportWidth(80, 1000)).toBe(180);
  expect(graphViewportWidth(80, 300)).toBe(105);
  expect(graphViewportWidth(80, 0)).toBe(0);
  expect(graphWidth(80)).toBe(1296);
  expect(commitRowHeight).toBe(100);
});

test("shared horizontal scroll clamps after shrinking or resizing", () => {
  expect(graphScrollOffset(600, 1000, 180)).toBe(600);
  expect(graphScrollOffset(900, 1000, 180)).toBe(820);
  expect(graphScrollOffset(600, 64, 64)).toBe(0);
  expect(graphScrollOffset(-20, 1000, 180)).toBe(0);
});
