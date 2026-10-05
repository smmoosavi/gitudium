import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRepositoryReader } from "../src/repository/git";
import { HISTORY_CHUNK_SIZE } from "../src/repository/limits";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function temporary() {
  const path = await mkdtemp(join(tmpdir(), "gitudium-repository-"));
  directories.push(path);
  return path;
}

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
  const path = await temporary();
  await git(path, "init", "-b", "main");
  await git(path, "config", "user.name", "Fixture Author");
  await git(path, "config", "user.email", "fixture@example.test");
  await git(path, "config", "commit.gpgsign", "false");
  return path;
}

async function commit(path: string, name: string, content: string | Uint8Array, subject: string) {
  await writeFile(join(path, name), content);
  await git(path, "add", "--", name);
  await git(path, "commit", "-m", subject);
  return git(path, "rev-parse", "HEAD");
}

test("discovers empty repositories and subdirectories, rejects non-repositories", async () => {
  const path = await fixture();
  await mkdir(join(path, "nested"));
  const reader = await GitRepositoryReader.discover(join(path, "nested"));
  const metadata = await reader.metadata();
  expect(metadata.root).toBe(path);
  expect(metadata.branch).toBe("main");
  expect(metadata.head).toBeNull();
  expect(metadata.commonDirectory).toBe(join(path, ".git"));
  expect(await reader.history()).toEqual({ commits: [], nextCursor: null });
  expect(await reader.references()).toEqual([]);
  await expect(GitRepositoryReader.discover(await temporary())).rejects.toMatchObject({ code: "NOT_A_REPOSITORY" });
});

test("all-ref topological history returns parents and decorations with snapshot pagination", async () => {
  const path = await fixture();
  const root = await commit(path, "root", "root", "root");
  await git(path, "tag", "-a", "v1", "-m", "version");
  await git(path, "checkout", "-b", "side");
  const side = await commit(path, "side", "side", "side");
  await git(path, "checkout", "main");
  const main = await commit(path, "main", "main", "main");
  await git(path, "merge", "--no-ff", "side", "-m", "merge");
  const merge = await git(path, "rev-parse", "HEAD");
  await git(path, "update-ref", "refs/remotes/origin/main", merge);
  const reader = await GitRepositoryReader.discover(path);
  const first = await reader.history({ limit: 1 });
  expect(first.commits[0].id).toBe(merge);
  expect(first.commits[0].parents).toEqual([main, side]);
  expect(first.commits[0].references).toContain("refs/remotes/origin/main");
  await commit(path, "later", "later", "later");
  const remaining = await reader.history({ cursor: first.nextCursor!, limit: 200 });
  expect(remaining.commits.map(item => item.id).sort()).toEqual([root, side, main].sort());
  expect(remaining.nextCursor).toBeNull();
  expect(remaining.commits.find(item => item.id === root)?.references).toContain("refs/tags/v1");
  const details = await reader.commit(merge);
  expect(details.diffBase).toBe(main);
  expect(details.files).toEqual([{ path: "side", previousPath: null, status: "added" }]);
  const diff = await reader.diff(merge);
  expect(diff.state).toBe("text");
  if (diff.state === "text") {
    expect(diff.patch).toContain("+side");
    expect(diff.patch).not.toContain("+main");
  }
  const selected = await reader.history({ revision: "v1" });
  expect(selected.commits.map(item => item.id)).toEqual([root]);
});

test("root commits, unusual literal paths, binary and oversized diffs", async () => {
  const path = await fixture();
  const name = "-odd\tline\n☃.txt";
  const root = await commit(path, name, "hello\n", "subject\n\nbody");
  await mkdir(join(path, "nested"));
  const reader = await GitRepositoryReader.discover(join(path, "nested"));
  const details = await reader.commit(root);
  expect(details.diffBase).toBeNull();
  expect(details.message).toBe("subject\n\nbody\n");
  expect(details.author.email).toBe("fixture@example.test");
  expect(details.files[0].path).toBe(name);
  const diff = await reader.diff(root, name);
  expect(diff.state).toBe("text");
  if (diff.state === "text") expect(diff.patch).toContain("+hello");
  const magic = await commit(path, ":(glob)*.txt", "literal\n", "literal path");
  const literal = await reader.diff(magic, ":(glob)*.txt");
  expect(literal.state).toBe("text");
  if (literal.state === "text") expect(literal.patch).toContain("+literal");
  const binary = await commit(path, "binary", new Uint8Array([0, 1, 2]), "binary");
  expect(await reader.diff(binary, "binary")).toEqual({ state: "binary" });
  const large = await commit(path, "large", "x\n".repeat(600_000), "large");
  expect(await reader.diff(large, "large")).toEqual({ state: "oversized", limitBytes: 1024 * 1024 });
  await git(path, "mv", "--", name, "renamed");
  await git(path, "commit", "-m", "rename");
  const rename = await reader.commit("HEAD");
  expect(rename.files.map(file => file.status).sort()).toEqual(["added", "deleted"]);
});

test("linked worktrees, detached HEAD and bare repositories", async () => {
  const path = await fixture();
  const id = await commit(path, "file", "content", "first");
  const linked = join(await temporary(), "linked");
  await git(path, "worktree", "add", "--detach", linked, id);
  const reader = await GitRepositoryReader.discover(linked);
  const metadata = await reader.metadata();
  expect(metadata.root).toBe(linked);
  expect(metadata.commonDirectory).toBe(join(path, ".git"));
  expect(metadata.gitDirectory).not.toBe(metadata.commonDirectory);
  expect(metadata.branch).toBeNull();
  expect(metadata.head).toBe(id);
  expect((await reader.history()).commits[0].id).toBe(id);
  const bare = join(await temporary(), "bare.git");
  await git(path, "clone", "--bare", path, bare);
  expect(await (await GitRepositoryReader.discover(bare)).metadata()).toMatchObject({ bare: true, root: null, head: id });
});

test("includes detached HEAD and custom refs but skips tags pointing to blobs", async () => {
  const path = await fixture();
  await commit(path, "file", "base", "base");
  await git(path, "checkout", "--detach");
  const detached = await commit(path, "detached", "detached", "detached");
  await git(path, "checkout", "main");
  await git(path, "update-ref", "refs/custom/saved", detached);
  await git(path, "tag", "blob", await git(path, "rev-parse", "HEAD:file"));
  const reader = await GitRepositoryReader.discover(path);
  expect((await reader.history()).commits[0].id).toBe(detached);
  expect((await reader.references()).find(ref => ref.name === "refs/tags/blob")?.commitId).toBeNull();
  await git(path, "update-ref", "-d", "refs/custom/saved");
  await git(path, "checkout", "--detach", detached);
  expect((await reader.history()).commits[0].id).toBe(detached);
});

test("reports unavailable Git without relying on inherited Git environment", async () => {
  const path = await fixture();
  const module = new URL("../src/repository/git.ts", import.meta.url).pathname;
  const child = Bun.spawn([process.execPath, "-e", `import { GitRepositoryReader } from ${JSON.stringify(module)}; try { await GitRepositoryReader.discover(${JSON.stringify(path)}); process.exit(1); } catch (error) { console.log(error.code); }`], {
    env: { ...process.env, PATH: await temporary() }, stdout: "pipe", stderr: "pipe",
  });
  expect((await new Response(child.stdout).text()).trim()).toBe("GIT_UNAVAILABLE");
  expect(await child.exited).toBe(0);
});

test("validates unsafe inputs and normalizes failed commands and cancellation", async () => {
  const path = await fixture();
  const id = await commit(path, "file", "data", "first");
  const reader = await GitRepositoryReader.discover(path);
  for (const revision of ["--all", "HEAD --all", "HEAD\0", ""]) {
    await expect(reader.commit(revision)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  }
  await expect(reader.commit("missing")).rejects.toMatchObject({ code: "REVISION_NOT_FOUND" });
  await expect(reader.commit("HEAD:file")).rejects.toMatchObject({ code: "REVISION_NOT_FOUND" });
  for (const name of ["../file", "/file", "file\0", "a/../file"]) {
    await expect(reader.diff(id, name)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  }
  expect((await reader.history({ limit: HISTORY_CHUNK_SIZE })).commits).toHaveLength(1);
  await expect(reader.history({ limit: HISTORY_CHUNK_SIZE + 1 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(reader.history({ cursor: { tips: ["--all"], offset: 0 } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(reader.history({}, AbortSignal.abort())).rejects.toMatchObject({ code: "CANCELLED" });
  await rm(join(path, ".git"), { recursive: true });
  await expect(reader.references()).rejects.toMatchObject({ code: "GIT_FAILED" });
});
