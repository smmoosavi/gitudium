const block = (before: string[], after: string[]) => before.map(line => `-${line}\n`).join("") + after.map(line => `+${line}\n`).join("");
const hunk = (before: string[], after: string[]) => `@@ -1,${before.length} +1,${after.length} @@\n${block(before, after)}`;
const costlyBefore = "a ".repeat(100);
const costlyAfter = "a ".repeat(99) + "b ";

export const diffCases: Record<string, string> = {
  empty: "",
  metadata: "diff --git a/old b/new\nold mode 100644\nnew mode 100755\n--- a/old\n+++ b/new\n",
  setup: hunk(["const count = 1;", "return count;"], ["setup();", "const count = 2;", "return count;"]),
  repeated: hunk(["}", "}", "finish(old);", "}"], ["}", "setup();", "finish(new);", "}"]),
  markers: "@@ -1,3 +1,4 @@\n-const count = 1;\n\\ No newline at end of file\n-}\n-}\n+setup();\n+const count = 2;\n\\ No newline at end of file\n+}\n+}\n context\n\\ No newline at end of file\n",
  emptyLines: "@@ -1 +1 @@\n-\n\\ No newline at end of file\n+\n\\ No newline at end of file\n",
  punctuation: hunk(["    }", "    });", "  },"], ["      }", "      };", "    });", "  });"]),
  unicode: hunk(["你好 café 👋", ""], ["你好 coffee 🌍", ""]),
  unrelated: hunk(["apple();"], ["orange();"]),
  noTrailingNewline: "@@ -10 +12 @@\n-old value\n+new value",
  alternating: "@@ -1,3 +1,3 @@\n-old value\n+new value\n-old count\n+new count\n tail\n@@ -20,0 +21 @@\n+extra\n",
  candidateBudget: hunk(Array(64).fill("same"), Array(64).fill("same")) + "@@ -70 +70 @@\n-apple();\n+orange();\n",
  similarityBudget: Array.from({ length: 26 }, () => hunk([costlyBefore], [costlyAfter])).join("") + hunk(["apple();"], ["orange();"]),
  inlineBudget: hunk(Array(100).fill(costlyBefore), Array(100).fill(costlyAfter)) + hunk(["const count = 1;"], ["const count = 2;"]),
  oversized: hunk(Array(101).fill("old value"), Array(101).fill("new value")) + hunk(["apple();"], ["orange();"]),
  longLine: hunk(["x".repeat(4097)], ["new"]),
};

export const benchmarkCases: Record<string, string> = {
  related: hunk(Array.from({ length: 32 }, (_, i) => `const value${i} = old;`), ["setup();", ...Array.from({ length: 32 }, (_, i) => `const value${i} = fresh;`)]),
  manyBlocks: Array.from({ length: 32 }, (_, i) => hunk([`const value${i} = old;`, "return value;"], ["setup();", `const value${i} = fresh;`, "return value;"])).join(""),
  exhausted: diffCases.inlineBudget!,
};
