import { expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { sameFileDiffPlaceholder } from "../src/client/diffQuery";

test("whitespace requests keep the visible diff and its context mode until replacement arrives", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const original = { patch: "-old\n+new\n", whitespace: "none" };
  const filtered = { patch: "-old\n+filtered\n", whitespace: "all" };
  client.setQueryData(["diff", "commit", "file", "none"], original);
  const observer = new QueryObserver(client, {
    queryKey: ["diff", "commit", "file", "none"],
    queryFn: async () => original,
    placeholderData: (data, query) => sameFileDiffPlaceholder(data, query, "commit", "file"),
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    let resolve!: (value: typeof filtered) => void;
    const response = new Promise<typeof filtered>(done => { resolve = done; });
    observer.setOptions({
      queryKey: ["diff", "commit", "file", "all"],
      queryFn: () => response,
      placeholderData: (data, query) => sameFileDiffPlaceholder(data, query, "commit", "file"),
    });
    expect(observer.getCurrentResult().isPending).toBe(false);
    expect(observer.getCurrentResult().isPlaceholderData).toBe(true);
    expect(observer.getCurrentResult().data).toEqual(original);
    expect(observer.getCurrentResult().isFetching).toBe(true);
    resolve(filtered);
    await observer.refetch();
    expect(observer.getCurrentResult().data).toEqual(filtered);
    expect(observer.getCurrentResult().isPlaceholderData).toBe(false);
    observer.setOptions({
      queryKey: ["diff", "commit", "file", "none"],
      queryFn: async () => original,
      placeholderData: (data, query) => sameFileDiffPlaceholder(data, query, "commit", "file"),
    });
    expect(observer.getCurrentResult().data).toEqual(original);
    expect(observer.getCurrentResult().isFetching).toBe(false);
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("placeholder data never carries a diff into a different file or commit", () => {
  const previous = { patch: "old file" };
  const query = { queryKey: ["diff", "commit", "file", "none"] };
  expect(sameFileDiffPlaceholder(previous, query, "commit", "file")).toBe(previous);
  expect(sameFileDiffPlaceholder(previous, query, "commit", "other-file")).toBeUndefined();
  expect(sameFileDiffPlaceholder(previous, query, "other-commit", "file")).toBeUndefined();
  expect(sameFileDiffPlaceholder(previous, query, "commit", null)).toBeUndefined();
  expect(sameFileDiffPlaceholder(undefined, undefined, "commit", "file")).toBeUndefined();
});

test("failed whitespace requests expose the error instead of retaining placeholder content", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["diff", "commit", "file", "none"], { patch: "original" });
  const observer = new QueryObserver<{ patch: string }>(client, { queryKey: ["diff", "commit", "file", "none"], enabled: false });
  const unsubscribe = observer.subscribe(() => {});
  try {
    observer.setOptions({
      queryKey: ["diff", "commit", "file", "all"],
      queryFn: async () => { throw new Error("Request failed"); },
      placeholderData: (data, query) => sameFileDiffPlaceholder(data, query, "commit", "file"),
    });
    await observer.refetch();
    expect(observer.getCurrentResult().isError).toBe(true);
    expect(observer.getCurrentResult().error?.message).toBe("Request failed");
  } finally {
    unsubscribe();
    client.clear();
  }
});
