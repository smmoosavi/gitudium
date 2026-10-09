import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SyntaxService } from "../src/client/syntaxService";
import type { SyntaxTimers, SyntaxWorker } from "../src/client/syntaxService";
import type { SyntaxRequest, SyntaxResponse, SyntaxResult, SyntaxSources } from "../src/client/syntaxTypes";
import { syntaxSourceKey } from "../src/client/syntaxTypes";
import { createSyntaxTokenizer, tokenizeSyntaxSources } from "../src/client/syntax.worker";
import { useSyntaxHighlighting } from "../src/client/useSyntaxHighlighting";

class Clock implements SyntaxTimers {
  now = 0;
  next = 0;
  tasks = new Map<number, { at: number; callback: () => void }>();
  setTimeout(callback: () => void, delay: number) {
    const id = ++this.next;
    this.tasks.set(id, { at: this.now + delay, callback });
    return id;
  }
  clearTimeout(handle: unknown) { this.tasks.delete(handle as number); }
  advance(ms: number) {
    const target = this.now + ms;
    while (true) {
      const entry = [...this.tasks].filter(([, task]) => task.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      this.now = entry[1].at;
      this.tasks.delete(entry[0]);
      entry[1].callback();
    }
    this.now = target;
  }
}

class FakeWorker implements SyntaxWorker {
  onmessage: SyntaxWorker["onmessage"] = null;
  onerror: SyntaxWorker["onerror"] = null;
  onmessageerror: SyntaxWorker["onmessageerror"] = null;
  jobs: SyntaxRequest[] = [];
  terminated = false;
  postMessage(request: SyntaxRequest) { this.jobs.push(request); }
  terminate() { this.terminated = true; }
  respond(response: SyntaxResponse) { this.onmessage?.({ data: response }); }
  finish(result = tokens()) { this.respond({ id: this.jobs.at(-1)!.id, result }); }
}

const sources = (revision = "a", path = "file.ts", text = "const x = 1;"): SyntaxSources => ({
  before: { revision, path, text }, after: null,
});
const tokens = (count = 1): SyntaxResult => ({
  before: [Array.from({ length: count }, () => ({ text: "x", color: "#fff" }))], after: null,
});
function fixture() {
  const clock = new Clock();
  const workers: FakeWorker[] = [];
  const results: (SyntaxResult | undefined)[] = [];
  const service = new SyntaxService(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  }, clock);
  const request = (input: SyntaxSources | undefined) => service.request(input, result => results.push(result));
  return { clock, workers, results, service, request };
}

test("first and isolated requests start immediately; rapid requests use trailing debounce", () => {
  const f = fixture();
  f.request(sources("a"));
  expect(f.workers[0]!.jobs[0]!.sources.before?.revision).toBe("a");
  f.workers[0]!.finish();
  f.clock.advance(50);
  f.request(sources("b"));
  f.clock.advance(50);
  f.request(sources("c"));
  f.clock.advance(99);
  expect(f.workers[0]!.jobs).toHaveLength(1);
  f.clock.advance(1);
  expect(f.workers[0]!.jobs[1]!.sources.before?.revision).toBe("c");
  f.workers[0]!.finish();
  f.clock.advance(101);
  f.request(sources("d"));
  expect(f.workers).toHaveLength(1);
  expect(f.workers[0]!.jobs).toHaveLength(3);
  f.service.dispose();
});

test("only newest pending job runs, stale and mismatched responses cannot publish", () => {
  const f = fixture();
  f.request(sources("a")); f.clock.advance(100);
  f.request(sources("b")); f.clock.advance(100);
  f.request(sources("c")); f.clock.advance(100);
  const worker = f.workers[0]!;
  worker.respond({ id: 999, result: tokens() });
  expect(worker.jobs).toHaveLength(1);
  worker.finish();
  expect(f.results.filter(Boolean)).toHaveLength(0);
  expect(worker.jobs.map(job => job.sources.before?.revision)).toEqual(["a", "c"]);
  worker.respond({ id: worker.jobs[0]!.id, result: tokens() });
  expect(f.results.filter(Boolean)).toHaveLength(0);
  worker.finish();
  expect(f.results.filter(Boolean)).toHaveLength(1);
  f.service.dispose();
});

test("a new debounce removes older pending work before its timer fires", () => {
  const f = fixture();
  f.request(sources("a")); f.clock.advance(50);
  f.request(sources("b")); f.clock.advance(50);
  f.request(sources("c"));
  f.workers[0]!.finish();
  expect(f.workers[0]!.jobs).toHaveLength(1);
  f.clock.advance(100);
  expect(f.workers[0]!.jobs.at(-1)!.sources.before?.revision).toBe("c");
  f.service.dispose();
});

test("cache uses immutable revision, both paths, null sides and theme; cached data is frozen", () => {
  const f = fixture();
  f.request(sources()); f.clock.advance(100);
  f.workers[0]!.finish();
  const result = f.results.at(-1)!;
  expect(Object.isFrozen(result.before![0]![0])).toBe(true);
  expect(Object.isFrozen(result.before)).toBe(true);
  f.request(sources("a", "file.ts", "immutable identity")); f.clock.advance(100);
  expect(f.results.at(-1)).toBe(result);
  expect(f.workers[0]!.jobs).toHaveLength(1);
  f.request(sources("a", "file.js")); f.clock.advance(100);
  expect(f.workers[0]!.jobs).toHaveLength(2);
  expect(syntaxSourceKey(sources())).toContain("github-dark");
  expect(syntaxSourceKey({ before: null, after: sources().before })).not.toBe(syntaxSourceKey(sources()));
  f.service.dispose();
});

test("cache evicts least recently used entries at four results", () => {
  const f = fixture();
  for (const revision of ["a", "b", "c", "d"]) {
    f.request(sources(revision)); f.clock.advance(100); f.workers[0]!.finish();
  }
  f.request(sources("a")); f.clock.advance(100);
  f.request(sources("e")); f.clock.advance(100); f.workers[0]!.finish();
  f.request(sources("b")); f.clock.advance(100);
  expect(f.workers[0]!.jobs).toHaveLength(6);
  f.service.dispose();
});

test("cache enforces total 200k token budget and rejects results over 100k", () => {
  const f = fixture();
  for (const revision of ["a", "b", "c"]) {
    f.request(sources(revision)); f.clock.advance(100); f.workers[0]!.finish(tokens(80_000));
  }
  f.request(sources("a")); f.clock.advance(100);
  expect(f.workers[0]!.jobs).toHaveLength(4);
  f.workers[0]!.finish(tokens(100_001));
  expect(f.results.at(-1)).toBeUndefined();
  f.request(sources("a")); f.clock.advance(100);
  expect(f.workers[0]!.jobs).toHaveLength(5);
  f.service.dispose();
});

test("5s timeout terminates worker and immediately starts newest pending on a replacement", () => {
  const f = fixture();
  f.request(sources("a")); f.clock.advance(100);
  const oldHandler = f.workers[0]!.onmessage!;
  f.request(sources("b")); f.clock.advance(100);
  f.clock.advance(4_799);
  expect(f.workers).toHaveLength(1);
  f.clock.advance(1);
  expect(f.workers[0]!.terminated).toBe(true);
  expect(f.workers).toHaveLength(2);
  oldHandler({ data: { id: 1, result: tokens() } });
  expect(f.results.filter(Boolean)).toHaveLength(0);
  f.workers[1]!.finish();
  expect(f.results.filter(Boolean)).toHaveLength(1);
  f.service.dispose();
  expect(f.clock.tasks.size).toBe(0);
});

test("worker errors, message errors, returned failure and construction/post failures recover", () => {
  for (const kind of ["onerror", "onmessageerror"] as const) {
    const f = fixture();
    f.request(sources("a")); f.clock.advance(100);
    f.request(sources("b")); f.clock.advance(100);
    f.workers[0]![kind]!();
    expect(f.workers[0]!.terminated).toBe(true);
    f.workers[1]!.respond({ id: f.workers[1]!.jobs[0]!.id, error: "failure" });
    expect(f.results.at(-1)).toBeUndefined();
    f.request(sources("c")); f.clock.advance(100); f.workers[1]!.finish();
    expect(f.results.filter(Boolean)).toHaveLength(1);
    f.service.dispose();
  }
  for (const failure of ["construct", "post"]) {
    const clock = new Clock();
    const worker = new FakeWorker();
    let first = true;
    const service = new SyntaxService(() => {
      if (first) {
        first = false;
        if (failure === "construct") throw new Error("unavailable");
        const broken = new FakeWorker();
        broken.postMessage = () => { throw new Error("clone"); };
        return broken;
      }
      return worker;
    }, clock);
    service.request(sources("a"), () => {}); clock.advance(100);
    service.request(sources("b"), () => {}); clock.advance(100);
    expect(worker.jobs).toHaveLength(1);
    service.dispose();
  }
});

test("undefined, cancellation and UTF-8 source limits prevent pending work and stale publication", () => {
  const f = fixture();
  const cancel = f.request(sources()); cancel(); f.clock.advance(100);
  expect(f.workers).toHaveLength(1);
  f.workers[0]!.finish();
  expect(f.results.filter(Boolean)).toHaveLength(0);
  f.request(sources("a", "f", "é".repeat(524_289))); f.clock.advance(100);
  f.request({ before: null, after: { revision: "a", path: "f", text: "x".repeat(1_048_577) } });
  f.clock.advance(100);
  expect(f.workers[0]!.jobs).toHaveLength(1);
  f.request(sources()); f.clock.advance(100);
  f.request(undefined); f.workers[0]!.finish();
  expect(f.results.filter(Boolean)).toHaveLength(0);
  f.service.dispose();
});

test("adapter tokenizes full before and after independently and enforces budgets", async () => {
  const calls: string[] = [];
  const input = { before: sources().before, after: sources("b", "other.js", "after\nfull").before };
  const result = await tokenizeSyntaxSources(input, { tokenize: async (text, path) => {
    calls.push(`${path}:${text}`); return [[{ text }]];
  } });
  expect(calls).toEqual(["file.ts:const x = 1;", "other.js:after\nfull"]);
  expect(result.after![0]![0]!.text).toBe("after\nfull");
  await expect(tokenizeSyntaxSources(input, { tokenize: async () => tokens(60_000).before! })).rejects.toThrow("budget");
  await expect(tokenizeSyntaxSources(sources("a", "f", "x".repeat(1_048_577)), {
    tokenize: async () => { throw new Error("must not run"); },
  })).rejects.toThrow("source budget");
});

test("Shiki lazy bundled grammar and theme produce plain tokens; unknown paths preserve plaintext", async () => {
  const tokenizer = createSyntaxTokenizer();
  expect(await tokenizer.tokenize("<unsafe>\r\nlast\n", "file.unknown-language"))
    .toEqual([[{ text: "<unsafe>" }], [{ text: "last" }], [{ text: "" }]]);
  const code = "/* open\nclose */\nconst x = 1;\n";
  const lines = await tokenizer.tokenize(code, "file.ts");
  expect(lines.map(line => line.map(token => token.text).join("")).join("\n")).toBe(code);
  expect(lines[1]!.some(token => token.color)).toBe(true);
  expect(lines.flat().every(token => Object.keys(token).every(key => key === "text" || key === "color"))).toBe(true);
  expect((await tokenizer.tokenize("const x = 1", "file.js")).flat().some(token => token.color)).toBe(true);
});

test("hook is inert during server rendering", () => {
  function Component() { return createElement("span", null, String(useSyntaxHighlighting(sources()))); }
  expect(renderToStaticMarkup(createElement(Component))).toBe("<span>undefined</span>");
});
