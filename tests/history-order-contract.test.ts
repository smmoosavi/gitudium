import { expect, test } from "bun:test";
import { historyOrderStrategies, orderHistory } from "../src/repository/historyOrder";
import { testHistoryOrderContract } from "./helpers/history-order";

for (const [name, strategy] of Object.entries(historyOrderStrategies)) {
  testHistoryOrderContract(name, strategy);
}
testHistoryOrderContract("default dispatch", orderHistory);

test("explicit structural selection matches default dispatch", () => {
  const context = { source: [{ id: "tip", parents: ["open"], references: [] }], head: "tip" };
  expect(orderHistory(context, "structural")).toEqual(orderHistory(context));
});
