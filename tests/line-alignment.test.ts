import { expect, test } from "bun:test";
import { createLineAligner } from "../src/client/lineAlignment";
import { pairedDiffEngine } from "../src/client/diffEngine";
import { readLinePairing, writeLinePairing, pairingStorageKey } from "../src/client/diff";
import { buildDiffModel, type DiffLine } from "../src/client/diffModel";

test("line pairing defaults off and persists with safe storage fallback", () => {
  let saved: string | null = null;
  const storage = { getItem: () => saved, setItem: (key: string, value: string) => { expect(key).toBe(pairingStorageKey); saved = value; } };
  expect(readLinePairing(storage)).toBe(false);
  writeLinePairing(storage, true); expect(readLinePairing(storage)).toBe(true);
  writeLinePairing(storage, false); expect(readLinePairing(storage)).toBe(false);
  saved = "invalid"; expect(readLinePairing(storage)).toBe(false);
  expect(readLinePairing({ getItem: () => { throw Error(); } })).toBe(false);
  expect(() => writeLinePairing({ setItem: () => { throw Error(); } }, true)).not.toThrow();
});

test("related lines align around inserted and removed setup", () => {
  const before = ["const count = 1;", "return count;"];
  const after = ["setup();", "const count = 2;", "return count;"];
  expect(createLineAligner()(before, after)).toEqual([{ after: 0 }, { before: 0, after: 1 }, { before: 1, after: 2 }]);
  expect(createLineAligner()(after, before)).toEqual([{ before: 0 }, { before: 1, after: 0 }, { before: 2, after: 1 }]);
});

test("unrelated edits remain unmatched and repeated lines have deterministic order", () => {
  expect(createLineAligner()(["apple();"], ["orange();"])).toEqual([{ before: 0 }, { after: 0 }]);
  expect(createLineAligner()(["}", "}", "finish();"], ["}", "finish();"])).toEqual([{ before: 0, after: 0 }, { before: 1 }, { before: 2, after: 1 }]);
  expect(createLineAligner()(["你好 世界 old", ""], ["你好 世界 new", ""])).toEqual([{ before: 0, after: 0 }, { before: 1, after: 1 }]);
});

test("reindented punctuation-only closing lines pair without pairing unrelated punctuation", () => {
  expect(createLineAligner()(["    }", "    };", "  },"], ["      }", "      };", "    },"])).toEqual([
    { before: 0, after: 0 }, { before: 1, after: 1 }, { before: 2, after: 2 },
  ]);
  expect(createLineAligner()(["    }", "    });", "  },"], ["      }", "      };", "    });", "  });"])).toEqual([
    { before: 0, after: 0 }, { after: 1 }, { before: 1, after: 2 }, { before: 2 }, { after: 3 },
  ]);
  expect(createLineAligner()(["  }"], ["    }"])).toEqual([{ before: 0, after: 0 }]);
  expect(createLineAligner()(["  });"], ["    };"])).toEqual([{ before: 0, after: 0 }]);
  expect(createLineAligner()(["  }"], ["    ["])).toEqual([{ before: 0 }, { after: 0 }]);
});

test("paired closing delimiters retain inline indentation and punctuation highlights", () => {
  const model = pairedDiffEngine("@@ -1,3 +1,3 @@\n-    }\n-    };\n-  },\n+      }\n+      };\n+    },\n");
  const rows = model.split.filter((row): row is { left?: DiffLine; right?: DiffLine } => !("header" in row) && !("gap" in row) && (row.left?.number !== undefined || row.right?.number !== undefined));
  expect(rows).toHaveLength(3);
  for (const row of rows) {
    expect(row.left?.segments?.some(segment => segment.changed)).toBe(true);
    expect(row.right?.segments?.some(segment => segment.changed)).toBe(true);
    expect(row.left?.segments?.map(segment => segment.text).join("")).toBe(row.left?.text);
    expect(row.right?.segments?.map(segment => segment.text).join("")).toBe(row.right?.text);
  }
  const unrelated = pairedDiffEngine("@@ -1 +1 @@\n-  }\n+    [\n");
  expect(unrelated.unified.filter(line => line.segments)).toHaveLength(0);
});

test("large blocks, long lines and cumulative candidates fall back to positional pairing", () => {
  const lines = Array.from({ length: 101 }, (_, index) => `line ${index}`);
  expect(createLineAligner()(lines, ["new"])[0]).toEqual({ before: 0, after: 0 });
  expect(createLineAligner()(["x".repeat(4097)], ["new"])).toEqual([{ before: 0, after: 0 }]);
  const align = createLineAligner();
  const block = Array.from({ length: 64 }, () => "same");
  align(block, block);
  expect(align(["apple"], ["orange"])).toEqual([{ before: 0, after: 0 }]);
});

test("engine uses chosen pairs for inline marks without changing unified order or coordinates", () => {
  const patch = "@@ -1,2 +1,3 @@\n-const count = 1;\n-return count;\n+setup();\n+const count = 2;\n+return count;\n\\ No newline at end of file\n";
  const model = buildDiffModel(patch, pairedDiffEngine);
  const positional = buildDiffModel(patch);
  expect(positional.split).not.toEqual(model.split);
  expect(positional.unified.map(line => (line.prefix ?? "") + line.text)).toEqual(model.unified.map(line => (line.prefix ?? "") + line.text));
  const rows = model.split.filter((row): row is { left?: DiffLine; right?: DiffLine } => !("header" in row) && !("gap" in row));
  expect(rows[0]?.left).toBeUndefined();
  expect(rows[0]?.right?.text).toBe("setup();");
  expect(rows[1]?.left?.number).toBe(1);
  expect(rows[1]?.right?.number).toBe(2);
  expect(rows[1]?.left?.segments?.filter(segment => segment.changed).map(segment => segment.text).join("")).toBe("1");
  expect(rows[1]?.right?.segments?.filter(segment => segment.changed).map(segment => segment.text).join("")).toBe("2");
  expect(rows[2]?.right?.noNewline).toBe(true);
  expect(model.unified.map(line => (line.prefix ?? "") + line.text).join("\n")).toBe(patch);
});
