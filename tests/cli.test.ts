import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseLaunchOptions } from "../src/server/cli";

const cwd = process.cwd();
const parse = (args: string[], env: Record<string, string | undefined> = {}, development = false) =>
  parseLaunchOptions(args, env, cwd, development);

test("launch defaults preserve production and development ports", () => {
  expect(parse([])).toEqual({ port: 9171, directory: cwd });
  expect(parse([], {}, true)).toEqual({ port: 3000, directory: cwd });
});

test("help and version exit without evaluating environment configuration", () => {
  for (const flag of ["--help", "-h"]) expect(parse([flag], { GITUDIUM_PORT: "bad" })).toBe("help");
  for (const flag of ["--version", "-v"]) expect(parse([flag])).toBe("version");
});

test("environment configuration and command-line precedence", () => {
  const env = { GITUDIUM_PORT: "4321", GITUDIUM_DIRECTORY: "tests" };
  expect(parse([], env)).toEqual({ port: 4321, directory: resolve(cwd, "tests") });
  expect(parse(["--port=1234", "--directory=src"], env)).toEqual({ port: 1234, directory: resolve(cwd, "src") });
  expect(parse(["-p", "65535", "-d", "src"], env)).toEqual({ port: 65535, directory: resolve(cwd, "src") });
  expect(parse(["tests"], env)).toEqual({ port: 4321, directory: resolve(cwd, "tests") });
  expect(parse(["--", "-repo"])).toEqual({ port: 9171, directory: resolve(cwd, "-repo") });
  expect(parse(["--port", "0"])).toEqual({ port: 0, directory: cwd });
});

test("rejects malformed ports, unknown flags, missing values, and ambiguous directories", () => {
  for (const port of ["", "-1", "65536", "1.5", "1e3", "abc", " 123", "999999999999999999999"]) {
    expect(() => parse([`--port=${port}`])).toThrow();
    expect(() => parse([], { GITUDIUM_PORT: port })).toThrow();
  }
  for (const args of [["--host", "0.0.0.0"], ["--port"], ["--directory"], ["a", "b"], ["-d", "a", "b"], ["--directory="]]) {
    expect(() => parse(args)).toThrow();
  }
  expect(() => parse([], { GITUDIUM_DIRECTORY: "" })).toThrow();
  expect(() => parse(["-p", "0"], {}, true)).toThrow();
});
