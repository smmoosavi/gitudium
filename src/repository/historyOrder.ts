import type { HistoryOrderContext, HistoryOrderStrategy, OrderedHistoryIds } from "./historyOrdering";
import { structuralHistoryOrder } from "./structuralHistoryOrder";

export const historyOrderStrategies = {
  structural: structuralHistoryOrder,
} satisfies Record<string, HistoryOrderStrategy>;

export type HistoryOrderMode = keyof typeof historyOrderStrategies;

export function orderHistory(context: HistoryOrderContext, mode: HistoryOrderMode = "structural"): OrderedHistoryIds {
  return historyOrderStrategies[mode](context);
}
