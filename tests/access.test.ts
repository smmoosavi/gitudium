import { expect, test } from "bun:test";
import { createAccessGuard, protectResponse } from "../src/server/access";

const serverOrigin = "http://127.0.0.1:3000";
const token = "test-access-secret";
const guard = createAccessGuard(token);
function request(path = "/api/health", headers: HeadersInit = {}, method = "GET", origin = serverOrigin) {
  const merged = new Headers(headers);
  if (!merged.has("Host")) merged.set("Host", "127.0.0.1:3000");
  return new Request(`${origin}${path}`, { method, headers: merged });
}

test("generates independent 256-bit hexadecimal tokens and exposes explicit tokens", () => {
  const first = createAccessGuard();
  expect(first.token).toMatch(/^[a-f0-9]{64}$/);
  expect(createAccessGuard().token).not.toBe(first.token);
  expect(guard.token).toBe(token);
});

test("requires authentication on all API paths and methods, including health and SSE", () => {
  for (const path of ["/api", "/api/", "/api/health", "/api/events", "/api/trpc/status"]) {
    for (const method of ["GET", "POST", "OPTIONS", "HEAD"]) {
      expect(guard.protect(request(path, {}, method), serverOrigin)?.status).toBe(401);
      expect(guard.protect(request(path, { Authorization: `Bearer ${token}` }, method), serverOrigin)).toBeNull();
    }
  }
});

test("rejects incorrect credentials and query tokens without leaking secrets", async () => {
  for (const authorization of [undefined, "", "Basic test", token, `bearer ${token}`, "Bearer wrong", "Bearer x", `Bearer ${token}extra`]) {
    const response = guard.protect(request(`/api/events?token=${token}`, authorization === undefined ? {} : { Authorization: authorization }), serverOrigin)!;
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  }
});

test("protects assets against Host spoofing and URL rebinding before authentication", async () => {
  for (const path of ["/", "/assets/app.js", "/api/health"]) {
    for (const host of ["localhost:3000", "evil.example:3000", "127.0.0.1", "127.0.0.1:3001", "127.0.0.1:3000.evil.example", ""]) {
      const response = guard.protect(request(path, { Host: host }), serverOrigin)!;
      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Forbidden");
    }
    for (const origin of ["http://evil.example:3000", "http://localhost:3000", "http://127.0.0.1:3001", "https://127.0.0.1:3000"]) {
      expect(guard.protect(request(path, {}, "GET", origin), serverOrigin)?.status).toBe(403);
    }
    expect(guard.protect(new Request(`${serverOrigin}${path}`), serverOrigin)?.status).toBe(403);
  }
});

test("rejects invalid server origin configuration", () => {
  for (const origin of ["garbage", "https://127.0.0.1:3000", "http://localhost:3000", "http://0.0.0.0:3000", "http://127.0.0.1", `${serverOrigin}/`, `${serverOrigin}?x=1`, "http://user@127.0.0.1:3000", "http://127.0.0.1:0", "http://127.0.0.1:65536"]) {
    expect(guard.protect(request("/"), origin)?.status).toBe(403);
  }
});

test("rejects external, null, malformed, and non-exact Origin headers on every path", () => {
  for (const path of ["/", "/assets/app.js", "/api/health"]) {
    for (const origin of ["http://evil.example", "null", "garbage", "", `${serverOrigin}/`, `${serverOrigin}/path`, `${serverOrigin}?x=1`, `${serverOrigin}#fragment`, "http://user@127.0.0.1:3000", `${serverOrigin}, http://evil.example`, "http://127.0.0.1:5173"]) {
      expect(guard.protect(request(path, { Origin: origin, Authorization: `Bearer ${token}` }), serverOrigin)?.status).toBe(403);
    }
    expect(guard.protect(request(path, { Origin: serverOrigin, Authorization: `Bearer ${token}` }), serverOrigin)).toBeNull();
  }
});

test("optional exact dev origins do not relax Host, fetch metadata, or authentication", () => {
  const dev = "http://127.0.0.1:5173";
  const devGuard = createAccessGuard(token, [dev, "null", `${dev}/`]);
  for (const origin of [serverOrigin, dev]) {
    expect(devGuard.protect(request("/", { Origin: origin }), serverOrigin)).toBeNull();
    expect(devGuard.protect(request("/api/health", { Origin: origin }), serverOrigin)?.status).toBe(401);
    expect(devGuard.protect(request("/api/health", { Origin: origin, Authorization: `Bearer ${token}` }), serverOrigin)).toBeNull();
  }
  for (const origin of ["null", `${dev}/`, "http://localhost:5173"]) {
    expect(devGuard.protect(request("/", { Origin: origin }), serverOrigin)?.status).toBe(403);
  }
  expect(devGuard.protect(request("/", { Origin: dev, Host: "evil.example" }), serverOrigin)?.status).toBe(403);
  expect(devGuard.protect(request("/", { Origin: dev, "Sec-Fetch-Site": "cross-site" }), serverOrigin)?.status).toBe(403);
});

test("cross-site fetches are rejected even with valid tokens and no Origin", () => {
  for (const path of ["/", "/api/events"]) {
    expect(guard.protect(request(path, { "Sec-Fetch-Site": "cross-site", Authorization: `Bearer ${token}` }), serverOrigin)?.status).toBe(403);
    for (const site of ["none", "same-origin", "same-site"]) {
      expect(guard.protect(request(path, { "Sec-Fetch-Site": site, Authorization: `Bearer ${token}` }), serverOrigin)).toBeNull();
    }
  }
});

test("API prefix matching leaves assets and similar non-API paths unauthenticated", () => {
  for (const path of ["/", "/assets/app.js", "/apiary", "/api.js"]) {
    expect(guard.protect(request(path), serverOrigin)).toBeNull();
  }
});

test("response protection preserves body/status and assets caching, strips CORS, and disables API caching", async () => {
  for (const path of ["/", "/api", "/api/events"]) {
    const original = new Response("content", { status: 202, statusText: "Accepted", headers: {
      "Content-Type": "text/event-stream", "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization",
      "Access-Control-Allow-Credentials": "true", "Referrer-Policy": "unsafe-url",
    } });
    const response = protectResponse(original, request(path));
    expect(response.status).toBe(202);
    expect(response.statusText).toBe("Accepted");
    expect(response.body).not.toBeNull();
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe(path === "/" ? "public, max-age=3600" : "no-store");
    expect([...response.headers.keys()].some(name => name.startsWith("access-control-"))).toBe(false);
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
    expect(await response.text()).toBe("content");
  }
});
