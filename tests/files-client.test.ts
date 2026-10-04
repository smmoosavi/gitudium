import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChangedFile } from "../src/repository/types";
import { ChangedFiles } from "../src/client/ChangedFiles";
import { buildFileTree, filesStorageKey, readFilesMode, writeFilesMode } from "../src/client/files";

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
