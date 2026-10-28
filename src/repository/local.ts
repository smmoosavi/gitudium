import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readlink, realpath } from "node:fs/promises";
import { dirname, join, relative, isAbsolute } from "node:path";
import { RepositoryError, type ChangedFile, type DiffResult, type GitDiffAlgorithm, type LocalChangedFile, type LocalChanges, type LocalScope, type SourceFile, type SourceResult, type WhitespaceMode } from "./types";
import { isLiteralPath } from "./validation";
import { parseChangedFiles } from "./parsers";

const MAX_LOCAL_FILE = 1024 * 1024;
type RunGit = (args: string[], signal?: AbortSignal, limit?: number, input?: string) => Promise<string>;
const statuses: Record<string, ChangedFile["status"]> = { A: "added", D: "deleted", M: "modified", T: "type-changed", U: "modified" };

export class LocalChangesReader {
  constructor(private readonly root: string, private readonly run: RunGit) {}

  private async head(signal?: AbortSignal): Promise<string | null> {
    try {
      return (await this.run(["rev-parse", "--verify", "HEAD^{commit}"], signal)).trim();
    } catch (error) {
      if (error instanceof RepositoryError && error.code === "GIT_FAILED") return null;
      throw error;
    }
  }

  private async base(signal?: AbortSignal): Promise<string> {
    return await this.head(signal) ?? (await this.run(["hash-object", "-t", "tree", "--stdin"], signal, undefined, "")).trim();
  }

  async changes(signal?: AbortSignal): Promise<LocalChanges> {
    if ((await this.run(["rev-parse", "--is-bare-repository"], signal)).trim() === "true") {
      return { available: false, head: null, version: "bare", files: [] };
    }
    const output = await this.run(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames", "--ignore-submodules=none"], signal);
    const head = await this.head(signal);
    const byPath = new Map<string, LocalChangedFile>();
    for (const record of output.split("\0").filter(Boolean)) {
      const index = record[0];
      const worktree = record[1];
      const path = record.slice(3);
      if (!path || record[2] !== " " || !isLiteralPath(path)) throw new RepositoryError("GIT_FAILED", "Malformed Git status.");
      const untracked = index === "?";
      const conflicted = index === "U" || worktree === "U" || record.startsWith("AA ") || record.startsWith("DD ");
      const file: LocalChangedFile = { path, previousPath: null, status: untracked ? "added" : statuses[index] ?? statuses[worktree] ?? "modified",
        staged: !untracked && index !== " ", unstaged: !untracked && worktree !== " ", untracked, conflicted,
        stagedStatus: untracked ? null : statuses[index] ?? null, unstagedStatus: untracked ? null : statuses[worktree] ?? null };
      const previous = byPath.get(path);
      byPath.set(path, previous ? { ...previous, untracked: previous.untracked || untracked, staged: previous.staged || file.staged,
        unstaged: previous.unstaged || file.unstaged, conflicted: previous.conflicted || conflicted,
        stagedStatus: previous.stagedStatus ?? file.stagedStatus, unstagedStatus: previous.unstagedStatus ?? file.unstagedStatus } : file);
    }
    const files = [...byPath.values()];
    const base = head ?? await this.base(signal);
    const net = parseChangedFiles(await this.run(["diff", "--name-status", "-z", "--no-renames", "--no-ext-diff", "--no-textconv", base, "--"], signal));
    const netStatuses = new Map(net.map(file => [file.path, file.status]));
    const version = createHash("sha256").update(output).update(base);
    const indexPath = (await this.run(["rev-parse", "--path-format=absolute", "--git-path", "index"], signal)).trim();
    for (const path of [indexPath, ...files.map(file => join(this.root, file.path))]) {
      try {
        const stats = await lstat(path, { bigint: true });
        version.update(`${path}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ENOTDIR") throw error;
        version.update(`${path}:missing`);
      }
    }
    for (const file of files) file.status = file.untracked && file.staged ? "modified" : netStatuses.get(file.path) ?? file.status;
    return { available: true, head, files, version: version.digest("hex") };
  }

  private async file(scope: LocalScope, path: string, signal?: AbortSignal): Promise<LocalChangedFile> {
    if (!["all", "staged", "unstaged", "untracked"].includes(scope) || !isLiteralPath(path)) {
      throw new RepositoryError("INVALID_INPUT", "Expected a local changes scope and literal file path.");
    }
    const file = (await this.changes(signal)).files.find(file => file.path === path && (scope === "all" || file[scope]));
    if (!file) throw new RepositoryError("INVALID_INPUT", "The file has no changes in this scope. Refresh local changes.");
    return file;
  }

  private async blob(revision: string, path: string, signal?: AbortSignal): Promise<SourceFile | null | "unavailable"> {
    const output = revision === "INDEX"
      ? await this.run(["ls-files", "--stage", "-z", "--", path], signal)
      : await this.run(["ls-tree", "-z", "--full-tree", revision, "--", path], signal);
    if (!output) return null;
    const entry = revision === "INDEX" ? /^(\d+) ([a-f0-9]+) 0\t([\s\S]*)\0$/.exec(output) : /^(\d+) blob ([a-f0-9]+)\t([\s\S]*)\0$/.exec(output);
    if (!entry || entry[3] !== path || entry[1] === "160000") return "unavailable";
    const size = Number((await this.run(["cat-file", "-s", entry[2]], signal)).trim());
    if (size > MAX_LOCAL_FILE) throw new RepositoryError("OUTPUT_LIMIT", "File exceeds the local diff limit.");
    return { revision: entry[2], path, text: await this.run(["cat-file", "blob", entry[2]], signal, MAX_LOCAL_FILE) };
  }

  private async worktree(path: string, signal?: AbortSignal): Promise<SourceFile | null | "unavailable"> {
    if (signal?.aborted) throw new RepositoryError("CANCELLED", "Git operation cancelled.");
    try {
      const parent = relative(this.root, await realpath(dirname(join(this.root, path))));
      if (parent === ".." || parent.startsWith("../") || isAbsolute(parent)) return "unavailable";
      const target = join(this.root, path);
      const stats = await lstat(target);
      let text: string;
      if (stats.isSymbolicLink()) text = await readlink(target);
      else {
        if (!stats.isFile()) return "unavailable";
        const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const current = await file.stat();
          if (!current.isFile()) return "unavailable";
          if (current.size > MAX_LOCAL_FILE) throw new RepositoryError("OUTPUT_LIMIT", "File exceeds the local diff limit.");
          const buffer = Buffer.alloc(MAX_LOCAL_FILE + 1);
          let length = 0;
          while (length < buffer.length) {
            const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
            if (!bytesRead) break;
            length += bytesRead;
          }
          if (length > MAX_LOCAL_FILE) throw new RepositoryError("OUTPUT_LIMIT", "File exceeds the local diff limit.");
          text = buffer.subarray(0, length).toString("utf8");
        } finally {
          await file.close();
        }
      }
      if (signal?.aborted) throw new RepositoryError("CANCELLED", "Git operation cancelled.");
      return { revision: createHash("sha256").update(text).digest("hex"), path, text };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return null;
      if (code === "ELOOP") return "unavailable";
      throw error;
    }
  }

  async sources(scope: LocalScope, path: string, signal?: AbortSignal): Promise<SourceResult> {
    const file = await this.file(scope, path, signal);
    try {
      const head = await this.head(signal);
      const before = scope === "untracked" ? null : scope === "unstaged" ? await this.blob("INDEX", path, signal) : head ? await this.blob(head, path, signal) : null;
      const after = scope === "staged" ? await this.blob("INDEX", path, signal) : await this.worktree(path, signal);
      if (before === "unavailable" || after === "unavailable") return { state: "unavailable" };
      if (before?.text.includes("\0") || after?.text.includes("\0")) return { state: "binary" };
      return { state: "text", before, after };
    } catch (error) {
      if (error instanceof RepositoryError && error.code === "OUTPUT_LIMIT") return { state: "oversized", limitBytes: MAX_LOCAL_FILE };
      throw error;
    }
  }

  async diff(scope: LocalScope, path: string, signal?: AbortSignal, whitespace: WhitespaceMode = "none", algorithm: GitDiffAlgorithm = "myers"): Promise<DiffResult> {
    if (!["myers", "histogram", "patience", "minimal"].includes(algorithm) || !["none", "trailing", "all", "all-and-blank-lines"].includes(whitespace)) {
      throw new RepositoryError("INVALID_INPUT", "Unknown diff option.");
    }
    const file = await this.file(scope, path, signal);
    if (file.conflicted && scope !== "all") return { state: "text", patch: "" };
    if (scope === "untracked" || (scope === "all" && file.untracked && !file.staged)) {
      const sources = await this.sources(scope, path, signal);
      if (sources.state === "binary" || sources.state === "oversized") return sources;
      if (sources.state !== "text" || !sources.after) return { state: "text", patch: "" };
      const text = sources.after.text;
      const lines = text ? text.replace(/\n$/, "").split("\n") : [];
      if (whitespace === "all-and-blank-lines" && lines.length && lines.every(line => !line.trim())) return { state: "text", patch: "" };
      const patch = `--- /dev/null\n+++ b/${path}\n` + (lines.length ? `@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}\n`).join("")}${text.endsWith("\n") ? "" : "\\ No newline at end of file\n"}` : "");
      return Buffer.byteLength(patch) > MAX_LOCAL_FILE ? { state: "oversized", limitBytes: MAX_LOCAL_FILE } : { state: "text", patch };
    }
    const flags = whitespace === "trailing" ? ["--ignore-space-at-eol"] : whitespace === "all" ? ["--ignore-all-space"] : whitespace === "all-and-blank-lines" ? ["--ignore-all-space", "--ignore-blank-lines"] : [];
    const base = scope === "unstaged" ? null : await this.base(signal);
    const comparison = scope === "staged" ? ["--cached", base!] : scope === "unstaged" ? [] : [file.untracked && file.staged ? `${base}:${path}` : base!];
    try {
      const patch = await this.run(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-color", "--no-relative", "--full-index", `--diff-algorithm=${algorithm}`, ...flags, ...comparison, "--", path], signal, MAX_LOCAL_FILE);
      return /^Binary files .* differ$/m.test(patch) ? { state: "binary" } : { state: "text", patch };
    } catch (error) {
      if (error instanceof RepositoryError && error.code === "OUTPUT_LIMIT") return { state: "oversized", limitBytes: MAX_LOCAL_FILE };
      throw error;
    }
  }
}
