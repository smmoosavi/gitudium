import { createHash } from "node:crypto";
import { RepositoryError } from "./types";
import { HISTORY_CHUNK_SIZE } from "./limits";
import type {
  ChangedFile, CommitDetails, DiffResult, HistoryPage,
  HistoryQuery, Reference, RepositoryMetadata, RepositoryReader,
} from "./types";

import { SUMMARY_FORMAT, DETAILS_FORMAT, parseReferences, referenceNames, parseSummaries, parseDetails, parseChangedFiles } from "./parsers";
import { GitRunner, MAX_OUTPUT } from "./runner";
const MAX_DIFF = 1024 * 1024;
const MAX_TIPS = 4096;
const MAX_HISTORY_SNAPSHOTS = 128;

function invalid(message: string): never {
  throw new RepositoryError("INVALID_INPUT", message);
}

function validateRevision(value: string): void {
  if (typeof value !== "string" || !value || value.startsWith("-") || /[\x00-\x20\x7f]/.test(value) || value.length > 1024) {
    invalid("Expected a non-option revision naming one commit.");
  }
}

function validatePath(path: string): void {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\0") || path.split("/").some(part => part === ".." || part === "." || !part)) {
    invalid("Expected a repository-relative literal file path.");
  }
}

export class GitRepositoryReader implements RepositoryReader {
  private readonly runner: GitRunner;
  private readonly historySnapshots = new Map<string, string[]>();

  private constructor(cwd: string) {
    this.runner = new GitRunner(cwd);
  }

  static async discover(cwd: string, signal?: AbortSignal): Promise<GitRepositoryReader> {
    const reader = new GitRepositoryReader(cwd);
    try {
      await reader.run(["rev-parse", "--absolute-git-dir"], signal);
    } catch (error) {
      if (error instanceof RepositoryError && error.code === "GIT_FAILED") {
        throw new RepositoryError("NOT_A_REPOSITORY", "The launch directory is not inside a Git repository.");
      }
      throw error;
    }
    const bare = (await reader.run(["rev-parse", "--is-bare-repository"], signal)).trim() === "true";
    const root = (await reader.run(bare ? ["rev-parse", "--absolute-git-dir"] : ["rev-parse", "--show-toplevel"], signal)).trim();
    return new GitRepositoryReader(root);
  }

  private run(args: string[], signal?: AbortSignal, limit = MAX_OUTPUT, input?: string): Promise<string> {
    return this.runner.run(args, signal, limit, input);
  }

  private async resolve(revision: string, signal?: AbortSignal): Promise<string> {
    validateRevision(revision);
    try {
      return (await this.run(["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`], signal)).trim();
    } catch (error) {
      if (error instanceof RepositoryError && error.code === "GIT_FAILED") {
        throw new RepositoryError("REVISION_NOT_FOUND", "Revision does not resolve to a commit.");
      }
      throw error;
    }
  }

  async metadata(signal?: AbortSignal): Promise<RepositoryMetadata> {
    const bare = (await this.run(["rev-parse", "--is-bare-repository"], signal)).trim() === "true";
    const gitDirectory = (await this.run(["rev-parse", "--absolute-git-dir"], signal)).trim();
    const commonDirectory = (await this.run(["rev-parse", "--path-format=absolute", "--git-common-dir"], signal)).trim();
    const root = bare ? null : (await this.run(["rev-parse", "--show-toplevel"], signal)).trim();
    const objectFormat = (await this.run(["rev-parse", "--show-object-format"], signal)).trim();
    if (objectFormat !== "sha1" && objectFormat !== "sha256") throw new RepositoryError("GIT_FAILED", "Unsupported Git object format.");
    let head: string | null = null;
    try { head = await this.resolve("HEAD", signal); } catch (error) {
      if (!(error instanceof RepositoryError) || error.code !== "REVISION_NOT_FOUND") throw error;
    }
    let branch: string | null = null;
    try { branch = (await this.run(["symbolic-ref", "--quiet", "--short", "HEAD"], signal)).trim(); } catch (error) {
      if (!(error instanceof RepositoryError) || error.code !== "GIT_FAILED") throw error;
    }
    return { root, gitDirectory, commonDirectory, bare, head, branch, objectFormat, capabilities: { history: true, firstParentDiffs: true } };
  }

  async references(signal?: AbortSignal): Promise<Reference[]> {
    const output = await this.run(["for-each-ref", "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)%00%(symref)", "refs/heads", "refs/remotes", "refs/tags"], signal);
    return parseReferences(output);
  }

  async history(query: HistoryQuery = {}, signal?: AbortSignal): Promise<HistoryPage> {
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_CHUNK_SIZE) invalid(`History limit must be between 1 and ${HISTORY_CHUNK_SIZE}.`);
    if (query.cursor && query.revision !== undefined) invalid("Use either a cursor or a revision, not both.");
    let tips: string[];
    let snapshot: string | undefined;
    let offset = 0;
    if (query.cursor) {
      const cursor = query.cursor;
      if (typeof cursor.snapshot !== "string" || !/^[a-f0-9]{64}$/.test(cursor.snapshot) || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || cursor.offset > 1_000_000) invalid("Invalid history cursor.");
      snapshot = cursor.snapshot;
      const saved = this.historySnapshots.get(snapshot);
      if (!saved) invalid("History cursor expired; reload history to start a new snapshot.");
      tips = saved;
      this.historySnapshots.delete(snapshot);
      this.historySnapshots.set(snapshot, tips);
      offset = cursor.offset;
    } else if (query.revision !== undefined) {
      tips = [await this.resolve(query.revision, signal)];
    } else {
      // --all includes all refs, not just the branches and tags displayed as labels.
      const output = await this.run(["rev-parse", "--all"], signal);
      const ids = output.trim() ? output.trim().split("\n") : [];
      tips = [];
      const uniqueIds = [...new Set(ids)];
      if (uniqueIds.length) {
        const peeled = await this.run(["cat-file", "--batch-check=%(objectname) %(objecttype)"], signal, MAX_OUTPUT,
          uniqueIds.map(id => `${id}^{}`).join("\n") + "\n");
        for (const line of peeled.trim().split("\n")) {
          const [id, type] = line.split(" ");
          if (type === "commit") tips.push(id);
          if (tips.length > MAX_TIPS) throw new RepositoryError("OUTPUT_LIMIT", "Too many history tips.");
        }
      }
      try { tips.push(await this.resolve("HEAD", signal)); } catch (error) {
        if (!(error instanceof RepositoryError) || error.code !== "REVISION_NOT_FOUND") throw error;
      }
      tips = [...new Set(tips)].sort();
      if (tips.length > MAX_TIPS) throw new RepositoryError("OUTPUT_LIMIT", "Too many history tips.");
    }
    if (!tips.length) return { commits: [], nextCursor: null };
    const refs = referenceNames(await this.references(signal));
    const output = await this.run(["log", "--topo-order", "-z", `--format=${SUMMARY_FORMAT}`, `--skip=${offset}`, `--max-count=${limit + 1}`, ...tips, "--"], signal);
    const commits = parseSummaries(output, refs);
    if (commits.length <= limit) return { commits, nextCursor: null };
    snapshot ??= createHash("sha256").update(tips.join("\n")).digest("hex");
    // Keep immutable tips server-side; cursor size must not grow with ref count.
    this.historySnapshots.delete(snapshot);
    this.historySnapshots.set(snapshot, tips);
    while (this.historySnapshots.size > MAX_HISTORY_SNAPSHOTS) {
      this.historySnapshots.delete(this.historySnapshots.keys().next().value!);
    }
    return { commits: commits.slice(0, limit), nextCursor: { snapshot, offset: offset + limit } };
  }

  private async comparison(id: string, signal?: AbortSignal): Promise<string[]> {
    const parents = (await this.run(["log", "-1", "--format=%P", id, "--"], signal)).trim();
    return parents ? [parents.split(" ")[0], id] : [id];
  }

  private async files(id: string, signal?: AbortSignal): Promise<ChangedFile[]> {
    const comparison = await this.comparison(id, signal);
    const output = await this.run(["diff-tree", "--root", "--no-commit-id", "-r", "--name-status", "-z", "--no-ext-diff", "--no-textconv", "--no-renames", ...comparison, "--"], signal);
    return parseChangedFiles(output);
  }

  async commit(revision: string, signal?: AbortSignal): Promise<CommitDetails> {
    const id = await this.resolve(revision, signal);
    const output = await this.run(["log", "-1", "-z", `--format=${DETAILS_FORMAT}`, id, "--"], signal);
    const details = parseDetails(output, referenceNames(await this.references(signal)));
    return { ...details, files: await this.files(id, signal) };
  }

  async diff(revision: string, path?: string, signal?: AbortSignal): Promise<DiffResult> {
    if (path !== undefined) validatePath(path);
    const id = await this.resolve(revision, signal);
    const comparison = await this.comparison(id, signal);
    const args = ["diff-tree", "--no-commit-id", "-r", "-p", "--root", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-color", "--no-relative", "--full-index", ...comparison, "--", ...(path === undefined ? [] : [path])];
    try {
      const patch = await this.run(args, signal, MAX_DIFF);
      return /^Binary files .* differ$/m.test(patch) ? { state: "binary" } : { state: "text", patch };
    } catch (error) {
      if (error instanceof RepositoryError && error.code === "OUTPUT_LIMIT") return { state: "oversized", limitBytes: MAX_DIFF };
      throw error;
    }
  }
}
