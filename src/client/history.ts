import type { HistoryPage } from "../repository/types";

export const historyLimit = 10_000;
export const historyPageSize = 200;

export function nextHistoryPage(page: HistoryPage, pages: HistoryPage[]) {
  return pages.reduce((count, page) => count + page.commits.length, 0) < historyLimit
    ? page.nextCursor ?? undefined : undefined;
}

export function historyRequestSize(loaded: number) {
  return Math.min(historyPageSize, Math.max(1, historyLimit - loaded));
}
