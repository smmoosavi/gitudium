export interface HistoryOrderNode {
  readonly id: string;
  readonly parents: readonly string[];
  readonly references: readonly string[];
  readonly committerTimestamp: number;
}

export interface HistoryOrderContext {
  readonly source: readonly HistoryOrderNode[];
  readonly head: string | null;
}

export type OrderedHistoryIds = readonly string[];
export type HistoryOrderStrategy = (context: HistoryOrderContext) => OrderedHistoryIds;
