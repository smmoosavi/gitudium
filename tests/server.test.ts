import { afterEach, expect, test } from "bun:test";
import { createServer, type ServerOptions } from "../src/server/server";
import type { EmbeddedAssets } from "../src/server/assets";

const instances: ReturnType<typeof createServer>[] = [];
const development = { origin: "http://127.0.0.1:5173", token: "fixture-token" };
const assets: EmbeddedAssets = {
  "/index.html": { body: Buffer.from("<html>fixture</html>").toString("base64"), contentType: "text/html" },
  "/assets/app.js": { body: Buffer.from("export {};").toString("base64"), contentType: "text/javascript" },
  "/api/shadow": { body: Buffer.from("must not serve").toString("base64"), contentType: "text/plain" },
};
function start(options: Partial<ServerOptions> = {}) {
  const instance = createServer({ directory: process.cwd(), port: 0, ...options });
  instances.push(instance);
  return instance;
}
afterEach(async () => {
  await Promise.all(instances.splice(0).map(instance => instance.close()));
});

test("development serves only API and accepts the explicit browser origin and token", async () => {
  const instance = start({ development });
  expect(instance.server.hostname).toBe("127.0.0.1");
  expect(instance.token).toBe(development.token);
  const headers = { Authorization: `Bearer ${instance.token}`, Origin: development.origin };
  const response = await fetch(new URL('/api/trpc/health?input=' + encodeURIComponent(JSON.stringify({ name: "Fixture" })), instance.server.url), { headers });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  for (const path of ["/", "/assets/app.js", "/missing"]) {
    expect((await fetch(new URL(path, instance.server.url))).status).toBe(404);
  }
});

test("packaged mode serves embedded assets without trusting the development origin", async () => {
  const instance = start({ assets });
  expect(instance.token).toMatch(/^[a-f0-9]{64}$/);
  const index = await fetch(instance.server.url);
  expect(await index.text()).toBe("<html>fixture</html>");
  expect(index.headers.get("cache-control")).toBe("no-cache");
  expect(index.headers.get("referrer-policy")).toBe("no-referrer");
  const head = await fetch(new URL("/assets/app.js", instance.server.url), { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
  expect(head.headers.get("cache-control")).toContain("immutable");
  expect((await fetch(instance.server.url, { method: "POST" })).status).toBe(405);
  expect((await fetch(new URL("/missing", instance.server.url))).status).toBe(404);
  const headers = { Authorization: `Bearer ${instance.token}` };
  expect((await fetch(new URL("/api/shadow", instance.server.url), { headers })).status).toBe(404);
  expect((await fetch(new URL('/api/trpc/health?input=' + encodeURIComponent(JSON.stringify({ name: "Fixture" })), instance.server.url), { headers })).status).toBe(200);
  expect((await fetch(instance.server.url, { headers: { Origin: development.origin } })).status).toBe(403);
});

test("both modes protect API boundaries and reject foreign origins and hosts before routing", async () => {
  for (const options of [{ development }, { assets }]) {
    const instance = start(options);
    for (const path of ["/api", "/api/trpc/health", "/api/events"]) {
      const url = new URL(path, instance.server.url);
      const denied = await fetch(url);
      expect(denied.status).toBe(401);
      expect(denied.headers.get("cache-control")).toBe("no-store");
      expect((await fetch(url, { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
      expect((await fetch(url, { headers: { Authorization: `Bearer ${instance.token}`, Origin: "https://foreign.example" } })).status).toBe(403);
    }
    expect((await fetch(instance.server.url, { headers: { Host: "foreign.example" } })).status).toBe(403);
  }
});

test("close is idempotent and releases active event streams and the listening port", async () => {
  const instance = start();
  const url = instance.server.url;
  const response = await fetch(new URL("/api/events", url), { headers: { Authorization: `Bearer ${instance.token}` } });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: invalidation");
  const ending = reader.read().catch(() => ({ done: true }));
  const close = instance.close();
  expect(instance.close()).toBe(close);
  await close;
  expect((await ending).done).toBe(true);
  reader.releaseLock();
  const replacement = start({ port: Number(url.port) });
  expect(replacement.server.port).toBe(Number(url.port));
});

test("occupied ports fail startup rather than falling back to another port", () => {
  const instance = start();
  expect(() => createServer({ directory: process.cwd(), port: instance.server.port! })).toThrow();
});
