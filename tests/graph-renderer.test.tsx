import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CommitGraph } from "../src/client/CommitGraph";
import { segmentPath, occupiedLanes } from "../src/client/graphGeometry";
import type { GraphRow } from "../src/client/graph";

test("renderer draws every planned segment, including turns away from the commit dot", () => {
  const connection = { childId: "child", parentId: "parent", parentIndex: 1, open: false };
  const row: GraphRow = { id: "unrelated", lane: 0, root: true,
    segments: [
      { connection, from: 2, to: 2, part: "above" },
      { connection, from: 2, to: 1, part: "turn" },
      { connection, from: 4, to: 4, part: "below" },
    ] };
  const html = renderToStaticMarkup(<CommitGraph row={row} width={occupiedLanes(row)} />);
  expect(html.match(/<path /g)).toHaveLength(3);
  expect(html).toContain('d="M 48 0 V 22"');
  expect(html).toContain('d="M 48 22 C 48 36, 32 36, 32 50 V 10000"');
  expect(html).toContain('d="M 80 22 V 10000"');
  expect(html).toContain('width="96"');
  expect(html.match(/<circle /g)).toHaveLength(2);
  expect(html).toContain('cx="16" cy="22" r="5"');
});

test("straight turns extend to the row boundary without an inferred bend", () => {
  expect(segmentPath({ connection: { childId: "a", parentId: "b", parentIndex: 0, open: true },
    from: 1, to: 1, part: "turn" })).toBe("M 32 22 V 10000");
});
