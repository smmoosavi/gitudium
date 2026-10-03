import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { HistoryCursor, HistoryPage } from "../repository/types";

export function createLiveRefresh(client: QueryClient) {
  let running: Promise<void> | undefined;
  let pending = false;
  let closed = false;
  const refresh = () => {
    if (closed) return Promise.resolve();
    pending = true;
    if (running) return running;
    running = (async () => {
      while (pending && !closed) {
        pending = false;
        await client.invalidateQueries({ queryKey: ["metadata"] });
        if (closed) break;
        await client.invalidateQueries({ queryKey: ["references"] });
        if (closed) break;
        await client.cancelQueries({ queryKey: ["history"] });
        client.setQueriesData<InfiniteData<HistoryPage, HistoryCursor | undefined>>({ queryKey: ["history"] }, data => data ? {
          pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1),
        } : undefined);
        await client.invalidateQueries({ queryKey: ["history"] });
      }
    })().finally(() => { running = undefined; });
    return running;
  };
  return { refresh, close: () => { closed = true; pending = false; } };
}
