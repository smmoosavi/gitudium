import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { RepositoryReader } from "./types";

export interface RepositoryMonitorOptions {
  debounceMs?: number;
  reconcileMs?: number;
  watch?: typeof watch | false;
}

export interface RepositoryInvalidation {
  reason: "connected" | "changed";
  version: number;
}

// Polling reads only metadata files, never launches Git or traverses objects/logs.
// Limits bound reconciliation even for unusually large repositories.
const MAX_ENTRIES = 16_384;
const MAX_BYTES = 8 * 1024 * 1024;

async function fingerprint(directories: string[], signal: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  let entries = 0;
  let bytes = 0;
  const visit = async (path: string, tree = false): Promise<void> => {
    signal.throwIfAborted();
    if (++entries > MAX_ENTRIES) throw new Error("Repository fingerprint entry limit exceeded");
    hash.update(JSON.stringify(path));
    try {
      if (tree) {
        const children = await readdir(path, { withFileTypes: true });
        for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
          if (child.name.endsWith(".lock")) continue;
          if (child.isDirectory() || child.isFile()) await visit(join(path, child.name), child.isDirectory());
        }
      } else {
        const file = await open(path, "r");
        try {
          const buffer = Buffer.alloc(16 * 1024);
          while (true) {
            signal.throwIfAborted();
            const { bytesRead } = await file.read(buffer);
            if (!bytesRead) break;
            bytes += bytesRead;
            if (bytes > MAX_BYTES) throw new Error("Repository fingerprint byte limit exceeded");
            hash.update(buffer.subarray(0, bytesRead));
          }
        } finally {
          await file.close();
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      hash.update("missing");
    }
    hash.update("\0");
  };
  for (const directory of directories) {
    await visit(join(directory, "HEAD"));
    await visit(join(directory, "packed-refs"));
    await visit(join(directory, "refs"), true);
    await visit(join(directory, "reftable"), true);
  }
  return hash.digest("hex");
}

export class RepositoryMonitor {
  private readonly abort = new AbortController();
  private readonly watchers: FSWatcher[] = [];
  private readonly listeners = new Set<(event: RepositoryInvalidation | null) => void>();
  private starting?: Promise<void>;
  private directories: string[] = [];
  private debounce?: ReturnType<typeof setTimeout>;
  private periodic?: ReturnType<typeof setInterval>;
  private checking = false;
  private pending = false;
  private previous?: string;
  private version = 0;

  constructor(private readonly reader: () => Promise<RepositoryReader>, private readonly options: RepositoryMonitorOptions = {}) {}

  async start(): Promise<void> {
    this.abort.signal.throwIfAborted();
    return this.starting ??= this.initialize().catch(error => {
      for (const watcher of this.watchers.splice(0)) watcher.close();
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = undefined;
      this.starting = undefined;
      throw error;
    });
  }

  private async initialize(): Promise<void> {
    const metadata = await (await this.reader()).metadata(this.abort.signal);
    this.abort.signal.throwIfAborted();
    this.directories = [...new Set([metadata.gitDirectory, metadata.commonDirectory])];
    const factory = this.options.watch === false ? undefined : this.options.watch ?? watch;
    if (factory) {
      for (const directory of this.directories) {
        try {
          const watcher = factory(directory, { recursive: true }, (_event, filename) => {
            const name = filename ? relative(directory, join(directory, filename.toString())).replaceAll("\\", "/") : null;
            if (name === null || name === "HEAD" || name === "packed-refs" || name === "refs" || name.startsWith("refs/") || name === "reftable" || name.startsWith("reftable/")) this.hint();
          });
          // Watcher support/errors never disable periodic reconciliation.
          watcher.on("error", () => watcher.close());
          this.watchers.push(watcher);
        } catch { /* Unsupported watchers fall back to polling. */ }
      }
    }
    await this.reconcile();
    this.abort.signal.throwIfAborted();
    this.periodic = setInterval(() => void this.reconcile(), Math.max(10, this.options.reconcileMs ?? 2000));
    this.periodic.unref?.();
  }

  private hint(): void {
    if (this.abort.signal.aborted || this.debounce) return;
    // A fixed window coalesces bursts without postponing updates indefinitely.
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      void this.reconcile();
    }, Math.max(1, this.options.debounceMs ?? 100));
    this.debounce.unref?.();
  }

  private async reconcile(): Promise<void> {
    if (this.abort.signal.aborted) return;
    if (this.checking) {
      this.pending = true;
      return;
    }
    this.checking = true;
    try {
      const next = await fingerprint(this.directories, this.abort.signal);
      if (this.abort.signal.aborted) return;
      const changed = this.previous !== undefined && this.previous !== next;
      this.previous = next;
      if (changed) {
        const event: RepositoryInvalidation = { reason: "changed", version: ++this.version };
        for (const listener of this.listeners) listener(event);
      }
    } catch {
      // Limits or transient read failures must not silently leave clients stale.
      if (!this.abort.signal.aborted) {
        const event: RepositoryInvalidation = { reason: "changed", version: ++this.version };
        for (const listener of this.listeners) listener(event);
      }
    } finally {
      this.checking = false;
      if (this.pending) {
        this.pending = false;
        this.hint();
      }
    }
  }

  subscribe(listener: (event: RepositoryInvalidation | null) => void): () => void {
    this.abort.signal.throwIfAborted();
    this.listeners.add(listener);
    listener({ reason: "connected", version: this.version });
    return () => { this.listeners.delete(listener); };
  }

  close(): void {
    if (this.abort.signal.aborted) return;
    this.abort.abort();
    if (this.debounce) clearTimeout(this.debounce);
    if (this.periodic) clearInterval(this.periodic);
    for (const watcher of this.watchers.splice(0)) watcher.close();
    for (const listener of this.listeners) listener(null);
    this.listeners.clear();
  }
}
