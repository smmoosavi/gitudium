import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRepositoryReader } from "../src/repository/git";
import { localFiles } from "../src/client/localChanges";
import type { LocalScope } from "../src/repository/types";
import { appRouter } from "../src/server/router";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function git(directory: string, ...args: string[]) {
  const child = Bun.spawn(["git", "--literal-pathspecs", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (status) throw new Error(stderr);
  return stdout.trim();
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "gitudium-local-"));
  directories.push(directory);
  await git(directory, "init", "-b", "main");
  await git(directory, "config", "user.name", "Fixture");
  await git(directory, "config", "user.email", "fixture@example.test");
  await git(directory, "config", "commit.gpgsign", "false");
  return directory;
}

test("local scopes compare HEAD, index, and working tree without modifying the index", async () => {
  const directory = await fixture();
  const path = ":(glob) odd\t\n☃.txt";
  await writeFile(join(directory, path), "head\n");
  await writeFile(join(directory, "deleted"), "gone\n");
  await git(directory, "add", "--all");
  await git(directory, "commit", "-m", "base");
  await writeFile(join(directory, path), "staged\n");
  await git(directory, "add", "--", path);
  await writeFile(join(directory, path), "working\n");
  await rm(join(directory, "deleted"));
  await writeFile(join(directory, "new.txt"), "untracked\nlast line");
  await writeFile(join(directory, ".gitignore"), "ignored\n");
  await writeFile(join(directory, "ignored"), "ignored contents");
  const reader = await GitRepositoryReader.discover(directory);
  const index = await readFile(join(directory, ".git/index"));
  const changes = await reader.localChanges();
  expect(changes.available).toBe(true);
  expect(changes.files.find(file => file.path === path)).toMatchObject({ staged: true, unstaged: true, untracked: false, status: "modified" });
  expect(changes.files.some(file => file.path === "ignored")).toBe(false);
  expect(localFiles(changes, "all")).toHaveLength(4);
  expect(localFiles(changes, "staged").map(file => file.path)).toEqual([path]);
  expect(localFiles(changes, "unstaged").map(file => file.path)).toEqual([path, "deleted"]);
  expect(localFiles(changes, "untracked").map(file => file.path)).toEqual([".gitignore", "new.txt"]);
  for (const [scope, before, after] of [["all", "head\n", "working\n"], ["staged", "head\n", "staged\n"], ["unstaged", "staged\n", "working\n"]] as const) {
    expect(await reader.localSources(scope, path)).toMatchObject({ state: "text", before: { text: before }, after: { text: after } });
    const diff = await reader.localDiff(scope, path);
    expect(diff.state).toBe("text");
    if (diff.state === "text") {
      expect(diff.patch).toContain(`-${before.trim()}`);
      expect(diff.patch).toContain(`+${after.trim()}`);
    }
  }
  expect(await reader.localSources("all", "deleted")).toMatchObject({ state: "text", before: { text: "gone\n" }, after: null });
  expect(await reader.localDiff("untracked", "new.txt")).toMatchObject({ state: "text", patch: expect.stringContaining("+last line\n\\ No newline at end of file") });
  expect(await reader.localSources("untracked", "new.txt")).toMatchObject({ state: "text", before: null, after: { text: "untracked\nlast line" } });
  expect(await readFile(join(directory, ".git/index"))).toEqual(index);
  const version = changes.version;
  await writeFile(join(directory, path), "updated again\n");
  expect((await reader.localChanges()).version).not.toBe(version);
  const stagedVersion = (await reader.localChanges()).version;
  await git(directory, "add", "--", path);
  expect((await reader.localChanges()).version).not.toBe(stagedVersion);
});

test("net-cancelled changes remain listed and added-then-deleted files retain their stage statuses", async () => {
  const directory = await fixture();
  await writeFile(join(directory, "file"), "head\n");
  await git(directory, "add", ".");
  await git(directory, "commit", "-m", "base");
  await writeFile(join(directory, "file"), "staged\n");
  await writeFile(join(directory, "added"), "added\n");
  await git(directory, "add", ".");
  await writeFile(join(directory, "file"), "head\n");
  await rm(join(directory, "added"));
  const reader = await GitRepositoryReader.discover(directory);
  const changes = await reader.localChanges();
  expect(changes.files).toHaveLength(2);
  expect(await reader.localDiff("all", "file")).toEqual({ state: "text", patch: "" });
  expect(await reader.localDiff("all", "added")).toEqual({ state: "text", patch: "" });
  expect(localFiles(changes, "staged").find(file => file.path === "added")?.status).toBe("added");
  expect(localFiles(changes, "unstaged").find(file => file.path === "added")?.status).toBe("deleted");
  await git(directory, "rm", "--cached", "--force", "file");
  const removedFromIndex = await reader.localChanges();
  expect(removedFromIndex.files.filter(file => file.path === "file")).toHaveLength(1);
  expect(removedFromIndex.files.find(file => file.path === "file")).toMatchObject({ staged: true, untracked: true });
  expect(await reader.localDiff("staged", "file")).toMatchObject({ state: "text", patch: expect.stringContaining("-head") });
  expect(await reader.localDiff("untracked", "file")).toMatchObject({ state: "text", patch: expect.stringContaining("+head") });
  expect(await reader.localDiff("all", "file")).toEqual({ state: "text", patch: "" });
  expect(await reader.localSources("all", "file")).toMatchObject({ state: "text", before: { text: "head\n" }, after: { text: "head\n" } });
  expect(await reader.localSources("untracked", "file")).toMatchObject({ state: "text", before: null, after: { text: "head\n" } });
});

test("unborn repositories support staged, unstaged, untracked, empty, binary and bounded files", async () => {
  const directory = await fixture();
  const reader = await GitRepositoryReader.discover(directory);
  expect(await reader.localChanges()).toMatchObject({ available: true, head: null, files: [] });
  await writeFile(join(directory, "staged"), "first\n");
  await git(directory, "add", ".");
  await writeFile(join(directory, "staged"), "second\n");
  await writeFile(join(directory, "empty"), "");
  await writeFile(join(directory, "binary"), new Uint8Array([0, 1, 2]));
  await writeFile(join(directory, "large"), "x".repeat(1024 * 1024 + 1));
  expect(await reader.localDiff("staged", "staged")).toMatchObject({ state: "text", patch: expect.stringContaining("+first") });
  expect(await reader.localDiff("unstaged", "staged")).toMatchObject({ state: "text", patch: expect.stringContaining("+second") });
  expect(await reader.localSources("all", "staged")).toMatchObject({ state: "text", before: null, after: { text: "second\n" } });
  expect(await reader.localSources("untracked", "empty")).toMatchObject({ state: "text", after: { text: "" } });
  for (const scope of ["all", "untracked"] as const) {
    expect(await reader.localDiff(scope, "binary")).toEqual({ state: "binary" });
    expect(await reader.localDiff(scope, "large")).toEqual({ state: "oversized", limitBytes: 1024 * 1024 });
  }
});

test("local paths reject traversal, unchanged and out-of-scope files and do not follow symlinks", async () => {
  const directory = await fixture();
  await writeFile(join(directory, "file"), "unchanged\n");
  await git(directory, "add", ".");
  await git(directory, "commit", "-m", "base");
  const reader = await GitRepositoryReader.discover(directory);
  for (const path of ["../outside", "/etc/passwd", "a/../file", "file"]) {
    await expect(reader.localDiff("all", path)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(reader.localSources("all", path)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  }
  await writeFile(join(directory, "new"), "new\n");
  await expect(reader.localSources("staged", "new")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(reader.localSources("invalid" as LocalScope, "new")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await symlink("/etc/passwd", join(directory, "link"));
  expect(await reader.localSources("untracked", "link")).toMatchObject({ state: "text", after: { text: "/etc/passwd" } });
  await expect(reader.localChanges(AbortSignal.abort())).rejects.toMatchObject({ code: "CANCELLED" });
});

test("linked worktrees read their own index and bare repositories expose no local workspace", async () => {
  const directory = await fixture();
  await writeFile(join(directory, "file"), "base\n");
  await git(directory, "add", ".");
  await git(directory, "commit", "-m", "base");
  const linked = join(directory, "linked");
  await git(directory, "worktree", "add", "--detach", linked);
  await writeFile(join(linked, "file"), "linked\n");
  await git(linked, "add", "file");
  await mkdir(join(linked, "nested"));
  const reader = await GitRepositoryReader.discover(join(linked, "nested"));
  expect(await reader.localDiff("staged", "file")).toMatchObject({ state: "text", patch: expect.stringContaining("+linked") });
  const bare = join(directory, "bare.git");
  await git(directory, "clone", "--bare", directory, bare);
  expect(await (await GitRepositoryReader.discover(bare)).localChanges()).toMatchObject({ available: false, files: [] });
});

test("local API exposes files, diff options and sources while validating scopes and paths", async () => {
  const directory = await fixture();
  await writeFile(join(directory, "file"), "first value\n");
  await git(directory, "add", ".");
  await git(directory, "commit", "-m", "base");
  await writeFile(join(directory, "file"), "first   value\n");
  const reader = await GitRepositoryReader.discover(directory);
  const api = appRouter.createCaller({ reader: async () => reader });
  expect((await api.localChanges()).files.map(file => file.path)).toEqual(["file"]);
  expect(await api.localSources({ scope: "all", path: "file" })).toMatchObject({ state: "text", after: { text: "first   value\n" } });
  for (const algorithm of ["myers", "histogram", "patience", "minimal"] as const) {
    expect(await api.localDiff({ scope: "unstaged", path: "file", algorithm })).toMatchObject({ state: "text", patch: expect.stringContaining("+first   value") });
  }
  expect(await api.localDiff({ scope: "all", path: "file", whitespace: "all" })).toEqual({ state: "text", patch: "" });
  await expect(api.localSources({ scope: "all", path: "../outside" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(api.localDiff({ scope: "unknown" as LocalScope, path: "file" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(api.localDiff({ scope: "staged", path: "file" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

test("merge conflicts remain inspectable against HEAD without rendering a combined patch", async () => {
  const directory = await fixture();
  await writeFile(join(directory, "file"), "base\n");
  await git(directory, "add", ".");
  await git(directory, "commit", "-m", "base");
  await git(directory, "checkout", "-b", "side");
  await writeFile(join(directory, "file"), "side\n");
  await git(directory, "commit", "-am", "side");
  await git(directory, "checkout", "main");
  await writeFile(join(directory, "file"), "main\n");
  await git(directory, "commit", "-am", "main");
  await expect(git(directory, "merge", "side")).rejects.toThrow();
  const reader = await GitRepositoryReader.discover(directory);
  expect((await reader.localChanges()).files[0]).toMatchObject({ path: "file", conflicted: true });
  expect(await reader.localDiff("all", "file")).toMatchObject({ state: "text", patch: expect.stringContaining("+<<<<<<< HEAD") });
  expect(await reader.localSources("all", "file")).toMatchObject({ state: "text", before: { text: "main\n" } });
  expect(await reader.localDiff("unstaged", "file")).toEqual({ state: "text", patch: "" });
});
