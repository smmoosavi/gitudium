import { createHash } from "node:crypto";
import { RepositoryError } from "./types";
import { HISTORY_CHUNK_SIZE } from "./limits";
import type {
  ChangedFile, CommitDetails, CommitSummary, DiffResult, HistoryPage,
  HistoryQuery, Reference, RepositoryMetadata, RepositoryReader,
} from "./types";

const SUMMARY = "%H%x00%h%x00%P%x00%s%x00%an%x00%ae%x00%aI";
const DETAILS = `${SUMMARY}%x00%cn%x00%ce%x00%cI%x00%B`;
const MAX_OUTPUT = 8 * 1024 * 1024;
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
  private active = 0;
  private readonly historySnapshots = new Map<string, string[]>();

  private constructor(private readonly cwd: string) {}

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

  private async run(args: string[], signal?: AbortSignal, limit = MAX_OUTPUT): Promise<string> {
    if (signal?.aborted) throw new RepositoryError("CANCELLED", "Git operation cancelled.");
    if (this.active >= 4) throw new RepositoryError("BUSY", "Too many concurrent Git operations; retry later.");
    this.active++;
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let exceeded = false;
    const abort = () => child?.kill();
    try {
      try {
        child = Bun.spawn(["git", "--no-pager", "--no-replace-objects", "--literal-pathspecs",
          "-c", "color.ui=false", "-c", "core.quotePath=false", ...args], {
          cwd: this.cwd,
          env: {
            ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
            GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C",
          },
          stdin: "ignore", stdout: "pipe", stderr: "pipe",
        });
      } catch {
        throw new RepositoryError("GIT_UNAVAILABLE", "Unable to start Git; check Git installation and launch directory.");
      }
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const collect = async (stream: ReadableStream<Uint8Array>, cap: number) => {
        const chunks: Uint8Array[] = [];
        let size = 0;
        const reader = stream.getReader();
        try {
          while (true) {
            const { value: chunk, done } = await reader.read();
            if (done) break;
            size += chunk.byteLength;
            if (size > cap) {
              exceeded = true;
              child?.kill();
              await reader.cancel();
              break;
            }
            chunks.push(chunk);
          }
        } finally {
          reader.releaseLock();
        }
        return Buffer.concat(chunks).toString("utf8");
      };
      const [stdout, , status] = await Promise.all([
        collect(child.stdout as ReadableStream<Uint8Array>, limit),
        collect(child.stderr as ReadableStream<Uint8Array>, 64 * 1024), child.exited,
      ]);
      if (signal?.aborted) throw new RepositoryError("CANCELLED", "Git operation cancelled.");
      if (exceeded) throw new RepositoryError("OUTPUT_LIMIT", "Git output exceeded the configured size limit.");
      if (status !== 0) throw new RepositoryError("GIT_FAILED", "Git could not complete the repository operation.");
      return stdout;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (child && child.exitCode === null) {
        child.kill();
        await child.exited;
      }
      this.active--;
    }
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
    return output.split("\n").filter(Boolean).map(line => {
      const [name, objectId, type, peeled, peeledType, symbolicTarget] = line.split("\0");
      return {
        name, objectId, kind: name.startsWith("refs/heads/") ? "branch" : name.startsWith("refs/remotes/") ? "remote" : "tag",
        commitId: type === "commit" ? objectId : peeledType === "commit" ? peeled : null,
        symbolicTarget: symbolicTarget || null,
      };
    });
  }

  private referenceNames(refs: Reference[]): Map<string, string[]> {
    const names = new Map<string, string[]>();
    for (const ref of refs) {
      if (ref.commitId === null) continue;
      const attached = names.get(ref.commitId);
      if (attached) attached.push(ref.name);
      else names.set(ref.commitId, [ref.name]);
    }
    return names;
  }

  private summary(fields: string[], refs: Map<string, string[]>): CommitSummary {
    const [id, shortId, parents, subject, name, email, date] = fields;
    return { id, shortId, parents: parents ? parents.split(" ") : [], subject,
      author: { name, email, date }, references: refs.get(id) ?? [] };
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
      for (const id of [...new Set(ids)]) {
        try { tips.push(await this.resolve(id, signal)); } catch (error) {
          if (!(error instanceof RepositoryError) || error.code !== "REVISION_NOT_FOUND") throw error;
        }
        if (tips.length > MAX_TIPS) throw new RepositoryError("OUTPUT_LIMIT", "Too many history tips.");
      }
      try { tips.push(await this.resolve("HEAD", signal)); } catch (error) {
        if (!(error instanceof RepositoryError) || error.code !== "REVISION_NOT_FOUND") throw error;
      }
      tips = [...new Set(tips)].sort();
      if (tips.length > MAX_TIPS) throw new RepositoryError("OUTPUT_LIMIT", "Too many history tips.");
    }
    if (!tips.length) return { commits: [], nextCursor: null };
    const refs = this.referenceNames(await this.references(signal));
    const output = await this.run(["log", "--topo-order", "-z", `--format=${SUMMARY}`, `--skip=${offset}`, `--max-count=${limit + 1}`, ...tips, "--"], signal);
    const fields = output.split("\0");
    if (fields.at(-1) === "") fields.pop();
    const commits: CommitSummary[] = [];
    for (let i = 0; i < fields.length; i += 7) commits.push(this.summary(fields.slice(i, i + 7), refs));
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
    const fields = output.split("\0");
    fields.pop();
    const statuses: Record<string, ChangedFile["status"]> = { A: "added", M: "modified", D: "deleted", T: "type-changed" };
    const files: ChangedFile[] = [];
    for (let i = 0; i < fields.length; i += 2) {
      const status = statuses[fields[i]];
      if (!status) throw new RepositoryError("GIT_FAILED", "Unsupported changed-file status.");
      files.push({ path: fields[i + 1], previousPath: null, status });
    }
    return files;
  }

  async commit(revision: string, signal?: AbortSignal): Promise<CommitDetails> {
    const id = await this.resolve(revision, signal);
    const fields = (await this.run(["log", "-1", "-z", `--format=${DETAILS}`, id, "--"], signal)).split("\0");
    const summary = this.summary(fields, this.referenceNames(await this.references(signal)));
    return { ...summary, committer: { name: fields[7], email: fields[8], date: fields[9] },
      message: fields[10], files: await this.files(id, signal), diffBase: summary.parents[0] ?? null };
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
