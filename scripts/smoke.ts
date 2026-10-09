import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { join, parse } from "node:path";
import { strict as assert } from "node:assert";

const directory = await mkdtemp(join(import.meta.dir, "..", ".gitudium-smoke-"));
const launchDirectory = parse(directory).root;
let child: ReturnType<typeof Bun.spawn> | undefined;
try {
  const git = async (...args: string[]) => {
    const process = Bun.spawn(["git", "--no-pager", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe", env: { PATH: globalThis.process.env.PATH, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
    const [output, error, status] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
    assert.equal(status, 0, error);
    return output.trim();
  };
  await git("init", "-b", "main");
  await Bun.write(join(directory, "fixture.txt"), "Artifact repository fixture\n");
  await git("add", "fixture.txt");
  await git("-c", "user.name=Artifact Fixture", "-c", "user.email=artifact@example.test", "-c", "commit.gpgsign=false", "commit", "-m", "Artifact fixture");
  const commitId = await git("rev-parse", "HEAD");
  const artifact = join(directory, "gitudium");
  await copyFile(join(import.meta.dir, "..", "gitudium"), artifact);
  for (const [args, expectedStatus, pattern] of [
    [["--help"], 0, /Usage: gitudium/],
    [["--version"], 0, /^\d+\.\d+\.\d+/],
    [["--port", "invalid"], 1, /Port must be an integer/],
    [["--unknown"], 1, /usage/],
    [["--directory", join(directory, "missing")], 1, /usage/],
    [["--directory", join(directory, "fixture.txt")], 1, /not a directory/],
  ] as const) {
    const check = Bun.spawn([artifact, ...args], { cwd: launchDirectory, env: { PATH: process.env.PATH }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(check.stdout).text(), new Response(check.stderr).text(), check.exited]);
    assert.equal(status, expectedStatus, stdout + stderr);
    assert.match(stdout + stderr, pattern);
  }
  child = Bun.spawn([artifact, "--port", "0", "--directory", directory], {
    cwd: launchDirectory,
    env: { PATH: process.env.PATH, GITUDIUM_PORT: "invalid", GITUDIUM_DIRECTORY: join(directory, "missing") },
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
        const match = output.match(/Gitudium: (http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]{64})/);
        if (match) return match[1]!;
      }
    })(),
    Bun.sleep(10_000).then(() => { throw new Error("Artifact startup timed out"); }),
  ]);
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token")!;
  const authorization = { Authorization: `Bearer ${token}` };
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
  for (const route of ["/api/trpc/metadata", "/api/trpc/health", "/api/events"]) {
    assert.equal((await fetch(new URL(route, url))).status, 401);
    assert.equal((await fetch(new URL(route, url), { headers: { Authorization: "Bearer wrong" } })).status, 401);
    assert.equal((await fetch(new URL(route, url), { headers: { ...authorization, Origin: "https://unrelated.example" } })).status, 403);
    assert.equal((await fetch(new URL(route, url), { headers: { ...authorization, Host: "rebound.example" } })).status, 403);
  }
  assert.equal(index.headers.get("referrer-policy"), "no-referrer");
  const api = await fetch(new URL('/api/trpc/health?input=' + encodeURIComponent(JSON.stringify({ name: "Artifact" })), url), { headers: authorization });
  assert.equal(api.status, 200);
  const result = await api.json();
  assert.equal(result.result.data.status, "ok");
  assert.match(result.result.data.message, /Artifact/);
  async function query(name: string, input?: unknown) {
    const response = await fetch(new URL(`/api/trpc/${name}${input === undefined ? "" : "?input=" + encodeURIComponent(JSON.stringify(input))}`, url), { headers: authorization });
    assert.equal(response.status, 200, name);
    return (await response.json()).result.data;
  }
  assert.equal((await query("metadata")).head, commitId);
  assert.equal((await query("references"))[0].name, "refs/heads/main");
  assert.equal((await query("history", { limit: 1 })).commits[0].id, commitId);
  assert.equal((await query("commit", { revision: commitId })).files[0].path, "fixture.txt");
  const diff = await query("diff", { revision: commitId, path: "fixture.txt" });
  assert.equal(diff.state, "text");
  assert.match(diff.patch, /\+Artifact repository fixture/);
  const eventsAbort = new AbortController();
  const eventsResponse = await fetch(new URL("/api/events", url), { signal: eventsAbort.signal, headers: authorization });
  assert.equal(eventsResponse.status, 200);
  assert.match(eventsResponse.headers.get("content-type") ?? "", /text\/event-stream/);
  const eventsReader = eventsResponse.body!.getReader();
  let eventsBuffer = "";
  async function invalidation() {
    await Promise.race([
      (async () => {
        while (!eventsBuffer.includes("event: invalidation")) {
          const chunk = await eventsReader.read();
          assert(!chunk.done, "SSE closed before invalidation");
          eventsBuffer += new TextDecoder().decode(chunk.value);
        }
        eventsBuffer = "";
      })(),
      Bun.sleep(10_000).then(() => { throw new Error("Live invalidation timed out"); }),
    ]);
  }
  await invalidation();
  await Bun.write(join(directory, "fixture.txt"), "Artifact live fixture\n");
  await git("add", "fixture.txt");
  await git("-c", "user.name=Artifact Fixture", "-c", "user.email=artifact@example.test", "-c", "commit.gpgsign=false", "commit", "-m", "Live fixture");
  await invalidation();
  assert.equal((await query("history", { limit: 1 })).commits[0].subject, "Live fixture");
  eventsAbort.abort();
  await eventsReader.cancel().catch(() => {});
  assert.equal((await fetch(new URL("/missing", url))).status, 404);
  child.kill("SIGTERM");
  const exit = await Promise.race([
    child.exited,
    Bun.sleep(5_000).then(() => { throw new Error("Artifact shutdown timed out"); }),
  ]);
  assert.equal(exit, 0);
  console.log(`Artifact smoke passed: isolated startup, ${assets.length} assets, repository API and diff, live SSE invalidation, 404, and SIGTERM shutdown.`);
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGKILL");
    await child.exited;
  }
  await rm(directory, { recursive: true, force: true });
}
