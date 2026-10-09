import { expect, spyOn, test } from "bun:test";
import { GitRunner, type GitProcess, type GitSpawn } from "../src/repository/runner";

function processFixture(stdout = "ok", stderr = "", status = 0, deferred = false) {
  let out!: ReadableStreamDefaultController<Uint8Array>;
  let err!: ReadableStreamDefaultController<Uint8Array>;
  let resolve!: (status: number) => void;
  let kills = 0;
  let cancellations = 0;
  const stream = (capture: (controller: ReadableStreamDefaultController<Uint8Array>) => void) => new ReadableStream<Uint8Array>({
    start: capture, cancel: () => { cancellations++; },
  });
  const child: GitProcess = {
    stdout: stream(controller => { out = controller; }), stderr: stream(controller => { err = controller; }),
    exited: new Promise<number>(done => { resolve = done; }), exitCode: null,
    kill: () => { kills++; finish(143); },
  };
  const finish = (code = status) => {
    if (child.exitCode !== null) return;
    child.exitCode = code;
    try { out.close(); } catch { /* An output cap may already cancel the stream. */ }
    try { err.close(); } catch { /* An output cap may already cancel the stream. */ }
    resolve(code);
  };
  if (stdout) out.enqueue(Buffer.from(stdout));
  if (stderr) err.enqueue(Buffer.from(stderr));
  if (!deferred) finish();
  return { child, finish, kills: () => kills, cancellations: () => cancellations };
}

function trackedSignal() {
  const controller = new AbortController();
  const added: unknown[] = [], removed: unknown[] = [];
  const signal = controller.signal;
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (...args: Parameters<AbortSignal["addEventListener"]>) => { added.push(args[1]); add(...args); };
  signal.removeEventListener = (...args: Parameters<AbortSignal["removeEventListener"]>) => { removed.push(args[1]); remove(...args); };
  return { controller, signal, added, removed };
}

async function slotsAvailable(runner: GitRunner) {
  expect(await Promise.all(Array.from({ length: 4 }, () => runner.run(["probe"])))).toEqual(["ok", "ok", "ok", "ok"]);
}

test("runner preserves argument arrays, environment filtering, stdin and successful cleanup", async () => {
  const previous = process.env.GIT_RUNNER_TEST;
  process.env.GIT_RUNNER_TEST = "excluded";
  const signals = trackedSignal();
  const child = processFixture("λ\n");
  const spawn: GitSpawn = (command, options) => {
    expect(command).toEqual(["git", "--no-pager", "--no-replace-objects", "--literal-pathspecs", "-c", "color.ui=false", "-c", "core.quotePath=false", "show", "literal path"]);
    expect(options.cwd).toBe("/fixture");
    expect(options.env.GIT_RUNNER_TEST).toBeUndefined();
    expect(options.env).toMatchObject({ GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" });
    expect(options.stdin).toEqual(Buffer.from("input\n"));
    return child.child;
  };
  try {
    expect(await new GitRunner("/fixture", spawn).run(["show", "literal path"], signals.signal, 100, "input\n")).toBe("λ\n");
    expect(signals.removed).toEqual(signals.added);
    expect(child.kills()).toBe(0);
    expect(child.child.stdout.locked).toBe(false);
    expect(child.child.stderr.locked).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.GIT_RUNNER_TEST;
    else process.env.GIT_RUNNER_TEST = previous;
  }
});

test("runner normalizes spawn and exit failures and releases concurrency slots", async () => {
  for (const failure of ["spawn", "exit"] as const) {
    let failed = false;
    const runner = new GitRunner("/fixture", (_command, options) => {
      expect(options.stdin).toBe("ignore");
      if (!failed) {
        failed = true;
        if (failure === "spawn") throw new Error("start failed");
        return processFixture("", "private stderr", 1).child;
      }
      return processFixture().child;
    });
    const signals = trackedSignal();
    await expect(runner.run(["probe"], signals.signal)).rejects.toMatchObject({ code: failure === "spawn" ? "GIT_UNAVAILABLE" : "GIT_FAILED" });
    if (failure === "exit") expect(signals.removed).toEqual(signals.added);
    await slotsAvailable(runner);
  }
});

test("runner kills and cleans up on cancellation including the spawn/abort race", async () => {
  for (const race of [false, true]) {
    const signals = trackedSignal();
    const child = processFixture("", "", 0, true);
    let first = true;
    const runner = new GitRunner("/fixture", () => {
      if (!first) return processFixture().child;
      first = false;
      if (race) signals.controller.abort();
      return child.child;
    });
    const pending = runner.run(["probe"], signals.signal);
    if (!race) signals.controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(child.kills()).toBe(1);
    expect(signals.removed).toEqual(signals.added);
    expect(child.child.stdout.locked).toBe(false);
    expect(child.child.stderr.locked).toBe(false);
    await slotsAvailable(runner);
  }
});

test("runner limits stdout bytes and stderr independently and releases resources", async () => {
  for (const stderr of [false, true]) {
    const child = processFixture(stderr ? "" : "λλ", stderr ? "x".repeat(65537) : "", 0, true);
    let first = true;
    const runner = new GitRunner("/fixture", () => {
      if (!first) return processFixture().child;
      first = false;
      return child.child;
    });
    const signals = trackedSignal();
    await expect(runner.run(["probe"], signals.signal, 3)).rejects.toMatchObject({ code: "OUTPUT_LIMIT" });
    expect(child.kills()).toBe(1);
    expect(child.child.exitCode).not.toBeNull();
    expect(child.child.stdout.locked).toBe(false);
    expect(child.child.stderr.locked).toBe(false);
    expect(signals.removed).toEqual(signals.added);
    await slotsAvailable(runner);
  }
});

test("runner rejects pre-aborted operations and a fifth concurrent process without spawning", async () => {
  const children = Array.from({ length: 4 }, () => processFixture("ok", "", 0, true));
  let spawned = 0;
  const runner = new GitRunner("/fixture", () => children[spawned++]!.child);
  const controller = new AbortController(); controller.abort();
  await expect(runner.run(["probe"], controller.signal)).rejects.toMatchObject({ code: "CANCELLED" });
  expect(spawned).toBe(0);
  const pending = children.map(() => runner.run(["probe"]));
  await expect(runner.run(["probe"])).rejects.toMatchObject({ code: "BUSY" });
  expect(spawned).toBe(4);
  children.forEach(child => child.finish());
  expect(await Promise.all(pending)).toEqual(["ok", "ok", "ok", "ok"]);
});

test("runner terminates a still-running child when output collection fails", async () => {
  const child = processFixture("", "", 0, true);
  child.child.stdout = new ReadableStream({ start: controller => controller.error(new Error("stream failure")) });
  const signals = trackedSignal();
  let first = true;
  const runner = new GitRunner("/fixture", () => {
    if (!first) return processFixture().child;
    first = false;
    return child.child;
  });
  await expect(runner.run(["probe"], signals.signal)).rejects.toThrow("stream failure");
  expect(child.kills()).toBe(1);
  expect(child.child.exitCode).not.toBeNull();
  expect(child.child.stdout.locked).toBe(false);
  expect(child.child.stderr.locked).toBe(false);
  expect(signals.removed).toEqual(signals.added);
  await slotsAvailable(runner);
});

test("runner preserves primary failures and releases slots after cleanup failures", async () => {
  for (const failure of ["kill", "exited"] as const) {
    const primary = new Error("stream failure");
    const secondary = new Error("cleanup failure");
    const child = processFixture("", "", 0, true);
    child.child.stdout = new ReadableStream({ start: controller => controller.error(primary) });
    if (failure === "kill") child.child.kill = () => { throw secondary; };
    else child.child.kill = () => { child.child.exited = Promise.reject(secondary); };
    const signals = trackedSignal();
    let first = true;
    const runner = new GitRunner("/fixture", () => {
      if (!first) return processFixture().child;
      first = false;
      return child.child;
    });
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(runner.run(["probe"], signals.signal)).rejects.toBe(primary);
      expect(warning).toHaveBeenCalled();
      expect(signals.removed).toEqual(signals.added);
      expect(child.child.stdout.locked).toBe(false);
      expect(child.child.stderr.locked).toBe(false);
      await slotsAvailable(runner);
    } finally {
      warning.mockRestore();
      child.finish();
    }
  }
});

test("runner settles delayed stream cancellation before releasing its slot", async () => {
  let cancelled!: () => void;
  const cancellationStarted = new Promise<void>(resolve => { cancelled = resolve; });
  let complete!: () => void;
  const delayed = new Promise<void>(resolve => { complete = resolve; });
  const child = processFixture("", "", 0, true);
  child.child.stdout = new ReadableStream({ start: controller => controller.error(new Error("stream failure")) });
  child.child.stderr = new ReadableStream({ cancel: () => { cancelled(); return delayed; } });
  const signals = trackedSignal();
  let first = true;
  const runner = new GitRunner("/fixture", () => {
    if (!first) return processFixture().child;
    first = false;
    return child.child;
  });
  let settled = false;
  const pending = runner.run(["probe"], signals.signal).catch(error => { settled = true; return error; });
  await cancellationStarted;
  expect(settled).toBe(false);
  complete();
  expect(await pending).toMatchObject({ message: "stream failure" });
  expect(child.child.stdout.locked).toBe(false);
  expect(child.child.stderr.locked).toBe(false);
  expect(signals.removed).toEqual(signals.added);
  await slotsAvailable(runner);
});

test("runner cancellation and output limits survive throwing termination", async () => {
  for (const cancellation of [true, false]) {
    const child = processFixture(cancellation ? "" : "oversized", "", 0, true);
    child.child.kill = () => { throw new Error("termination failed"); };
    const signals = trackedSignal();
    let first = true;
    const runner = new GitRunner("/fixture", () => {
      if (!first) return processFixture().child;
      first = false;
      return child.child;
    });
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const pending = runner.run(["probe"], signals.signal, 1);
      if (cancellation) signals.controller.abort();
      await expect(pending).rejects.toMatchObject({ code: cancellation ? "CANCELLED" : "OUTPUT_LIMIT" });
      expect(warning).toHaveBeenCalled();
      expect(signals.removed).toEqual(signals.added);
      expect(child.child.stdout.locked).toBe(false);
      expect(child.child.stderr.locked).toBe(false);
      await slotsAvailable(runner);
    } finally {
      warning.mockRestore();
      child.finish();
    }
  }
});

test("runner releases slots and cancels open streams when exit waiting rejects", async () => {
  const failure = new Error("exit wait failed");
  const child = processFixture("", "", 0, true);
  child.child.exited = Promise.reject(failure);
  const signals = trackedSignal();
  let first = true;
  const runner = new GitRunner("/fixture", () => {
    if (!first) return processFixture().child;
    first = false;
    return child.child;
  });
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  try {
    await expect(runner.run(["probe"], signals.signal)).rejects.toBe(failure);
    expect(warning).toHaveBeenCalled();
    expect(signals.removed).toEqual(signals.added);
    expect(child.child.stdout.locked).toBe(false);
    expect(child.child.stderr.locked).toBe(false);
    await slotsAvailable(runner);
  } finally {
    warning.mockRestore();
    child.finish();
  }
});

test("runner drains output arriving after process exit", async () => {
  let output!: ReadableStreamDefaultController<Uint8Array>;
  const child = processFixture("", "", 0);
  child.child.stdout = new ReadableStream({ start: controller => { output = controller; } });
  const runner = new GitRunner("/fixture", () => child.child);
  const pending = runner.run(["probe"]);
  output.enqueue(Buffer.from("late output"));
  output.close();
  expect(await pending).toBe("late output");
  expect(child.child.stdout.locked).toBe(false);
  expect(child.kills()).toBe(0);
});

test("runner cleans up timed-out operations and allows later commands", async () => {
  const child = processFixture("", "", 0, true);
  let first = true;
  const runner = new GitRunner("/fixture", () => {
    if (!first) return processFixture().child;
    first = false;
    return child.child;
  });
  await expect(runner.run(["probe"], AbortSignal.timeout(1))).rejects.toMatchObject({ code: "CANCELLED" });
  expect(child.kills()).toBe(1);
  expect(child.child.stdout.locked).toBe(false);
  expect(child.child.stderr.locked).toBe(false);
  await slotsAvailable(runner);
});
