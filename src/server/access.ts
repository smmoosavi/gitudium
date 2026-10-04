import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const isApi = (pathname: string) => pathname === "/api" || pathname.startsWith("/api/");
const digest = (value: string) => createHash("sha256").update(value).digest();

/** Apply to every response, including assets and access failures. Preserves streaming bodies. */
export function protectResponse(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  for (const name of [...headers.keys()]) {
    if (name.startsWith("access-control-")) headers.delete(name);
  }
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  if (isApi(new URL(request.url).pathname)) headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Call protect before routing any request, including static assets. */
export function createAccessGuard(token = randomBytes(32).toString("hex"), allowedOrigins?: string[]) {
  const tokenDigest = digest(token);
  const origins = new Set(allowedOrigins);
  return {
    token,
    protect(request: Request, serverOrigin: string): Response | null {
      const reject = (status: number) => protectResponse(
        new Response(status === 401 ? "Unauthorized" : "Forbidden", { status }), request,
      );
      let server: URL;
      try {
        server = new URL(serverOrigin);
      } catch {
        return reject(403);
      }
      const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(serverOrigin);
      if (!match || Number(match[1]) > 65535) return reject(403);
      const url = new URL(request.url);
      if (url.origin !== server.origin || request.headers.get("Host") !== server.host) return reject(403);
      const origin = request.headers.get("Origin");
      if (origin !== null) {
        // Origin headers must already be serialized origins, not URLs that normalize to one.
        try {
          const parsed = new URL(origin);
          if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) return reject(403);
        } catch {
          return reject(403);
        }
        if (origin !== server.origin && !origins.has(origin)) return reject(403);
      }
      if (request.headers.get("Sec-Fetch-Site")?.toLowerCase() === "cross-site") return reject(403);
      if (isApi(url.pathname)) {
        const authorization = request.headers.get("Authorization");
        if (!authorization?.startsWith("Bearer ") ||
          !timingSafeEqual(tokenDigest, digest(authorization.slice(7)))) return reject(401);
      }
      return null;
    },
  };
}
