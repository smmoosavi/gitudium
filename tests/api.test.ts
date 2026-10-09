import { afterAll, expect, test } from "bun:test";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "../src/server/router";
import { createRequestHandler } from "../src/server/http";

const handleRequest = createRequestHandler();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handleRequest });
const api = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: new URL("/api/trpc", server.url).href })],
});

afterAll(async () => {
  handleRequest.close();
  await server.stop(true);
});

test("typed client calls the API over HTTP", async () => {
  expect(await api.health.query({ name: "Gitudium" })).toEqual({
    status: "ok",
    message: "Hello, Gitudium. The local typed API is connected.",
  });
});

test("API rejects invalid input", async () => {
  try {
    await api.health.query({ name: "" });
    throw new Error("Expected input validation failure");
  } catch (error) {
    expect(error).toBeInstanceOf(TRPCClientError);
    expect((error as TRPCClientError<AppRouter>).data?.code).toBe("BAD_REQUEST");
  }
});

test("unknown routes return 404", async () => {
  expect((await fetch(new URL("/missing", server.url))).status).toBe(404);
});
