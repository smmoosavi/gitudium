import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";

const directory = await mkdtemp(join(tmpdir(), "gitudium-smoke-"));
let child: ReturnType<typeof Bun.spawn> | undefined;
try {
  const artifact = join(directory, "gitudium");
  await copyFile(join(import.meta.dir, "..", "gitudium"), artifact);
  child = Bun.spawn([artifact], {
    cwd: directory,
    env: { PATH: process.env.PATH },
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  let output = "";
  const url = await Promise.race([
    (async () => {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("Artifact exited before startup");
        output += new TextDecoder().decode(chunk.value);
        const match = output.match(/Gitudium: (http:\/\/127\.0\.0\.1:\d+\/)/);
        if (match) return match[1]!;
      }
    })(),
    Bun.sleep(10_000).then(() => { throw new Error("Artifact startup timed out"); }),
  ]);
  const index = await fetch(url);
  assert.equal(index.status, 200);
  assert.match(index.headers.get("content-type") ?? "", /text\/html/);
  const html = await index.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)].map(match => match[1]!);
  assert(assets.length > 0, "Expected built frontend assets");
  for (const asset of assets) {
    const response = await fetch(new URL(asset, url));
    assert.equal(response.status, 200, asset);
    assert((await response.arrayBuffer()).byteLength > 0, asset);
  }
  const api = await fetch(new URL('/api/trpc/health?input=' + encodeURIComponent(JSON.stringify({ name: "Artifact" })), url));
  assert.equal(api.status, 200);
  const result = await api.json();
  assert.equal(result.result.data.status, "ok");
  assert.match(result.result.data.message, /Artifact/);
  assert.equal((await fetch(new URL("/missing", url))).status, 404);
  child.kill("SIGTERM");
  const exit = await Promise.race([
    child.exited,
    Bun.sleep(5_000).then(() => { throw new Error("Artifact shutdown timed out"); }),
  ]);
  assert.equal(exit, 0);
  console.log(`Artifact smoke passed: isolated startup, ${assets.length} assets, API, 404, and SIGTERM shutdown.`);
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGKILL");
    await child.exited;
  }
  await rm(directory, { recursive: true, force: true });
}
