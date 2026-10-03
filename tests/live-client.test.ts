import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { createLiveRefresh } from "../src/client/live";

test("live refresh trims history snapshots without discarding filters or immutable details", async () => {
  const client = new QueryClient();
  const history = { pages: [{ commits: [], nextCursor: { tips: ["tip"], offset: 50 } }, { commits: [], nextCursor: null }], pageParams: [undefined, { tips: ["tip"], offset: 50 }] };
  client.setQueryData(["history", "refs/heads/main"], history);
  client.setQueryData(["history", ""], history);
  client.setQueryData(["metadata"], { branch: "main" });
  client.setQueryData(["references"], []);
  client.setQueryData(["commit", "immutable"], { subject: "Selected commit" });
  client.setQueryData(["diff", "immutable", "file"], { state: "text", patch: "patch" });
  const refresh = createLiveRefresh(client);
  await refresh.refresh();
  for (const revision of ["", "refs/heads/main"]) {
    expect(client.getQueryData<typeof history>(["history", revision])).toEqual({ pages: history.pages.slice(0, 1), pageParams: [undefined] });
    expect(client.getQueryState(["history", revision])?.isInvalidated).toBe(true);
  }
  expect(client.getQueryState(["metadata"])?.isInvalidated).toBe(true);
  expect(client.getQueryState(["references"])?.isInvalidated).toBe(true);
  expect(client.getQueryState(["commit", "immutable"])?.isInvalidated).toBe(false);
  expect(client.getQueryState(["diff", "immutable", "file"])?.isInvalidated).toBe(false);
  refresh.close();
  client.clear();
});

test("event bursts coalesce into one refresh and one reconciliation pass", async () => {
  const client = new QueryClient();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = [];
  client.invalidateQueries = async filters => {
    calls.push(String(filters?.queryKey?.[0]));
    if (calls.length === 1) await blocked;
  };
  const refresh = createLiveRefresh(client);
  const first = refresh.refresh();
  for (let index = 0; index < 100; index++) expect(refresh.refresh()).toBe(first);
  release();
  await first;
  expect(calls).toEqual(["metadata", "references", "history", "metadata", "references", "history"]);
  refresh.close();
  await refresh.refresh();
  expect(calls.length).toBe(6);
  client.clear();
});
