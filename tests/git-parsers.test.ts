import { expect, test } from "bun:test";
import { parseReferences, referenceNames, parseSummaries, parseDetails, parseChangedFiles, parseNumstat } from "../src/repository/parsers";

const fields = ["commit", "short", "parent1 parent2", "", "Name", "mail", "2026-01-01T00:00:00Z"];
const record = (values: string[]) => values.join("\0") + "\0";

test("reference parsers preserve ordering, symbolic targets and one-level tag peeling", () => {
  const output = [
    ["refs/heads/main", "commit", "commit", "", "", ""],
    ["refs/remotes/origin/HEAD", "commit", "commit", "", "", "refs/remotes/origin/main"],
    ["refs/tags/tag", "tag", "tag", "commit", "commit", ""],
    ["refs/tags/nested", "outer", "tag", "tag", "tag", ""],
    ["refs/tags/blob", "blob", "blob", "", "", ""],
    ["refs/agents/session", "agent", "commit", "", "", ""],
  ].map(row => row.join("\0")).join("\n") + "\n";
  const refs = parseReferences(output);
  expect(refs.map(ref => ref.kind)).toEqual(["branch", "remote", "tag", "tag", "tag", "other"]);
  expect(refs[1].symbolicTarget).toBe("refs/remotes/origin/main");
  expect(refs.slice(3).map(ref => ref.commitId)).toEqual([null, null, "agent"]);
  expect(referenceNames(refs).get("commit")).toEqual(refs.slice(0, 3).map(ref => ref.name));
  expect(parseReferences("")).toEqual([]);
});

test("summary and detail parsers retain empty subjects, roots, merges and multiline messages", () => {
  const refs = new Map([["commit", ["first", "second"]]]);
  const commits = parseSummaries(record(fields) + record(["root", "root", "", "root", "", "", fields[6]]), refs);
  expect(commits[0]).toMatchObject({ subject: "", parents: ["parent1", "parent2"], references: ["first", "second"] });
  expect(commits[1]).toMatchObject({ parents: [], references: [], author: { name: "", email: "" } });
  const details = parseDetails(record([...fields, "Committer", "mail", fields[6], "subject\n\nbody\twith unicode λ\n"]), refs);
  expect(details.message).toBe("subject\n\nbody\twith unicode λ\n");
  expect(details.diffBase).toBe("parent1");
  expect(details.committer.name).toBe("Committer");
  expect(parseDetails(record(["root", "root", "", "", "", "", fields[6], "", "", fields[6], ""]), refs).diffBase).toBeNull();
  expect(parseSummaries("", refs)).toEqual([]);
});

test("changed-file parser preserves literal whitespace, Unicode and option-like paths", () => {
  const paths = ["space name", "tab\tand\nnewline", "λ/file", "-option"];
  expect(parseChangedFiles(record(["A", paths[0], "M", paths[1], "D", paths[2], "T", paths[3]]))).toEqual(
    paths.map((path, index) => ({ path, previousPath: null, status: (["added", "modified", "deleted", "type-changed"] as const)[index] })),
  );
  expect(parseChangedFiles("")).toEqual([]);
  for (const status of ["R100", "toString", "__proto__"]) {
    expect(() => parseChangedFiles(record([status, "file"]))).toThrow("Unsupported changed-file status.");
  }
});

test("numstat preserves literal paths and maps renames and copies by destination", () => {
  expect([...parseNumstat(record([
    "12\t3\t-odd\tline\n☃", "0\t0\t", "old\t\nname", "new\t\nname",
    "2\t1\t", "source", "copy", "-\t-\tbinary", "0\t5\tdeleted",
  ]))]).toEqual([
    ["-odd\tline\n☃", { additions: 12, deletions: 3 }],
    ["new\t\nname", { additions: 0, deletions: 0 }],
    ["copy", { additions: 2, deletions: 1 }],
    ["binary", { additions: null, deletions: null }],
    ["deleted", { additions: 0, deletions: 5 }],
  ]);
  expect(parseNumstat("").size).toBe(0);
});

test("numstat rejects malformed counts and truncated rename records", () => {
  for (const output of ["1\t0\tfile", "1\t0\t\0source\0", "1\t0\t\0\0dest\0",
    "-\t1\tfile\0", "1\t-\tfile\0", "NaN\t0\tfile\0", "1.5\t0\tfile\0",
    "-1\t0\tfile\0", "9007199254740992\t0\tfile\0", "1\t0\tfile\0extra\0",
    "1\t0\tfile\0".repeat(2)]) {
    expect(() => parseNumstat(output)).toThrow("Malformed Git output.");
  }
});

test("malformed or truncated parser records fail explicitly with GIT_FAILED", () => {
  const refs = new Map<string, string[]>();
  const invalid = [
    () => parseReferences("refs/heads/main\0id\0commit\n"),
    () => parseReferences("\0id\0commit\0\0\0"),
    () => parseSummaries(fields.join("\0"), refs),
    () => parseSummaries(record(fields.slice(0, 6)), refs),
    () => parseSummaries(record(["", ...fields.slice(1)]), refs),
    () => parseDetails("", refs),
    () => parseDetails(record(fields), refs),
    () => parseDetails(record([...fields, "", "", fields[6], "body"]) + "extra", refs),
    () => parseChangedFiles("A\0file"),
    () => parseChangedFiles("A\0"),
    () => parseChangedFiles(record(["A", ""])),
  ];
  for (const parse of invalid) {
    try { parse(); throw new Error("Expected failure"); } catch (error) {
      expect(error).toMatchObject({ code: "GIT_FAILED", message: "Malformed Git output." });
    }
  }
});
