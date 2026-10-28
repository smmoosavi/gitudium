import { test, expect } from "./fixtures";

test("pinned local changes show counted scopes, preserve file selection and refresh edits", async ({ page, repository }) => {
  repository.localChanges = { ...repository.localChanges, version: "changed", files: [
    { path: "a.txt", previousPath: null, status: "modified", staged: true, unstaged: true, untracked: false, conflicted: false, stagedStatus: "modified", unstagedStatus: "modified" },
    { path: "new.txt", previousPath: null, status: "added", staged: false, unstaged: false, untracked: true, conflicted: false, stagedStatus: null, unstagedStatus: null },
  ] };
  const row = page.locator(".local-changes-row");
  await expect(row).toContainText("2");
  await row.click();
  await expect(page.getByRole("tab", { name: "All 2", exact: true })).toHaveAttribute("aria-selected", "true");
  const file = page.locator('.files button[title="a.txt"]');
  const diff = page.getByRole("region", { name: "Diff content" });
  await expect(file).toHaveAttribute("aria-pressed", "true");
  await expect(file).toContainText("Staged");
  await expect(file).toContainText("Unstaged");
  await expect(diff).toContainText("head fixture");
  await expect(diff).toContainText("working fixture");
  await page.getByRole("tab", { name: "Staged 1", exact: true }).click();
  await expect(diff).toContainText("staged fixture");
  await expect(diff).not.toContainText("working fixture");
  await expect(file).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("tab", { name: "Unstaged 1", exact: true }).click();
  await expect(diff).toContainText("staged fixture");
  await expect(diff).toContainText("working fixture");
  await page.getByRole("tab", { name: "Untracked 1", exact: true }).click();
  await expect(file).toHaveCount(0);
  await expect(diff).toContainText("a.txt has no changes in this scope");
  await page.locator('.files button[title="new.txt"]').click();
  await expect(diff).toContainText("working fixture");
  await page.getByRole("tab", { name: "All 2", exact: true }).click();
  await expect(page.locator('.files button[title="new.txt"]')).toHaveAttribute("aria-pressed", "true");
  repository.localText = "updated fixture";
  repository.localChanges = { ...repository.localChanges, version: "updated" };
  await expect(diff).toContainText("updated fixture");
  await expect(diff).not.toContainText("working fixture");
  await page.locator('[data-commit-index="0"]').click();
  await expect(page.locator(".commit-summary h3")).toHaveText("Fixture commit 0");
  expect(repository.requests.some(request => request.method === "commit" && request.input?.revision === "local-changes")).toBe(false);
});

test("local row participates in history and pane keyboard navigation and stays pinned", async ({ page, repository }) => {
  const row = page.locator(".local-changes-row");
  const first = page.locator('[data-commit-index="0"]');
  await first.click();
  await page.keyboard.press("ArrowUp");
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Working tree clean. No local changes.", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(first).toBeFocused();
  await page.keyboard.press("End");
  await expect(row).toBeInViewport();
  await page.keyboard.press("Home");
  await expect(row).toBeFocused();
  expect(repository.requests.some(request => request.method === "localChanges")).toBe(true);
});
