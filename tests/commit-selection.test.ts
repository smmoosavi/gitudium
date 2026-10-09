import { expect, test } from "bun:test";
import { CommitSelection, type SelectionTimers } from "../src/client/commitSelection";

function fixture() {
  let now = 0;
  let next = 0;
  const tasks = new Map<number, { at: number; callback: () => void }>();
  const clock: SelectionTimers = {
    now: () => now,
    setTimeout: (callback, delay) => { const id = ++next; tasks.set(id, { at: now + delay, callback }); return id; },
    clearTimeout: handle => { tasks.delete(handle as number); },
  };
  const values: (string | null)[] = [];
  const selection = new CommitSelection(value => values.push(value), clock);
  const advance = (ms: number) => {
    now += ms;
    for (const [id, task] of tasks) if (task.at <= now) { tasks.delete(id); task.callback(); }
  };
  return { selection, values, advance, tasks };
}

test("first and slow selections load immediately", () => {
  const f = fixture();
  f.selection.select("a");
  expect(f.values).toEqual(["a"]);
  f.advance(150);
  f.selection.select("b");
  expect(f.values).toEqual(["a", "b"]);
  expect(f.tasks.size).toBe(0);
});

test("continuous navigation cancels previous details and only loads the latest after 100ms idle", () => {
  const f = fixture();
  f.selection.select("a");
  for (const value of ["b", "c", "d", "e"]) {
    f.advance(30);
    f.selection.select(value);
  }
  expect(f.values.filter(value => value !== null)).toEqual(["a"]);
  expect(f.tasks.size).toBe(1);
  f.advance(99);
  expect(f.values.at(-1)).toBeNull();
  f.advance(1);
  expect(f.values.at(-1)).toBe("e");
  expect(f.tasks.size).toBe(0);
});

test("duplicate focus and click selection does not restart the debounce", () => {
  const f = fixture();
  f.selection.select("a");
  f.selection.select("a");
  expect(f.values).toEqual(["a"]);
  f.advance(30);
  f.selection.select("b");
  f.advance(70);
  f.selection.select("b");
  f.advance(30);
  expect(f.values).toEqual(["a", null, "b"]);
});

test("clearing selection cancels pending details", () => {
  const f = fixture();
  f.selection.select("a");
  f.advance(30);
  f.selection.select("b");
  f.selection.select(null);
  const before = [...f.values];
  f.advance(200);
  expect(f.values).toEqual(before);
  expect(f.values.at(-1)).toBeNull();
});

test("unmount cancels timers and StrictMode replay can select the same commit", () => {
  const f = fixture();
  f.selection.select("a");
  f.advance(30);
  f.selection.select("b");
  f.selection.cancel();
  const before = [...f.values];
  f.advance(200);
  expect(f.values).toEqual(before);
  f.selection.select("b");
  expect(f.values.at(-1)).toBe("b");
  expect(f.tasks.size).toBe(0);
});
