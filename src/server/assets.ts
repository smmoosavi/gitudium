export interface EmbeddedAsset {
  body: string;
  contentType: string;
}

export type EmbeddedAssets = Record<string, EmbeddedAsset>;

export function serveAsset(request: Request, assets: EmbeddedAssets): Response {
  const pathname = new URL(request.url).pathname;
  const key = pathname === "/" ? "/index.html" : pathname;
  const asset = Object.hasOwn(assets, key) ? assets[key] : undefined;
  if (!asset) return new Response("Not found", { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }
  return new Response(request.method === "HEAD" ? null : Buffer.from(asset.body, "base64"), {
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
