import { expect, test } from "bun:test";
import { nextHistoryCursor, shouldLoadHistory } from "../src/client/history";
import { HISTORY_CHUNK_SIZE } from "../src/repository/limits";
import type { HistoryPage } from "../src/repository/types";

const cursor = { tips: ["a".repeat(40)], offset: 200 };
const page = (count: number, nextCursor: HistoryPage["nextCursor"] = cursor): HistoryPage => ({
  commits: Array(count).fill({}), nextCursor,
});

test("history loads configured chunks without a total retention cap", () => {
  expect(nextHistoryCursor(page(HISTORY_CHUNK_SIZE))).toEqual(cursor);
  const next = { ...cursor, offset: HISTORY_CHUNK_SIZE * 2 };
  expect(nextHistoryCursor(page(HISTORY_CHUNK_SIZE, next))).toEqual(next);
});

test("history prefetches within one viewport or 600 pixels of the bottom", () => {
  expect(shouldLoadHistory(0, 400, 840_000)).toBe(false);
  expect(shouldLoadHistory(839_000, 400, 840_000)).toBe(true);
  expect(shouldLoadHistory(838_999, 400, 840_000)).toBe(false);
  expect(shouldLoadHistory(0, 400, 200)).toBe(true);
  expect(shouldLoadHistory(8_000, 1_000, 10_000)).toBe(true);
});

test("history stops when Git returns no next cursor", () => {
  const last = page(12, null);
  expect(nextHistoryCursor(last)).toBeUndefined();
});
