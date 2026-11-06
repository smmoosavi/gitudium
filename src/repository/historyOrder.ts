import type { HistoryOrderContext, HistoryOrderStrategy, OrderedHistoryIds } from "./historyOrdering";
import { structuralHistoryOrder } from "./structuralHistoryOrder";
import { recentHistoryOrder } from "./recentHistoryOrder";

export const historyOrderStrategies = {
  structural: structuralHistoryOrder,
  recent: recentHistoryOrder,
} satisfies Record<string, HistoryOrderStrategy>;

export type HistoryOrderMode = keyof typeof historyOrderStrategies;

export function isHistoryOrderMode(value: unknown): value is HistoryOrderMode {
  return value === "structural" || value === "recent";
}

export function orderHistory(context: HistoryOrderContext, mode: HistoryOrderMode = "structural"): OrderedHistoryIds {
  return historyOrderStrategies[mode](context);
}
