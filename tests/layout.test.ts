import { expect, test } from "bun:test";
import { clampSize, defaultLayout, layoutStorageKey, readLayout, writeLayout } from "../src/client/layout";

test("layout defaults survive missing, malformed, and unavailable storage", () => {
  for (const raw of [null, "{", "null", "42", "{}", '{"mode":"invalid"}']) {
    expect(readLayout({ getItem: () => raw })).toEqual(defaultLayout());
  }
  expect(readLayout({ getItem: () => { throw new Error("blocked"); } })).toEqual(defaultLayout());
  expect(() => writeLayout({ setItem: () => { throw new Error("full"); } }, defaultLayout())).not.toThrow();
});

test("all layout modes retain their own persisted pane sizes", () => {
  const config = defaultLayout();
  config.mode = "bottom";
  config.sizes.columns = { primary: 25, secondary: 35 };
  config.sizes.left = { primary: 45, secondary: 65 };
  config.sizes.bottom = { primary: 60, secondary: 30 };
  let stored = "";
  writeLayout({ setItem: (key, value) => { expect(key).toBe(layoutStorageKey); stored = value; } }, config);
  expect(readLayout({ getItem: key => { expect(key).toBe(layoutStorageKey); return stored; } })).toEqual(config);
});

test("saved sizes are validated and constrained without discarding valid settings", () => {
  const config = readLayout({ getItem: () => JSON.stringify({ mode: "left", sizes: {
    columns: { primary: -10, secondary: 120 }, left: { primary: "50", secondary: null }, bottom: { primary: 65 },
  } }) });
  expect(config.mode).toBe("left");
  expect(config.sizes.columns).toEqual({ primary: 15, secondary: 85 });
  expect(config.sizes.left).toEqual(defaultLayout().sizes.left);
  expect(config.sizes.bottom).toEqual({ primary: 65, secondary: 40 });
  expect(clampSize(0)).toBe(15);
  expect(clampSize(100)).toBe(85);
  expect(clampSize(42)).toBe(42);
});
