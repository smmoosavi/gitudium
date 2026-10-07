import { afterEach, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { watch, type FSWatcher } from "node:fs";
import { createRequestHandler } from "../src/server/http";
import { GitRepositoryReader } from "../src/repository/git";
import type { RepositoryMonitorOptions } from "../src/repository/monitor";

const directories: string[] = [];
const handlers: ReturnType<typeof createRequestHandler>[] = [];
afterEach(async () => {
  for (const handler of handlers.splice(0)) handler.close();
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]) {
  const child = Bun.spawn(["git", "--no-pager", ...args], {
    cwd, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (status) throw new Error(stderr);
  return stdout.trim();
}

async function fixture() {
  const path = join(process.cwd(), `.monitor-test-${crypto.randomUUID()}`);
  await mkdir(path);
  directories.push(path);
  await git(path, "init", "-b", "main");
  await git(path, "config", "user.name", "Fixture");
  await git(path, "config", "user.email", "fixture@example.test");
  await git(path, "config", "commit.gpgsign", "false");
  await git(path, "commit", "--allow-empty", "-m", "initial");
  return path;
}

function handler(path: string, options: RepositoryMonitorOptions = {}) {
  const value = createRequestHandler(path, undefined, options);
  handlers.push(value);
  return value;
}

async function connect(value: ReturnType<typeof handler>, signal?: AbortSignal) {
  const response = await value(new Request("http://localhost/api/events", { signal }));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const stream = response.body!.getReader();
  const next = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        stream.read(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("SSE timeout")), 3000); }),
      ]);
    } finally { clearTimeout(timer); }
  };
  const event = async () => {
    const result = await next();
    expect(result.done).toBe(false);
    const text = new TextDecoder().decode(result.value);
    expect(text).toStartWith("event: invalidation\n");
    return JSON.parse(text.split("data: ")[1].trim()) as { reason: string; version: number };
  };
  expect(await event()).toEqual({ reason: "connected", version: 0 });
  return { stream, next, event };
}

async function controlledConsumer() {
  const path = await fixture();
  let hint: (() => void) | undefined;
  let closed = 0;
  const factory = ((_path: unknown, _options: unknown, callback: () => void) => {
    hint = callback;
    return { on() { return this; }, close() { closed++; } } as unknown as FSWatcher;
  }) as unknown as typeof watch;
  const value = handler(path, { watch: factory, debounceMs: 1, reconcileMs: 60_000 });
  const slow = await connect(value);
  const observer = await connect(value);
  let version = 0;
  const change = async () => {
    await git(path, "update-ref", `refs/custom/slow-${++version}`, "HEAD");
    hint!();
    // A second consuming stream acknowledges reconciliation, avoiding timing sleeps.
    expect(await observer.event()).toEqual({ reason: "changed", version });
  };
  return { value, slow, observer, change, closed: () => closed };
}

test("slow SSE consumers retain one queued event and expose skipped versions under backpressure", async () => {
  const { slow, observer, change } = await controlledConsumer();
  await change();
  for (let i = 0; i < 8; i++) await change();
  expect(await slow.event()).toEqual({ reason: "changed", version: 1 });
  // Characterize today's loss, not the phase 1 delivery contract: the next
  // read stays pending until another change, then jumps directly to version 10.
  const next = slow.event();
  await change();
  expect(await next).toEqual({ reason: "changed", version: 10 });
  await slow.stream.cancel();
  await observer.stream.cancel();
});

test("cancelling a slow consumer with queued data leaves other consumers live", async () => {
  const { slow, observer, change } = await controlledConsumer();
  await change();
  await change();
  await slow.stream.cancel();
  expect(await slow.next()).toMatchObject({ done: true });
  await change();
  await observer.stream.cancel();
});

test("shutdown with queued SSE data drains the queue and closes resources once", async () => {
  const { value, slow, observer, change, closed } = await controlledConsumer();
  await change();
  await change();
  value.close();
  value.close();
  expect(await slow.event()).toEqual({ reason: "changed", version: 1 });
  expect(await slow.next()).toMatchObject({ done: true });
  expect(await observer.next()).toMatchObject({ done: true });
  expect(closed()).toBe(1);
  expect((await value(new Request("http://localhost/api/events"))).status).toBe(503);
});

test("abort with queued SSE data drains once and detaches the consumer", async () => {
  const { value, observer, change } = await controlledConsumer();
  const abort = new AbortController();
  const connection = await connect(value, abort.signal);
  await change();
  await change();
  abort.abort();
  abort.abort();
  expect(await connection.event()).toEqual({ reason: "changed", version: 1 });
  expect(await connection.next()).toMatchObject({ done: true });
  await change();
  await observer.stream.cancel();
});

for (const watchers of [true, false]) {
  test(`external commits, branch switches, loose/custom/packed ref updates (${watchers ? "watchers" : "polling"})`, async () => {
    const path = await fixture();
    const value = handler(path, { watch: watchers ? watch : false, reconcileMs: 30, debounceMs: 10 });
    const connection = await connect(value);
    await git(path, "commit", "--allow-empty", "-m", "external");
    expect((await connection.event()).reason).toBe("changed");
    await git(path, "checkout", "-b", "other");
    expect((await connection.event()).reason).toBe("changed");
    await git(path, "update-ref", "refs/custom/saved", "HEAD");
    expect((await connection.event()).reason).toBe("changed");
    await git(path, "pack-refs", "--all", "--prune");
    expect((await connection.event()).reason).toBe("changed");
    await git(path, "update-ref", "-d", "refs/custom/saved");
    expect((await connection.event()).reason).toBe("changed");
    await connection.stream.cancel();
  });
}

test("watcher hints coalesce bursts and close all resources", async () => {
  const path = await fixture();
  let hint: (() => void) | undefined;
  let closed = 0;
  const factory = ((_path: unknown, _options: unknown, callback: () => void) => {
    hint = callback;
    return { on() { return this; }, close() { closed++; } } as unknown as FSWatcher;
  }) as unknown as typeof watch;
  const value = handler(path, { watch: factory, debounceMs: 60, reconcileMs: 10_000 });
  const connection = await connect(value);
  await git(path, "update-ref", "refs/custom/burst", "HEAD");
  for (let i = 0; i < 100; i++) hint!();
  expect(await connection.event()).toEqual({ reason: "changed", version: 1 });
  for (let i = 0; i < 100; i++) hint!();
  await Bun.sleep(100);
  value.close();
  expect(await connection.next()).toMatchObject({ done: true });
  expect(closed).toBe(1);
  value.close();
  expect(closed).toBe(1);
  expect((await value(new Request("http://localhost/api/events"))).status).toBe(503);
});

test("SSE abort, stream cancellation, reconnect, and shutdown", async () => {
  const path = await fixture();
  const value = handler(path, { watch: false, reconcileMs: 30 });
  const abort = new AbortController();
  const first = await connect(value, abort.signal);
  const second = await connect(value);
  abort.abort();
  expect(await first.next()).toMatchObject({ done: true });
  await second.stream.cancel();
  const third = await connect(value);
  await git(path, "commit", "--allow-empty", "-m", "after reconnect");
  expect((await third.event()).reason).toBe("changed");
  value.close();
  expect(await third.next()).toMatchObject({ done: true });
});

test("discovery is lazy and failed discovery does not poison later attempts", async () => {
  const path = join(process.cwd(), `.monitor-test-${crypto.randomUUID()}`);
  await mkdir(path);
  directories.push(path);
  // Prevent discovery from finding the source checkout's parent repository.
  await writeFile(join(path, ".git"), "gitdir: missing-repository\n");
  const value = handler(path, { watch: false });
  expect((await value(new Request("http://localhost/missing"))).status).toBe(404);
  expect((await value(new Request("http://localhost/api/events", { method: "POST" }))).status).toBe(405);
  expect((await value(new Request("http://localhost/api/events"))).status).toBe(503);
  await rm(join(path, ".git"));
  await git(path, "init", "-b", "main");
  const connection = await connect(value);
  await connection.stream.cancel();
});

test("linked worktrees watch both resolved directories; unsupported watchers fall back", async () => {
  const path = await fixture();
  const linked = join(path, "linked");
  await git(path, "worktree", "add", "--detach", linked, "HEAD");
  const metadata = await (await GitRepositoryReader.discover(linked)).metadata();
  const watched: string[] = [];
  const factory = ((directory: string) => { watched.push(directory); throw new Error("unsupported"); }) as unknown as typeof watch;
  const value = handler(linked, { watch: factory, reconcileMs: 30 });
  const connection = await connect(value);
  expect(watched.sort()).toEqual([metadata.gitDirectory, metadata.commonDirectory].sort());
  await git(path, "update-ref", "refs/custom/shared", "HEAD");
  expect((await connection.event()).reason).toBe("changed");
  await git(linked, "checkout", "-b", "linked-branch");
  expect((await connection.event()).reason).toBe("changed");
  await connection.stream.cancel();
});
