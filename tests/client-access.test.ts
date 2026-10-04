import { expect, test } from "bun:test";
import { loadAccessToken, connectEvents } from "../src/client/access";

test("fragment token is stored per tab, removed from URL, and restored on reload", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const token = "a".repeat(64);
  let replaced = "";
  expect(loadAccessToken({ hash: `#token=${token}`, pathname: "/", search: "" }, storage, url => { replaced = url; })).toBe(token);
  expect(replaced).toBe("/");
  expect(loadAccessToken({ hash: "", pathname: "/", search: "" }, storage, () => {})).toBe(token);
  expect(loadAccessToken({ hash: "", pathname: "/", search: "" }, { getItem: () => null, setItem: () => {} }, () => {})).toBeNull();
  expect(loadAccessToken({ hash: "#token=invalid", pathname: "/", search: "" }, storage, () => {})).toBeNull();
});

test("blocked storage permits fragment authentication in memory", () => {
  const storage = { getItem: () => { throw new Error("Blocked"); }, setItem: () => { throw new Error("Blocked"); } };
  expect(loadAccessToken({ hash: "#token=" + "b".repeat(64), pathname: "/", search: "" }, storage, () => {})).toBe("b".repeat(64));
  expect(loadAccessToken({ hash: "", pathname: "/", search: "" }, storage, () => {})).toBeNull();
});

test("SSE uses header authentication and handles fragmented invalidations", async () => {
  const original = globalThis.fetch;
  let request: RequestInit | undefined;
  let endpoint = "";
  let invalidations = 0;
  let resolve!: () => void;
  const received = new Promise<void>(done => { resolve = done; });
  globalThis.fetch = (async (input, init) => {
    endpoint = String(input); request = init;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('event: inval'));
      controller.enqueue(new TextEncoder().encode('idation\ndata: {"reason":"connected"}\n\n'));
    } }), { headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
  let close = () => {};
  try {
    close = connectEvents("c".repeat(64), () => { invalidations++; resolve(); }, () => {});
    await received;
    expect(endpoint).toBe("/api/events");
    expect(request?.headers).toEqual({ Authorization: "Bearer " + "c".repeat(64) });
    expect(invalidations).toBe(1);
    close();
    expect(request?.signal?.aborted).toBe(true);
  } finally { close(); globalThis.fetch = original; }
});
