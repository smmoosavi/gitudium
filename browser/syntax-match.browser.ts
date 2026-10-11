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
