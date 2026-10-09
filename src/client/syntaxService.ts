import {
  SYNTAX_TOKEN_LIMIT, syntaxSourceKey, syntaxSourcesWithinLimit,
} from "./syntaxTypes";
import type { SyntaxRequest, SyntaxResponse, SyntaxResult, SyntaxSources } from "./syntaxTypes";

export interface SyntaxWorker {
  postMessage(request: SyntaxRequest): void;
  terminate(): void;
  onmessage: ((event: { data: SyntaxResponse }) => void) | null;
  onerror: (() => void) | null;
  onmessageerror: (() => void) | null;
}

export interface SyntaxTimers {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface Job {
  id: number;
  key: string;
  sources: SyntaxSources;
  publish: (result: SyntaxResult | undefined) => void;
}

const defaultTimers: SyntaxTimers = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function tokenCount(result: SyntaxResult): number {
  let count = 0;
  for (const lines of [result.before, result.after]) {
    if (lines === null) continue;
    if (!Array.isArray(lines)) return Infinity;
    for (const line of lines) {
      if (!Array.isArray(line)) return Infinity;
      count += line.length;
      if (count > SYNTAX_TOKEN_LIMIT) return count;
      for (const token of line) {
        if (!token || typeof token.text !== "string" ||
          (token.color !== undefined && typeof token.color !== "string")) return Infinity;
      }
    }
  }
  return count;
}

function freezeResult(result: SyntaxResult): SyntaxResult {
  for (const lines of [result.before, result.after]) {
    if (!lines) continue;
    for (const line of lines) {
      for (const token of line) Object.freeze(token);
      Object.freeze(line);
    }
    Object.freeze(lines);
  }
  return Object.freeze(result);
}

export class SyntaxService {
  private worker: SyntaxWorker | undefined;
  private sequence = 0;
  private desired: Job | undefined;
  private pending: Job | undefined;
  private active: Job | undefined;
  private debounce: unknown;
  private activity: unknown;
  private timeout: unknown;
  private cache = new Map<string, { result: SyntaxResult; tokens: number }>();
  private cachedTokens = 0;

  constructor(
    private readonly createWorker: () => SyntaxWorker = () =>
      new Worker(new URL("./syntax.worker.ts", import.meta.url), { type: "module" }) as unknown as SyntaxWorker,
    private readonly timers: SyntaxTimers = defaultTimers,
  ) {}

  request(sources: SyntaxSources | undefined, publish: (result: SyntaxResult | undefined) => void): () => void {
    this.clearDebounce();
    this.pending = undefined;
    const id = ++this.sequence;
    this.desired = undefined;
    publish(undefined);
    if (!sources || !syntaxSourcesWithinLimit(sources)) return () => {};
    const job: Job = { id, key: syntaxSourceKey(sources), sources, publish };
    this.desired = job;
    const rapid = this.activity !== undefined;
    if (this.activity !== undefined) this.timers.clearTimeout(this.activity);
    this.activity = this.timers.setTimeout(() => { this.activity = undefined; }, 100);
    const ready = () => {
      this.debounce = undefined;
      if (this.desired !== job) return;
      const cached = this.cache.get(job.key);
      if (cached) {
        this.cache.delete(job.key);
        this.cache.set(job.key, cached);
        job.publish(cached.result);
      } else {
        this.pending = job;
        this.startPending();
      }
    };
    if (rapid) this.debounce = this.timers.setTimeout(ready, 100);
    else ready();
    return () => {
      if (this.desired !== job) return;
      this.clearDebounce();
      this.desired = undefined;
      this.pending = undefined;
    };
  }

  dispose(): void {
    this.clearDebounce();
    if (this.activity !== undefined) this.timers.clearTimeout(this.activity);
    this.activity = undefined;
    this.resetWorker();
    this.desired = undefined;
    this.pending = undefined;
    this.cache.clear();
    this.cachedTokens = 0;
  }

  private clearDebounce(): void {
    if (this.debounce !== undefined) this.timers.clearTimeout(this.debounce);
    this.debounce = undefined;
  }

  private resetWorker(): void {
    if (this.timeout !== undefined) this.timers.clearTimeout(this.timeout);
    this.timeout = undefined;
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      this.worker.terminate();
    }
    this.worker = undefined;
    this.active = undefined;
  }

  private startPending(): void {
    if (this.active || !this.pending) return;
    const job = this.pending;
    this.pending = undefined;
    this.active = job;
    try {
      if (!this.worker) {
        const worker = this.createWorker();
        this.worker = worker;
        worker.onmessage = event => {
          if (this.worker === worker) this.complete(event.data);
        };
        worker.onerror = worker.onmessageerror = () => {
          if (this.worker === worker) this.fail();
        };
      }
      this.timeout = this.timers.setTimeout(() => this.fail(), 5_000);
      this.worker.postMessage({ id: job.id, sources: job.sources });
    } catch {
      this.fail();
    }
  }

  private fail(): void {
    const job = this.active;
    this.resetWorker();
    if (job && this.desired === job) job.publish(undefined);
    this.startPending();
  }

  private complete(response: SyntaxResponse): void {
    const job = this.active;
    if (!job || response.id !== job.id) return;
    if (this.timeout !== undefined) this.timers.clearTimeout(this.timeout);
    this.timeout = undefined;
    this.active = undefined;
    if (this.desired === job) {
      const count = "result" in response ? tokenCount(response.result) : Infinity;
      if (count <= SYNTAX_TOKEN_LIMIT && "result" in response) {
        const result = freezeResult(response.result);
        this.cache.set(job.key, { result, tokens: count });
        this.cachedTokens += count;
        while (this.cache.size > 4 || this.cachedTokens > 200_000) {
          const key = this.cache.keys().next().value!;
          this.cachedTokens -= this.cache.get(key)!.tokens;
          this.cache.delete(key);
        }
        job.publish(result);
      } else job.publish(undefined);
    }
    this.startPending();
  }
}

