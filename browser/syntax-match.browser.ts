import { test, expect, type Page } from "@playwright/test";
import { RepositoryFixture, id, summary } from "./fixtures";

const before = 'const oldName = 1;\nconsole.log(oldName);\n';
const after = 'const inserted = true;\nconst newName = 2;\nconsole.log(newName);\n';
const patch = `diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1,2 +1,3 @@\n-const oldName = 1;\n-console.log(oldName);\n+const inserted = true;\n+const newName = 2;\n+console.log(newName);\n`;

async function workerResult(page: Page, path: string, text: string) {
  return page.evaluate(async ({ path, text }) => {
    const worker = new Worker("/src/client/syntaxMatch.worker.ts", { type: "module" });
    try {
      return await new Promise<{ result?: import("../src/client/syntaxMatcher").MatchResult }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Worker timed out")), 10000);
        worker.onmessage = event => { clearTimeout(timer); resolve(event.data); };
        worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
        worker.postMessage({ before: null, after: { revision: "a", path, text } });
      });
    } finally { worker.terminate(); }
  }, { path, text });
}

test("real WASM grammars preserve Unicode and reject unsupported or invalid syntax", async ({ page }) => {
  await page.goto("/");
  for (const [path, text] of [
    ["file.ts", 'const café = "😀";\n'], ["file.tsx", 'const el = <div>Hello</div>;\n'],
    ["file.js", 'const x = 1;\n'], ["file.py", 'x = "😀"\n'],
    ["file.json", '{"x": 1}\n'], ["file.css", 'a { color: red; }\n'],
    ["file.go", 'package main\nfunc main() {}\n'], ["file.rs", 'fn main() {}\n'],
  ]) {
    const result = await workerResult(page, path!, text!);
    expect(result.result?.after?.map(line => line.map(token => token.text).join("")).join("\n"), JSON.stringify(result)).toBe(text);
  }
  expect((await workerResult(page, "file.txt", "text")).result).toBeUndefined();
  expect((await workerResult(page, "file.ts", "const = {")).result).toBeUndefined();
});

test("unsupported language keeps simple diff and toggle remains reversible", async ({ page }) => {
  const repository = new RepositoryFixture();
  repository.textSources = true;
  await repository.mount(page);
  await page.locator('[data-commit-index="0"]').click();
  const toggle = page.getByRole("button", { name: "Diff options", exact: true });
  await expect(page.locator(".diff-content")).toContainText("fixture line 79");
  await toggle.click();
  await page.getByRole("radio", { name: /^Similarity/ }).check();
  await page.getByRole("radio", { name: /^Syntax-aware/ }).check();
  await expect(toggle).toHaveAttribute("title", /syntax-aware matching unavailable/);
  await expect(page.locator(".diff-content").getByRole("status")).toHaveCount(0);
  await page.getByRole("radio", { name: /^Simple/ }).check();
  await expect(page.getByText("Syntax-aware matching unavailable", { exact: false })).toHaveCount(0);
  await expect(page.locator(".diff-content")).toContainText("fixture line 79");
});

test("toolbar repeatedly switches improved and original diff with real parser", async ({ page }) => {
  const repository = new RepositoryFixture();
  await repository.mount(page);
  await page.route("**/api/trpc/**", async route => {
    const url = new URL(route.request().url());
    const method = url.pathname.split("/").at(-1);
    if (!["commit", "diff", "sources"].includes(method!)) return route.fallback();
    const input = JSON.parse(url.searchParams.get("input") ?? "{}");
    const data = method === "commit" ? {
      ...summary(0), committer: summary(0).author, message: "syntax fixture", diffBase: id(1),
      files: [{ path: "file.ts", previousPath: null, status: "modified", additions: 3, deletions: 2 }],
    } : method === "diff" ? { state: "text", patch } : {
      state: "text", before: { revision: id(1), path: "file.ts", text: before },
      after: { revision: input.revision, path: "file.ts", text: after },
    };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ result: { data } }) });
  });
  await page.locator('[data-commit-index="0"]').click();
  const toggle = page.getByRole("button", { name: "Diff options", exact: true });
  const content = page.locator(".diff-content");
  await expect(content).toContainText("newName");
  await expect(content.locator(".unified-line.context")).toHaveCount(0);
  await expect(content.locator(".syntax-token").first()).toBeVisible();
  const original = await content.innerHTML();
  await expect(toggle).toHaveText("");
  await expect(toggle.locator("svg")).toBeVisible();
  await expect(page.locator(".diff-controls > :last-child")).toHaveClass("diff-options");
  for (let i = 0; i < 2; i++) {
    const top = await content.locator("pre").evaluate(element => element.getBoundingClientRect().top);
    await toggle.click();
    await page.getByRole("radio", { name: /^Similarity/ }).check();
    await page.getByRole("radio", { name: /^Syntax-aware/ }).check();
    await expect(content.getByRole("status")).toHaveCount(0);
    expect(await content.locator("pre").evaluate(element => element.getBoundingClientRect().top)).toBe(top);
    await expect.poll(() => content.innerHTML()).not.toBe(original);
    await expect(content).toContainText("newName");
    await page.getByRole("radio", { name: /^Simple/ }).check();
    await page.keyboard.press("Escape");
    await expect(toggle).toBeFocused();
    await expect.poll(() => content.innerHTML()).toBe(original);
  }
});

// Original examples exercise behaviors documented by Difftastic, not its fixture contents.
test("syntax matching preserves reflow, wrappers and significant edits across real grammars", async ({ page }) => {
  await page.goto("/");
  const cases = [
    { path: "reflow.js", before: "const grove = [birch, cedar];\n", after: "const grove = [\n  birch,\n  cedar,\n];\n", retained: ["birch", "cedar"], changed: [","] },
    { path: "reflow.ts", before: "const tags: string[] = [\"north\", \"south\"];\n", after: "const tags: string[] = [\n  \"north\",\n  \"south\",\n];\n", retained: ["north", "south"], changed: [","] },
    { path: "reflow.tsx", before: "const card = <article id=\"map\" title=\"Trail\" />;\n", after: "const card = <article\n  id=\"map\"\n  title=\"Trail\"\n/>;\n", retained: ["map", "Trail"], changed: [] },
    { path: "reflow.json", before: "{\"paths\": [\"east\", \"west\"]}\n", after: "{\n  \"paths\": [\n    \"east\",\n    \"west\"\n  ]\n}\n", retained: ["paths", "east", "west"], changed: [] },
    { path: "scope.py", before: "if active:\n    render(scene)\n", after: "if active:\n    pass\nrender(scene)\n", retained: ["render", "scene"], changed: ["pass"] },
    { path: "wrap.rs", before: "fn grow() { emit(seed); }\n", after: "fn grow() { if ready { emit(seed); } }\n", retained: ["emit", "seed"], changed: ["if", "ready"] },
    { path: "wrap.go", before: "package grove\nfunc grow() { emit(seed) }\n", after: "package grove\nfunc grow() { if ready { emit(seed) } }\n", retained: ["emit", "seed"], changed: ["if", "ready"] },
    { path: "value.css", before: ".grove { color: olive; padding: 2px; }\n", after: ".grove {\n  color: teal;\n  padding: 2px;\n}\n", retained: ["grove", "padding", "2"], changed: ["teal"] },
    { path: "wrap.js", before: "function shade() { return leaf; }\n", after: "function shade() { return frame(leaf); }\n", retained: ["leaf"], changed: ["frame"] },
    { path: "branch.ts", before: 'const visit = (node: Parser.SyntaxNode) => {\n  if (node.childCount) {\n    visit(child);\n  }\n};\n', after: 'const visit = (node: Parser.SyntaxNode, path: string[] = []) => {\n  if (node.type === "string") {\n    append(node.text);\n  } else if (node.childCount) {\n    visit(child, path);\n  }\n};\n', retained: ['node.childCount', 'visit(child'], changed: ['else', 'path'] },
    { path: "key.json", before: "{\"oldTrail\": 17}\n", after: "{\"newTrail\": 17}\n", retained: ["17"], changed: ['"newTrail"'] },
    { path: "dependencies.json", before: '{\n  "removed-tool": "^1",\n  "retained-tool": "^7",\n  "test-helper": "^10"\n}\n', after: '{\n  "retained-tool": "^7.2",\n  "test-helper": "^11"\n}\n', retained: ['"retained-tool"', '"test-helper"'], changed: ['"^7.2"', '"^11"'] },
    { path: "removed-object.json", before: '{\n  "peerDependencies": {\n    "react": "^18"\n  },\n  "pnpm": {\n    "overrides": {\n      "parser": "^6",\n      "plugin": "^6"\n    }\n  }\n}\n', after: '{\n  "peerDependencies": {\n    "react": "^18 || ^19"\n  }\n}\n', retained: ['"react"'], changed: ['"^18 || ^19"'] },
    { path: "roles.json", before: '{"trail": "forest"}\n', after: '{"forest": "trail"}\n', retained: [], changed: ['"forest"', '"trail"'] },
    { path: "escaped.json", before: '{"label": "old\\\" name"}\n', after: '{"label": "new\\\" name"}\n', retained: ['"label"'], changed: ['"new\\\" name"'] },
    { path: "literal.py", before: "label = \"deep forest\"\n", after: "label = \"deep  forest\"\n", retained: ["label"], changed: ["deep  forest"] },
  ];
  for (const example of cases) {
    const result = await page.evaluate(async example => {
      const worker = new Worker("/src/client/syntaxMatch.worker.ts", { type: "module" });
      try {
        const data = await new Promise<{ result?: import("../src/client/syntaxMatcher").MatchResult }>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Worker timed out")), 10000);
          worker.onmessage = event => { clearTimeout(timer); resolve(event.data); };
          worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
          worker.postMessage({ before: { revision: "old", path: example.path, text: example.before }, after: { revision: "new", path: example.path, text: example.after } });
        });
        if (!data.result) throw new Error("Parsing failed: " + example.path);
        // @ts-expect-error Vite serves this module during the browser test.
        const { createDiffEngine }: typeof import("../src/client/diffEngine") = await import("/src/client/diffEngine.ts");
        const before = example.before.trimEnd().split("\n");
        const after = example.after.trimEnd().split("\n");
        const patch = example.path === "removed-object.json"
          ? ['@@ -1,11 +1,5 @@', ' {', '   "peerDependencies": {', '-    "react": "^18"', '-  },', '-  "pnpm": {', '-    "overrides": {', '-      "parser": "^6",', '-      "plugin": "^6"', '-    }', '+    "react": "^18 || ^19"', '   }', ' }'].join("\n")
          : [`@@ -1,${before.length} +1,${after.length} @@`, ...before.map(line => "-" + line), ...after.map(line => "+" + line)].join("\n");
        const model = createDiffEngine(true, data.result)(patch);
        const added = model.unified.filter(line => line.prefix === "+");
        const atomicStrings = model.unified.every(line => {
          const tokens = line.prefix === "+" ? data.result!.after?.[line.newNumber! - 1] : line.prefix === "-" ? data.result!.before?.[line.oldNumber! - 1] : undefined;
          let offset = 0;
          return (tokens ?? []).every(token => {
            const start = offset;
            offset += token.text.length;
            if (!token.type.startsWith("json/")) return true;
            let position = 0;
            const states = new Set<boolean>();
            for (const segment of line.segments ?? []) {
              if (position < offset && position + segment.text.length > start) states.add(segment.changed);
              position += segment.text.length;
            }
            return states.size === 1;
          });
        });
        return {
          atomicStrings,
          branchRetained: added.filter(line => line.text.includes("else if (node.childCount)")).flatMap(line => line.segments ?? []).filter(segment => !segment.changed).map(segment => segment.text).join(""),
          branchChanged: added.filter(line => line.text.includes("else if (node.childCount)")).flatMap(line => line.segments ?? []).filter(segment => segment.changed).map(segment => segment.text).join(""),
          closingAligned: model.split.some(row => "left" in row && row.left?.text === "  }," && row.right?.text === "  }"),
          closingHighlights: model.unified.filter(line => line.prefix === "+" && line.text === "  }").flatMap(line => line.segments ?? []).filter(segment => segment.changed).map(segment => segment.text).join(""),
          deletedScopes: model.unified.filter(line => line.prefix === "-").flatMap(line => {
            const tokens = data.result!.before?.[line.oldNumber! - 1] ?? [];
            return tokens.some(token => token.scope?.includes('"pnpm"')) ? [{ text: line.text, segments: line.segments }] : [];
          }),
          retained: added.flatMap(line => line.segments ?? []).filter(segment => !segment.changed).map(segment => segment.text).join(""),
          changed: added.flatMap(line => line.segments ?? []).filter(segment => segment.changed).map(segment => segment.text).join(""),
          lossless: model.unified.every(line => !line.segments || line.segments.map(segment => segment.text).join("") === line.text),
          removed: model.unified.filter(line => line.prefix === "-").flatMap(line => line.segments ?? []).filter(segment => segment.changed).map(segment => segment.text).join(""),
        };
      } finally { worker.terminate(); }
    }, example);
    expect(result.lossless, example.path).toBe(true);
    expect(result.atomicStrings, example.path).toBe(true);
    for (const text of example.retained) expect(result.retained, example.path).toContain(text);
    for (const text of example.changed) expect(result.changed, example.path).toContain(text);
    if (example.path === "scope.py") expect(result.removed).toContain("    ");
    if (example.path === "branch.ts") {
      expect(result.branchRetained).toContain("if (node.childCount)");
      expect(result.branchChanged).toContain("else");
      expect(result.branchChanged).not.toContain("node");
    }
    if (example.path === "removed-object.json") {
      expect(result.closingAligned).toBe(true);
      expect(result.closingHighlights).toBe("");
      expect(result.deletedScopes.length).toBe(6);
      for (const line of result.deletedScopes) {
        expect(line.segments?.filter(segment => !segment.changed).map(segment => segment.text).join("").trim(), line.text).toBe("");
      }
    }
  }
});
