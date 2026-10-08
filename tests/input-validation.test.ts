import { expect, test } from "bun:test";
import { GitRepositoryReader } from "../src/repository/git";
import { RepositoryError, type RepositoryReader } from "../src/repository/types";
import { appRouter } from "../src/server/router";

const revisions = [
  ["HEAD", true], ["refs/heads/main", true], ["HEAD~1", true], ["λ", true],
  ["a".repeat(1024), true], ["a".repeat(1025), false], ["", false], ["--all", false],
  ["a b", false], ["a\t", false], ["a\n", false], ["a\0", false], ["a\x7f", false],
  [null, false], [123, false],
] as const;
const paths = [
  ["file", true, true], ["dir/file", true, true], ["-option", true, true],
  [":(exclude) file", true, true], ["λ\t\nfile", true, true], ["a\\b", true, true],
  ["a".repeat(8192), true, true], ["a".repeat(8193), true, false],
  ["", false, false], ["/file", false, false], ["a\0b", false, false],
  ["a//b", false, false], ["a/", false, false], [".", false, false],
  ["..", false, false], ["a/./b", false, false], ["a/../b", false, false],
  [null, false, false], [123, false, false],
] as const;

async function readers() {
  const reader = await GitRepositoryReader.discover(process.cwd());
  (reader as unknown as { run: () => Promise<string> }).run = async () => {
    throw new RepositoryError("GIT_FAILED", "fixture resolution failure");
  };
  const accepted = async () => { throw new Error("accepted input"); };
  const apiReader = { commit: accepted, diff: accepted } as unknown as RepositoryReader;
  return { reader, api: appRouter.createCaller({ reader: async () => apiReader }) };
}

test("revision validation preserves reader and API boundaries and layer-specific errors", async () => {
  const { reader, api } = await readers();
  for (const [revision, valid] of revisions) {
    await expect(reader.commit(revision as string)).rejects.toMatchObject(valid
      ? { code: "REVISION_NOT_FOUND", message: "Revision does not resolve to a commit." }
      : { code: "INVALID_INPUT", message: "Expected a non-option revision naming one commit." });
    await expect(api.commit({ revision: revision as string })).rejects.toMatchObject(valid
      ? { message: "accepted input" } : { code: "BAD_REQUEST" });
  }
  await expect(api.commit({ revision: "--all" })).rejects.toThrow("Expected a non-option revision.");
});

test("literal path validation preserves the API-only length cap and layer-specific errors", async () => {
  const { reader, api } = await readers();
  for (const [path, readerValid, apiValid] of paths) {
    await expect(reader.diff("HEAD", path as string)).rejects.toMatchObject(readerValid
      ? { code: "REVISION_NOT_FOUND" }
      : { code: "INVALID_INPUT", message: "Expected a repository-relative literal file path." });
    await expect(api.diff({ revision: "HEAD", path: path as string })).rejects.toMatchObject(apiValid
      ? { message: "accepted input" } : { code: "BAD_REQUEST" });
  }
  await expect(reader.diff("HEAD")).rejects.toMatchObject({ code: "REVISION_NOT_FOUND" });
  await expect(api.diff({ revision: "HEAD" })).rejects.toThrow("accepted input");
  await expect(api.diff({ revision: "HEAD", path: "../file" })).rejects.toThrow("Expected a repository-relative path.");
});
