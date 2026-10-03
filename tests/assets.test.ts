import { expect, test } from "bun:test";
import { serveAsset, type EmbeddedAssets } from "../src/server/assets";

const assets: EmbeddedAssets = {
  "/index.html": { body: Buffer.from("<html>Gitudium</html>").toString("base64"), contentType: "text/html;charset=utf-8" },
  "/assets/test.bin": { body: Buffer.from([0, 128, 255]).toString("base64"), contentType: "application/octet-stream" },
};
const request = (path: string, method = "GET") => new Request(`http://127.0.0.1${path}`, { method });

test("serves the embedded index and binary assets without filesystem access", async () => {
  const index = serveAsset(request("/?query=value"), assets);
  expect(await index.text()).toBe("<html>Gitudium</html>");
  expect(index.headers.get("Content-Type")).toStartWith("text/html");
  expect(index.headers.get("Cache-Control")).toBe("no-cache");
  const binary = serveAsset(request("/assets/test.bin"), assets);
  expect(new Uint8Array(await binary.arrayBuffer())).toEqual(new Uint8Array([0, 128, 255]));
  expect(binary.headers.get("Cache-Control")).toContain("immutable");
});

test("HEAD returns asset headers without a body", async () => {
  const response = serveAsset(request("/", "HEAD"), assets);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toStartWith("text/html");
  expect(await response.text()).toBe("");
});

test("rejects missing assets, inherited keys, and unsupported methods", () => {
  for (const path of ["/missing", "/toString", "/__proto__"]) {
    expect(serveAsset(request(path), assets).status).toBe(404);
  }
  const response = serveAsset(request("/", "POST"), assets);
  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("GET, HEAD");
});
