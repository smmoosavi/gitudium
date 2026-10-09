import { test as base, expect, type Page } from "@playwright/test";
import type { CommitDetails, CommitSummary, HistoryPage, RepositoryMetadata, Reference } from "../src/repository/types";

export const id = (index: number) => (index + 1).toString(16).padStart(40, "0");
const author = { name: "Fixture Author", email: "fixture@example.test", date: "2026-01-01T12:00:00Z" };
export const summary = (index: number): CommitSummary => ({
  id: id(index), shortId: id(index).slice(-7), parents: [id(index + 1)],
  subject: `Fixture commit ${index}`, author, references: index === 0 ? ["refs/heads/main"] : [],
});
const details = (revision: string): CommitDetails => ({
  ...summary(parseInt(revision, 16) - 1), committer: author, message: `Details for ${revision}`,
  diffBase: id(parseInt(revision, 16)),
  files: ["a.txt", "b.txt"].map(path => ({ path, previousPath: null, status: "modified", additions: 80, deletions: 0 })),
});

export class RepositoryFixture {
  failPagination = false;
  paginationAttempts = 0;
  refreshed = false;
  requests: { method: string; input: Record<string, unknown> | undefined }[] = [];

  async mount(page: Page) {
    // A controlled streaming response exercises the real SSE parser without reconnect timers or a repository watcher.
    await page.addInitScript(() => {
      const original = window.fetch.bind(window);
      let controller: ReadableStreamDefaultController<Uint8Array>;
      Object.assign(window, { emitInvalidation: () => controller.enqueue(new TextEncoder().encode("event: invalidation\ndata: {}\n\n")) });
      const fixtureFetch = (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== "/api/events") return original(input, init);
        const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
        return Promise.resolve(new Response(stream, { headers: { "content-type": "text/event-stream" } }));
      };
      Object.assign(window, { fetch: fixtureFetch });
    });
    await page.route("**/api/trpc/**", async route => {
      const url = new URL(route.request().url());
      const methods = url.pathname.split("/").at(-1)!.split(",");
      const batch = url.searchParams.get("batch") === "1";
      const inputs = JSON.parse(url.searchParams.get("input") ?? "null");
      const responses = methods.map((method, index) => {
        const input = (batch ? inputs?.[index] : inputs) as Record<string, unknown> | undefined;
        this.requests.push({ method, input });
        if (method === "history" && input?.cursor) {
          this.paginationAttempts++;
          if (this.failPagination && this.paginationAttempts === 1) return { error: {
            message: "Fixture pagination failed", code: -32603,
            data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, path: method },
          } };
        }
        return { result: { data: this.response(method, input) } };
      });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(batch ? responses : responses[0]) });
    });
    await page.goto(`/#token=${"a".repeat(64)}`);
    await expect(page.locator('[data-commit-index="0"]')).toBeVisible();
    await expect(page.getByText("Live updates connected", { exact: true })).toBeVisible();
  }

  private response(method: string, input: Record<string, unknown> | undefined): unknown {
    switch (method) {
      case "metadata": return {
        root: "/fixtures/workspace", gitDirectory: "/fixtures/workspace/.git", commonDirectory: "/fixtures/workspace/.git",
        bare: false, head: id(this.refreshed ? 300 : 0), branch: "main", objectFormat: "sha1",
        capabilities: { history: true, firstParentDiffs: true },
      } satisfies RepositoryMetadata;
      case "references": return ["main", "feature"].map(name => ({
        name: `refs/heads/${name}`, kind: "branch", objectId: id(name === "main" ? (this.refreshed ? 300 : 0) : 200),
        commitId: id(name === "main" ? (this.refreshed ? 300 : 0) : 200), symbolicTarget: null,
      } satisfies Reference));
      case "history": {
        if (input?.revision === "refs/heads/feature") return { commits: [summary(200), summary(201)], nextCursor: null } satisfies HistoryPage;
        if (input?.cursor) return { commits: Array.from({ length: 20 }, (_, i) => summary(i + 120)), nextCursor: null } satisfies HistoryPage;
        return {
          commits: [...(this.refreshed ? [summary(300)] : []), ...Array.from({ length: 120 }, (_, i) => summary(i))],
          nextCursor: { snapshot: "fixture-snapshot", offset: 120 },
        } satisfies HistoryPage;
      }
      case "commit": return details(input!.revision as string);
      case "diff": return { state: "text", patch: `diff --git a/${input!.path} b/${input!.path}\n--- a/${input!.path}\n+++ b/${input!.path}\n@@ -1,1 +1,81 @@\n context\n${Array.from({ length: 80 }, (_, i) => `+${input!.path} fixture line ${i}`).join("\n")}\n` };
      case "sources": return { state: "unavailable" };
      default: throw new Error(`Unexpected fixture method: ${method}`);
    }
  }

  async invalidate(page: Page) {
    this.refreshed = true;
    await page.evaluate(() => (window as unknown as { emitInvalidation: () => void }).emitInvalidation());
  }
}

export const test = base.extend<{ repository: RepositoryFixture }>({
  repository: async ({ page }, use) => {
    const repository = new RepositoryFixture();
    await repository.mount(page);
    await use(repository);
  },
});
export { expect };
