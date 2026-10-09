import { RepositoryError } from "./types";

export const MAX_OUTPUT = 8 * 1024 * 1024;

export interface GitProcess {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  exitCode: number | null;
  kill: () => void;
}

export type GitSpawn = (command: string[], options: { cwd: string; env: Record<string, string | undefined>; stdin: "ignore" | Buffer; stdout: "pipe"; stderr: "pipe" }) => GitProcess;

export class GitRunner {
  private active = 0;

  constructor(private readonly cwd: string, private readonly spawn: GitSpawn = (command, options) => Bun.spawn(command, options) as unknown as GitProcess) {}

  async run(args: string[], signal?: AbortSignal, limit = MAX_OUTPUT, input?: string): Promise<string> {
    if (signal?.aborted) throw new RepositoryError("CANCELLED", "Git operation cancelled.");
    if (this.active >= 4) throw new RepositoryError("BUSY", "Too many concurrent Git operations; retry later.");
    this.active++;
    let child: GitProcess | undefined;
    let exceeded = false;
    let failed = false;
    const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
    const collectors: Promise<string>[] = [];
    const cancellations: Promise<void>[] = [];
    const cleanupErrors: unknown[] = [];
    const cancelReaders = () => {
      for (const reader of readers) {
        cancellations.push(reader.cancel().catch(error => { cleanupErrors.push(error); }));
      }
    };
    const terminate = () => {
      try {
        child?.kill();
        return true;
      } catch (error) {
        cleanupErrors.push(error);
        return false;
      } finally {
        cancelReaders();
      }
    };
    let interrupt!: (error: RepositoryError) => void;
    const interrupted = new Promise<never>((_resolve, reject) => { interrupt = reject; });
    const abort = () => {
      terminate();
      interrupt(new RepositoryError("CANCELLED", "Git operation cancelled."));
    };
    try {
      try {
        child = this.spawn(["git", "--no-pager", "--no-replace-objects", "--literal-pathspecs",
          "-c", "color.ui=false", "-c", "core.quotePath=false", ...args], {
          cwd: this.cwd,
          env: {
            ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
            GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", LC_ALL: "C",
          },
          stdin: input === undefined ? "ignore" : Buffer.from(input), stdout: "pipe", stderr: "pipe",
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
        readers.add(reader);
        try {
          while (true) {
            const { value: chunk, done } = await reader.read();
            if (done) break;
            size += chunk.byteLength;
            if (size > cap) {
              exceeded = true;
              terminate();
              interrupt(new RepositoryError("OUTPUT_LIMIT", "Git output exceeded the configured size limit."));
              break;
            }
            chunks.push(chunk);
          }
        } finally {
          readers.delete(reader);
          reader.releaseLock();
        }
        return Buffer.concat(chunks).toString("utf8");
      };
      collectors.push(collect(child.stdout, limit), collect(child.stderr, 64 * 1024));
      const [stdout, , status] = await Promise.race([
        Promise.all([collectors[0]!, collectors[1]!, child.exited]), interrupted,
      ]);
      if (signal?.aborted) throw new RepositoryError("CANCELLED", "Git operation cancelled.");
      if (exceeded) throw new RepositoryError("OUTPUT_LIMIT", "Git output exceeded the configured size limit.");
      if (status !== 0) throw new RepositoryError("GIT_FAILED", "Git could not complete the repository operation.");
      return stdout;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        signal?.removeEventListener("abort", abort);
        if (child && child.exitCode === null && terminate()) {
          try {
            await child.exited;
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
        cancelReaders();
        await Promise.allSettled(collectors);
        await Promise.all(cancellations);
        if (cleanupErrors.length > 0) {
          if (!failed) throw cleanupErrors[0];
          // Keep the primary failure while making secondary cleanup failures visible.
          console.warn("Git process cleanup failed.", ...cleanupErrors);
        }
      } finally {
        this.active--;
      }
    }
  }

}
