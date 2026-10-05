import type { HistoryPage } from "../repository/types";

export function nextHistoryCursor(page: HistoryPage) {
  return page.nextCursor ?? undefined;
}

export function shouldLoadHistory(scrollTop: number, viewportHeight: number, totalHeight: number) {
  return totalHeight - scrollTop - viewportHeight <= Math.max(600, viewportHeight);
}
