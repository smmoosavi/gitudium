import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { useViewerPreferences } from "../src/client/useViewerPreferences";
import { defaultLayout, layoutStorageKey } from "../src/client/layout";
import { diffStorageKey, wrapStorageKey, pairingStorageKey, whitespaceStorageKey } from "../src/client/diff";
import { filesStorageKey } from "../src/client/files";
import { readPreference, writePreference, viewerPreferences, type Preference } from "../src/client/preferences";
import { usePreference } from "../src/client/usePreference";

function Preferences() {
  const { wrap, filesMode, diffMode, layout } = useViewerPreferences();
  return <span>{JSON.stringify({ wrap, filesMode, diffMode, layout })}</span>;
}

test("preference initialization survives blocked localStorage property access and methods", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const expected = renderToStaticMarkup(<span>{JSON.stringify({ wrap: false, filesMode: "list", diffMode: "unified", layout: defaultLayout() })}</span>);
  try {
    for (const window of [
      { get localStorage(): Storage { throw new Error("blocked property"); } },
      { localStorage: { getItem() { throw new Error("blocked method"); } } },
    ]) {
      Object.defineProperty(globalThis, "window", { configurable: true, value: window });
      expect(renderToStaticMarkup(<Preferences />)).toBe(expected);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

function DiffPreferences() {
  const [pairLines] = usePreference(viewerPreferences.pairLines);
  const [whitespace] = usePreference(viewerPreferences.whitespace);
  return <span>{JSON.stringify({ pairLines, whitespace })}</span>;
}

test("shared preferences preserve existing keys and encodings", () => {
  const values = new Map<string, string>();
  const storage = () => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
  writePreference(viewerPreferences.wrap, true, storage);
  writePreference(viewerPreferences.filesMode, "tree", storage);
  writePreference(viewerPreferences.diffMode, "split", storage);
  writePreference(viewerPreferences.layout, defaultLayout(), storage);
  writePreference(viewerPreferences.pairLines, true, storage);
  writePreference(viewerPreferences.whitespace, "all", storage);
  expect(Object.fromEntries(values)).toEqual({
    [wrapStorageKey]: "true", [filesStorageKey]: "tree", [diffStorageKey]: "split",
    [layoutStorageKey]: JSON.stringify(defaultLayout()), [pairingStorageKey]: "true", [whitespaceStorageKey]: "all",
  });
  expect(readPreference(viewerPreferences.wrap, storage)).toBe(true);
  expect(readPreference(viewerPreferences.filesMode, storage)).toBe("tree");
  expect(readPreference(viewerPreferences.diffMode, storage)).toBe("split");
  expect(readPreference(viewerPreferences.layout, storage)).toEqual(defaultLayout());
  expect(readPreference(viewerPreferences.pairLines, storage)).toBe(true);
  expect(readPreference(viewerPreferences.whitespace, storage)).toBe("all");
});

test("generic preferences tolerate storage resolution, reader, and writer failures", () => {
  const preference: Preference<string[]> = {
    defaultValue: () => [],
    read: () => { throw new Error("invalid data"); },
    write: () => { throw new Error("quota"); },
  };
  const storage = () => ({ getItem: () => null, setItem: () => {} });
  const blocked = () => { throw new Error("blocked property"); };
  expect(readPreference(preference, storage)).toEqual([]);
  expect(readPreference(preference, blocked)).toEqual([]);
  expect(readPreference(preference, blocked)).not.toBe(readPreference(preference, blocked));
  expect(() => writePreference(preference, [], storage)).not.toThrow();
  expect(() => writePreference(preference, [], blocked)).not.toThrow();
});

test("hooks restore existing preferences without requiring browser access during import", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => ({
      [wrapStorageKey]: "true", [filesStorageKey]: "tree", [diffStorageKey]: "split",
      [pairingStorageKey]: "true", [whitespaceStorageKey]: "trailing",
    })[key] ?? null } } });
    expect(renderToStaticMarkup(<Preferences />)).toBe(renderToStaticMarkup(<span>{JSON.stringify({ wrap: true, filesMode: "tree", diffMode: "split", layout: defaultLayout() })}</span>));
    expect(renderToStaticMarkup(<DiffPreferences />)).toBe(renderToStaticMarkup(<span>{JSON.stringify({ pairLines: true, whitespace: "all" })}</span>));
    Reflect.deleteProperty(globalThis, "window");
    expect(renderToStaticMarkup(<DiffPreferences />)).toBe(renderToStaticMarkup(<span>{JSON.stringify({ pairLines: false, whitespace: "none" })}</span>));
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("saved ref exclusions validate storage and preserve comma-separated settings", () => {
  const storage = (value: string | null) => () => ({ getItem: () => value, setItem: () => {} });
  expect(readPreference(viewerPreferences.refExclusions, storage("refs/agents/*, foo, bar"))).toBe("refs/agents/*, foo, bar");
  for (const value of [null, "--all", "!main", "foo bar", "foo\n", "a".repeat(1025)]) {
    expect(readPreference(viewerPreferences.refExclusions, storage(value))).toBe("");
  }
  expect(readPreference(viewerPreferences.refExclusions, () => { throw new Error("blocked"); })).toBe("");
});
