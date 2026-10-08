import { afterAll, beforeAll, expect, test } from "bun:test";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequestHandler } from "../src/server/http";
import type { AppRouter } from "../src/server/router";
import { HISTORY_CHUNK_SIZE } from "../src/repository/limits";

let directory: string;
let server: ReturnType<typeof Bun.serve>;
let api: ReturnType<typeof createTRPCClient<AppRouter>>;
async function git(...args: string[]) {
  const child = Bun.spawn(["git", "--no-pager", ...args], {
    cwd: directory, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  const [output, error, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (status) throw new Error(error);
  return output.trim();
}

beforeAll(async () => {
  directory = await mkdtemp(join(process.cwd(), ".gitudium-api-"));
  await git("init", "-b", "main");
  await git("config", "user.name", "API Fixture");
  await git("config", "user.email", "api@example.test");
  await git("config", "commit.gpgsign", "false");
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createRequestHandler(directory) });
  api = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: new URL("/api/trpc", server.url).href })] });
});
afterAll(async () => { server?.stop(true); if (directory) await rm(directory, { recursive: true, force: true }); });

test("repository queries navigate empty history, references, pages, details and literal file diffs", async () => {
  expect((await api.metadata.query()).head).toBeNull();
  expect(await api.history.query()).toEqual({ commits: [], nextCursor: null });
  expect(await api.references.query()).toEqual([]);
  const path = ":(exclude) odd\tfile.txt";
  await writeFile(join(directory, path), "first\n");
  await writeFile(join(directory, "binary"), new Uint8Array([0, 1, 2]));
  await writeFile(join(directory, "large"), "x".repeat(1024 * 1024 + 1));
  await git("add", ".");
  await git("commit", "-m", "Root fixture");
  const root = await git("rev-parse", "HEAD");
  await writeFile(join(directory, path), "second\n");
  await git("add", ".");
  await git("commit", "-m", "Second fixture");
  const head = await git("rev-parse", "HEAD");
  expect((await api.metadata.query()).head).toBe(head);
  expect((await api.references.query())[0]?.name).toBe("refs/heads/main");
  const first = await api.history.query({ revision: "refs/heads/main", limit: 1 });
  expect(first.commits.map(commit => commit.id)).toEqual([head]);
  expect(first.nextCursor).not.toBeNull();
  const second = await api.history.query({ limit: 1, cursor: first.nextCursor! });
  expect(second.commits.map(commit => commit.id)).toEqual([root]);
  expect(second.nextCursor).toBeNull();
  const details = await api.commit.query({ revision: head });
  expect(details.files.map(file => file.path)).toEqual([path]);
  expect(details.diffBase).toBe(root);
  expect(await api.diff.query({ revision: head, path })).toMatchObject({ state: "text", patch: expect.stringContaining("+second") });
  expect(await api.diff.query({ revision: root, path: "binary" })).toEqual({ state: "binary" });
  expect(await api.diff.query({ revision: root, path: "large" })).toMatchObject({ state: "oversized" });
  expect(await api.sources.query({ revision: head, path })).toEqual({ state: "text",
    before: { revision: root, path, text: "first\n" }, after: { revision: head, path, text: "second\n" } });
  expect(await api.sources.query({ revision: root, path: "binary" })).toEqual({ state: "binary" });
  expect(await api.sources.query({ revision: root, path: "large" })).toEqual({ state: "oversized", limitBytes: 1024 * 1024 });
  await expect(api.sources.query({ revision: head, path: "binary" })).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
  await expect(api.commit.query({ revision: "missing-revision" })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
});

test("repository API validates limits, revisions, paths and cursors", async () => {
  expect((await api.history.query({ limit: HISTORY_CHUNK_SIZE })).commits).toHaveLength(2);
  for (const limit of [0, HISTORY_CHUNK_SIZE + 1, 1.5]) await expect(api.history.query({ limit })).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
  await expect(api.commit.query({ revision: "--all" })).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
  await expect(api.diff.query({ revision: "HEAD", path: "../outside" })).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
  await expect(api.history.query({ cursor: { snapshot: "--all", offset: -1 } })).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
});

test("history pagination uses short GET URLs even with many distinct reference tips", async () => {
  const tree = await git("rev-parse", "HEAD^{tree}");
  const parent = await git("rev-parse", "HEAD");
  for (let i = 0; i < 100; i++) {
    const id = await git("commit-tree", tree, "-p", parent, "-m", `API tip ${i}`);
    await git("update-ref", `refs/custom/api-${i}`, id);
  }
  const urls: string[] = [];
  const client = createTRPCClient<AppRouter>({ links: [httpBatchLink({
    url: new URL("/api/trpc", server.url).href,
    fetch(url, options) {
      urls.push(String(url));
      return fetch(url, options);
    },
  })] });
  const expected = (await api.history.query({ limit: 200 })).commits.map(commit => commit.id);
  const first = await client.history.query({ limit: 7 });
  const seen = first.commits.map(commit => commit.id);
  let cursor = first.nextCursor;
  while (cursor) {
    const page = await client.history.query({ limit: 7, cursor });
    seen.push(...page.commits.map(commit => commit.id));
    cursor = page.nextCursor;
  }
  expect(seen).toEqual(expected);
  expect(urls.length).toBeGreaterThan(1);
  expect(urls.every(url => url.length < 512)).toBe(true);
  await expect(client.history.query({ cursor: { snapshot: "f".repeat(64), offset: 1 } })).rejects.toMatchObject({ data: { code: "BAD_REQUEST" }, message: expect.stringContaining("expired") });
});

test("discovery failures become clear API errors without breaking health", async () => {
  const outside = await mkdtemp(join(process.cwd(), ".gitudium-outside-"));
  await writeFile(join(outside, ".git"), "gitdir: missing\n");
  const other = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createRequestHandler(outside) });
  try {
    const client = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: new URL("/api/trpc", other.url).href })] });
    await expect(client.metadata.query()).rejects.toMatchObject({ message: "The launch directory is not inside a Git repository.", data: { code: "NOT_FOUND" } });
    expect((await client.health.query({ name: "test" })).status).toBe("ok");
  } finally { other.stop(true); await rm(outside, { recursive: true, force: true }); }
});
