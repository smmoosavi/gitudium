import { expect, test } from "bun:test";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { historyLimit, historyPageSize, historyRequestSize, nextHistoryPage } from "../src/client/history";
import type { CommitSummary, HistoryCursor, HistoryPage } from "../src/repository/types";

const page = (offset: number, count = historyPageSize): HistoryPage => ({
  commits: Array.from({ length: count }, (_, index) => ({ id: String(offset + index) } as CommitSummary)),
  nextCursor: { tips: ["snapshot"], offset: offset + count },
});

test("progressive query keeps its snapshot and stops at 10,000 without evicting early rows", async () => {
  const client = new QueryClient();
  const requests: number[] = [];
  const observer = new InfiniteQueryObserver(client, {
    queryKey: ["history", "test"], initialPageParam: undefined as HistoryCursor | undefined,
    queryFn: async ({ pageParam }) => {
      const offset = pageParam?.offset ?? 0;
      if (pageParam) expect(pageParam.tips).toEqual(["snapshot"]);
      requests.push(offset);
      return page(offset, historyRequestSize(offset));
    },
    getNextPageParam: nextHistoryPage,
    gcTime: 0,
  });
  const unsubscribe = observer.subscribe(() => {});
  await observer.refetch();
  while (observer.getCurrentResult().hasNextPage) await observer.fetchNextPage();
  const result = observer.getCurrentResult();
  expect(result.data!.pages.flatMap(page => page.commits)).toHaveLength(historyLimit);
  expect(result.data!.pages[0]!.commits[0]!.id).toBe("0");
  expect(requests).toHaveLength(50);
  expect(requests.at(-1)).toBe(9800);
  await observer.fetchNextPage();
  expect(requests).toHaveLength(50);
  unsubscribe();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(client.getQueryData(["history", "test"])).toBeUndefined();
  client.clear();
});

test("last page is bounded and exhausted server cursors stop pagination", () => {
  expect(historyRequestSize(9990)).toBe(10);
  expect(historyRequestSize(0)).toBe(200);
  expect(nextHistoryPage({ commits: [], nextCursor: null }, [])).toBeUndefined();
  const last = page(9990, 10);
  expect(nextHistoryPage(last, [page(0, 9990), last])).toBeUndefined();
});
