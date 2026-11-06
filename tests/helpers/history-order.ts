import { expect, test } from "bun:test";
import type { HistoryOrderContext, HistoryOrderStrategy } from "../../src/repository/historyOrdering";

export function testHistoryOrderContract(name: string, strategy: HistoryOrderStrategy) {
  test(`${name}: complete unique deterministic IDs, loaded-parent ordering, and immutable input`, () => {
    const contexts: HistoryOrderContext[] = [
      { source: [], head: null },
      {
        source: [
          { id: "merge", parents: ["main", "side", "missing"], references: ["refs/heads/main"], committerTimestamp: 1 },
          { id: "other", parents: ["side"], references: ["refs/heads/development"], committerTimestamp: 10 },
          { id: "main", parents: ["base"], references: [], committerTimestamp: 100 },
          { id: "side", parents: ["base"], references: [], committerTimestamp: 1000 },
          { id: "base", parents: [], references: [], committerTimestamp: 10000 },
          { id: "disconnected", parents: ["unloaded"], references: [], committerTimestamp: 10 },
        ],
        head: "other",
      },
    ];
    for (const context of contexts) {
      for (const node of context.source) {
        Object.freeze(node.parents);
        Object.freeze(node.references);
        Object.freeze(node);
      }
      Object.freeze(context.source);
      Object.freeze(context);
      const before = JSON.stringify(context);
      const ids = strategy(context);
      expect(ids.length).toBe(context.source.length);
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort()).toEqual(context.source.map(node => node.id).sort());
      expect(strategy(context)).toEqual(ids);
      const positions = new Map(ids.map((id, index) => [id, index]));
      for (const node of context.source) for (const parent of node.parents) {
        if (positions.has(parent)) expect(positions.get(node.id)!).toBeLessThan(positions.get(parent)!);
      }
      expect(JSON.stringify(context)).toBe(before);
    }
  });
}
