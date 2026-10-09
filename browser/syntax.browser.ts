import { test, expect, type Page } from "@playwright/test";
import { RepositoryFixture, id } from "./fixtures";

async function instrumentWorkers(page: Page) {
  await page.addInitScript(() => {
    const workers: Array<{
      jobs: Array<{ id: number; sources: { before: { revision: string } | null; after: { revision: string } | null } }>;
      terminated: number;
      onmessage: ((event: { data: unknown }) => void) | null;
      finish: (text: string) => void;
    }> = [];
    class Worker {
      jobs: typeof workers[number]["jobs"] = [];
      terminated = 0;
      onmessage: typeof workers[number]["onmessage"] = null;
      onerror = null;
      onmessageerror = null;
      constructor() { workers.push(this); }
      postMessage(job: typeof workers[number]["jobs"][number]) { this.jobs.push(job); }
      terminate() { this.terminated++; }
      finish(text: string) {
        this.onmessage?.({ data: { id: this.jobs.at(-1)!.id, result: {
          before: null, after: [[{ text, color: "#ff0000" }]],
        } } });
      }
    }
    Object.assign(window, { Worker, syntaxWorkers: workers });
  });
}

async function workerState(page: Page) {
  return page.evaluate(() => (window as unknown as { syntaxWorkers: Array<{ jobs: unknown[]; terminated: number }> }).syntaxWorkers
    .map(worker => ({ jobs: worker.jobs.length, terminated: worker.terminated })));
}

async function finish(page: Page, text: string) {
  await page.evaluate(text => (window as unknown as { syntaxWorkers: Array<{ finish: (text: string) => void }> }).syntaxWorkers.at(-1)!.finish(text), text);
}

// Mount the production owner and consumer directly to exercise effect replay and unmount,
// including requests that start during the first StrictMode effect setup.
async function mountHarness(page: Page) {
  await instrumentWorkers(page);
  await page.goto("/");
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { createElement, StrictMode } = (await load("/node_modules/.vite/deps/react.js")).default as typeof import("react");
    const { createRoot } = (await load("/node_modules/.vite/deps/react-dom_client.js")).default as typeof import("react-dom/client");
    const { useSyntaxService } = await load("/src/client/useSyntaxService.ts") as typeof import("../src/client/useSyntaxService");
    const { useSyntaxHighlighting } = await load("/src/client/useSyntaxHighlighting.ts") as typeof import("../src/client/useSyntaxHighlighting");
    function Consumer({ service, revision }: { service: ReturnType<typeof useSyntaxService>; revision: string }) {
      const result = useSyntaxHighlighting(service, { before: null, after: { revision, path: "file.ts", text: revision } });
      return createElement("output", { id: "syntax-result" }, result?.after?.[0]?.[0]?.text ?? "plain");
    }
    function Viewer({ revision }: { revision: string | null }) {
      const service = useSyntaxService();
      return revision ? createElement(Consumer, { key: revision, revision, service }) : null;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    Object.assign(window, {
      renderSyntax: (revision: string | null) => root.render(createElement(StrictMode, null, createElement(Viewer, { revision }))),
      unmountSyntax: () => root.unmount(),
    });
    root.render(createElement(StrictMode, null, createElement(Viewer, { revision: "a" })));
  });
}

async function render(page: Page, revision: string | null) {
  await page.evaluate(revision => (window as unknown as { renderSyntax: (revision: string | null) => void }).renderSyntax(revision), revision);
}

test("StrictMode replay replaces disposed worker; keyed switches and gaps retain worker/cache until viewer unmount", async ({ page }) => {
  await mountHarness(page);
  await expect.poll(() => workerState(page)).toEqual([{ jobs: 1, terminated: 1 }, { jobs: 1, terminated: 0 }]);
  await finish(page, "a tokens");
  await expect(page.locator("#syntax-result")).toHaveText("a tokens");
  await render(page, null);
  await expect(page.locator("#syntax-result")).toHaveCount(0);
  expect(await workerState(page)).toEqual([{ jobs: 1, terminated: 1 }, { jobs: 1, terminated: 0 }]);
  await page.waitForTimeout(120);
  await render(page, "b");
  await expect.poll(() => workerState(page)).toEqual([{ jobs: 1, terminated: 1 }, { jobs: 2, terminated: 0 }]);
  // The keyed consumer also replays effects: its first immediate request is cancelled.
  await finish(page, "cancelled b");
  await expect(page.locator("#syntax-result")).toHaveText("plain");
  await expect.poll(() => workerState(page)).toEqual([{ jobs: 1, terminated: 1 }, { jobs: 3, terminated: 0 }]);
  await finish(page, "b tokens");
  await expect(page.locator("#syntax-result")).toHaveText("b tokens");
  await render(page, "a");
  await expect(page.locator("#syntax-result")).toHaveText("a tokens");
  expect(await workerState(page)).toEqual([{ jobs: 1, terminated: 1 }, { jobs: 3, terminated: 0 }]);
  await page.evaluate(() => (window as unknown as { unmountSyntax: () => void }).unmountSyntax());
  expect(await workerState(page)).toEqual([{ jobs: 1, terminated: 1 }, { jobs: 3, terminated: 1 }]);
  await finish(page, "late response");
  await expect(page.locator("#syntax-result")).toHaveCount(0);
});

test("rapid keyed switching rejects stale responses and cancels pending work on viewer unmount", async ({ page }) => {
  await mountHarness(page);
  await expect.poll(() => workerState(page)).toHaveLength(2);
  await render(page, "b");
  await expect(page.locator("#syntax-result")).toHaveText("plain");
  await render(page, "c");
  await finish(page, "stale a");
  await expect(page.locator("#syntax-result")).toHaveText("plain");
  await expect.poll(() => page.evaluate(() => (window as unknown as {
    syntaxWorkers: Array<{ jobs: Array<{ sources: { after: { revision: string } } }> }>;
  }).syntaxWorkers.at(-1)!.jobs.map(job => job.sources.after.revision))).toEqual(["a", "c"]);
  await finish(page, "c tokens");
  await expect(page.locator("#syntax-result")).toHaveText("c tokens");
  await render(page, "d");
  await expect(page.locator("#syntax-result")).toHaveText("plain");
  await page.evaluate(() => (window as unknown as { unmountSyntax: () => void }).unmountSyntax());
  const disposed = await workerState(page);
  await page.waitForTimeout(150);
  expect(await workerState(page)).toEqual(disposed);
  expect(disposed.every(worker => worker.terminated === 1)).toBe(true);
});

test("App retains syntax across navigation debounce and reference reset while resetting commit-local selection/context", async ({ page }) => {
  await instrumentWorkers(page);
  const repository = new RepositoryFixture();
  repository.textSources = true;
  await repository.mount(page);
  const first = page.locator('[data-commit-index="0"]');
  await first.click();
  await expect.poll(() => workerState(page)).toEqual([{ jobs: 1, terminated: 0 }]);
  await finish(page, "context");
  await page.locator('.files button[title="b.txt"]').click();
  await expect.poll(() => workerState(page)).toEqual([{ jobs: 2, terminated: 0 }]);
  await finish(page, "context");
  await page.getByRole("button", { name: "Full file", exact: true }).click();
  await page.locator('[data-commit-index="1"]').click();
  await expect(page.locator(".commit-summary h3")).toHaveText("Fixture commit 1");
  await expect(page.locator('.files button[title="a.txt"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Full file", exact: true })).toBeVisible();
  await expect.poll(() => workerState(page)).toEqual([{ jobs: 3, terminated: 0 }]);
  await finish(page, "context");
  await first.click();
  await expect(page.locator(".commit-summary h3")).toHaveText("Fixture commit 0");
  await expect.poll(() => repository.requests.filter(request => request.method === "sources" && request.input?.revision === id(0) && request.input?.path === "a.txt").length).toBe(2);
  await expect(page.locator('.diff-panel span[style*="color"]')).not.toHaveCount(0);
  expect(await workerState(page)).toEqual([{ jobs: 3, terminated: 0 }]);
  await page.getByRole("combobox", { name: "References" }).fill("feature");
  await page.getByRole("combobox", { name: "References" }).press("Enter");
  await expect(page.locator(".commit-summary")).toHaveCount(0);
  expect(await workerState(page)).toEqual([{ jobs: 3, terminated: 0 }]);
});
