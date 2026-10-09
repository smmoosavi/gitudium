import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChangedFile } from "../src/repository/types";
import { ChangedFiles } from "../src/client/ChangedFiles";
import { buildFileTree, filePaths, filesStorageKey, readFilesMode, writeFilesMode } from "../src/client/files";

const files: ChangedFile[] = ["root.ts", "src/z.ts", "src/nested/a.ts", "src/a.ts", "tests/a.ts"].map(path => ({ path, status: "modified", previousPath: null }));

test("file tree groups folders first without losing paths or merging equal basenames", () => {
  const tree = buildFileTree(files);
  expect(tree.map(node => node.name)).toEqual(["src", "tests", "root.ts"]);
  const src = tree[0]!;
  expect("children" in src && src.children.map(node => node.name)).toEqual(["nested", "a.ts", "z.ts"]);
  expect(buildFileTree([])).toEqual([]);
  expect(files[0]!.path).toBe("root.ts");
  const unusual = buildFileTree([{ ...files[0]!, path: "__proto__/constructor.ts" }]);
  expect(unusual[0]!.name).toBe("__proto__");
});

test("default file selection follows display order for each commit", () => {
  expect(filePaths(files, "list")).toEqual(files.map(file => file.path));
  expect(filePaths(files, "tree")).toEqual(["src/nested/a.ts", "src/a.ts", "src/z.ts", "tests/a.ts", "root.ts"]);
  for (const mode of ["list", "tree"] as const) {
    for (const changedFiles of [files, files.slice(1), files.slice(3), []]) {
      const selected = filePaths(changedFiles, mode)[0] ?? null;
      const html = renderToStaticMarkup(createElement(ChangedFiles, { files: changedFiles, mode, selected, onSelect: () => {} }));
      expect(html.match(/aria-pressed="true"/g)?.length ?? 0).toBe(changedFiles.length ? 1 : 0);
      if (selected) expect(html.indexOf('aria-pressed="true"')).toBeLessThan(html.indexOf("</button>"));
    }
  }
});

test("list and tree preserve selection and status, with collapsible tree folders", () => {
  for (const mode of ["tree", "list"] as const) {
    const html = renderToStaticMarkup(createElement(ChangedFiles, { files, mode, selected: "src/a.ts", onSelect: () => {} }));
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(html.match(/<button/g)?.length).toBe(files.length);
    expect(html).toContain('title="src/a.ts"');
    expect(html).toContain('file-status modified');
    if (mode === "tree") { expect(html).toContain("<details open"); expect(html).toContain("<summary"); }
    else { expect(html).not.toContain("<details"); expect(html).toContain("src/a.ts</code>"); }
  }
});

test("file summaries show counts, binary state and previous paths in both layouts", () => {
  const changed: ChangedFile[] = [
    { path: "src/new.ts", previousPath: "old/<name>.ts", status: "renamed", additions: 3, deletions: 2 },
    { path: "image.png", previousPath: null, status: "modified", additions: null, deletions: null },
    { path: "zero.ts", previousPath: null, status: "added", additions: 0, deletions: 0 },
    { path: "legacy.ts", previousPath: null, status: "modified" },
  ];
  for (const mode of ["list", "tree"] as const) {
    const html = renderToStaticMarkup(createElement(ChangedFiles, { files: changed, mode, selected: null, onSelect: () => {} }));
    expect(html).toContain("3 lines added, 2 lines deleted");
    expect(html).toContain("+3</span>");
    expect(html).toContain("−2</span>");
    expect(html).toContain("0 lines added, 0 lines deleted");
    expect(html).toContain("Binary file; line counts unavailable");
    expect(html).toContain("old/&lt;name&gt;.ts");
    expect(html).not.toContain("<name>");
    expect(html).not.toContain("undefined");
  }
});

test("file view preference persists with safe storage fallback", () => {
  let stored: string | null = null;
  const storage = { getItem: () => stored, setItem: (key: string, value: string) => { expect(key).toBe(filesStorageKey); stored = value; } };
  expect(readFilesMode(storage)).toBe("list");
  writeFilesMode(storage, "tree"); expect(readFilesMode(storage)).toBe("tree");
  writeFilesMode(storage, "list"); expect(readFilesMode(storage)).toBe("list");
  expect(readFilesMode({ getItem: () => "invalid" })).toBe("list");
  expect(readFilesMode({ getItem: () => { throw Error(); } })).toBe("list");
  expect(() => writeFilesMode({ setItem: () => { throw Error(); } }, "tree")).not.toThrow();
});
