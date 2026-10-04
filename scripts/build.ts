import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import type { EmbeddedAssets } from "../src/server/assets";

const root = join(import.meta.dir, "..");
const temporary = await mkdtemp(join(root, ".gitudium-build-"));

try {
  const frontend = Bun.spawn(["pnpm", "exec", "vite", "build"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (await frontend.exited !== 0) throw new Error("Frontend build failed");

  const assets: EmbeddedAssets = {};
  const directory = join(root, "dist");
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const file = Bun.file(path);
    const key = "/" + relative(directory, path).split("\\").join("/");
    assets[key] = {
      body: Buffer.from(await file.arrayBuffer()).toString("base64"),
      contentType: file.type || "application/octet-stream",
    };
  }
  if (!assets["/index.html"]) throw new Error("Frontend index.html is missing");

  const entrypoint = join(temporary, "entry.ts");
  await Bun.write(entrypoint, `
import { createRequestHandler } from "../src/server/http";
import { serveAsset } from "../src/server/assets";
import { createAccessGuard, protectResponse } from "../src/server/access";
import { readLaunchOptions } from "../src/server/cli";
const options = readLaunchOptions();
const handleRequest = createRequestHandler(options.directory);
const access = createAccessGuard();
const assets = ${JSON.stringify(assets)};
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: options.port,
  idleTimeout: 0,
  async fetch(request, server) {
    const rejected = access.protect(request, server.url.origin);
    if (rejected) return protectResponse(rejected, request);
    const pathname = new URL(request.url).pathname;
    const response = pathname === "/api" || pathname.startsWith("/api/")
      ? await handleRequest(request)
      : serveAsset(request, assets);
    return protectResponse(response, request);
  },
});
console.log("Gitudium: " + server.url + "#token=" + access.token);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    handleRequest.close();
    server.stop(true);
    process.exit(0);
  });
}
`);
  const result = await Bun.build({
    entrypoints: [entrypoint],
    target: "bun",
    minify: true,
    packages: "bundle",
  });
  if (!result.success) throw new AggregateError(result.logs, "Server bundle failed");
  if (result.outputs.length !== 1) throw new Error("Expected one JavaScript bundle");
  const artifact = join(root, "gitudium");
  await Bun.write(artifact, "#!/usr/bin/env bun\n" + await result.outputs[0]!.text());
  await chmod(artifact, 0o755);
  console.log(`Built gitudium (${Bun.file(artifact).size.toLocaleString()} bytes). Runtime: Bun and Git; no package installation.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
