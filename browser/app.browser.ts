import { test, expect, id } from "./fixtures";

test("keyboard selection reveals and focuses offscreen virtualized commits", async ({ page, repository }) => {
  const first = page.locator('[data-commit-index="0"]');
  const last = page.locator('[data-commit-index="119"]');
  const scroll = page.locator(".commit-scroll");
  await expect(last).toHaveCount(0);
  await expect.poll(() => page.locator(".commits button").count()).toBeLessThan(40);
  await first.click();
  await page.keyboard.press("End");
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(10000);
  await expect(first).toHaveCount(0);
  await expect.poll(() => last.evaluate(element => {
    const row = element.getBoundingClientRect();
    const viewport = element.closest(".commit-scroll")!.getBoundingClientRect();
    return row.top >= viewport.top && row.bottom <= viewport.bottom;
  })).toBe(true);
  await expect(page.locator(".commit-summary h3")).toHaveText("Fixture commit 119");
  await expect.poll(() => repository.requests.filter(request => request.method === "commit").at(-1)?.input?.revision).toBe(id(119));
  await page.keyboard.press("Home");
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(0);
});

test("files-to-diff navigation moves actual focus and scrolls the selected diff", async ({ page, repository }) => {
  await page.locator('[data-commit-index="0"]').click();
  await expect(page.locator(".commit-summary h3")).toHaveText("Fixture commit 0");
  const firstFile = page.locator('.files button[title="a.txt"]');
  const secondFile = page.locator('.files button[title="b.txt"]');
  const diff = page.getByRole("region", { name: "Diff content" });
  await expect(diff).toContainText("a.txt fixture line 79");
  await page.keyboard.press("l");
  await expect(firstFile).toBeFocused();
  await page.keyboard.press("j");
  await expect(secondFile).toBeFocused();
  await expect(secondFile).toHaveAttribute("aria-pressed", "true");
  await expect(diff).toContainText("b.txt fixture line 79");
  await page.keyboard.press("l");
  await expect(diff).toBeFocused();
  await page.keyboard.press("End");
  await expect.poll(() => diff.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press("h");
  await expect(secondFile).toBeFocused();
  await page.keyboard.press("l");
  await page.keyboard.press("p");
  await expect(diff).toBeFocused();
  await expect(firstFile).toHaveAttribute("aria-pressed", "true");
  await expect(diff).toContainText("a.txt fixture line 79");
  await expect.poll(() => diff.evaluate(element => element.scrollTop)).toBe(0);
  expect(repository.requests.filter(request => request.method === "diff").map(request => request.input?.path)).toContain("b.txt");
});

test("pagination failure keeps loaded rows and retry appends the next snapshot page", async ({ page, repository }) => {
  repository.failPagination = true;
  await page.locator('[data-commit-index="0"]').click();
  await page.keyboard.press("End");
  await expect(page.getByRole("alert")).toContainText("Fixture pagination failed");
  await expect(page.locator('[data-commit-index="119"]')).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".commits li").first()).toHaveAttribute("aria-setsize", "140");
  expect(repository.paginationAttempts).toBe(2);
  const cursors = repository.requests.filter(request => request.method === "history" && request.input?.cursor).map(request => request.input?.cursor);
  expect(cursors).toEqual([{ snapshot: "fixture-snapshot", offset: 120 }, { snapshot: "fixture-snapshot", offset: 120 }]);
  await page.locator('[data-commit-index="119"]').click();
  await page.keyboard.press("End");
  await expect(page.locator('[data-commit-index="139"]')).toBeFocused();
  await expect(page.locator(".commit-summary h3")).toHaveText("Fixture commit 139");
});

test("reference changes reset selection and history, then clearing restores all references", async ({ page, repository }) => {
  await page.locator('[data-commit-index="0"]').click();
  await expect(page.locator(".commit-summary h3")).toHaveText("Fixture commit 0");
  const references = page.getByRole("combobox", { name: "References" });
  await references.fill("feature");
  await references.press("Enter");
  await expect(page.locator('[data-commit-index="0"] strong')).toHaveText("Fixture commit 200");
  await expect(page.locator('.commits button[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator(".commit-summary")).toHaveCount(0);
  await references.press("Enter");
  await references.press("Enter");
  await expect(page.locator('[data-commit-index="0"]')).toBeFocused();
  await expect(page.locator(".commit-summary h3")).toHaveText("Fixture commit 200");
  await page.getByRole("button", { name: "Show all references" }).click();
  await expect(page.locator('[data-commit-index="0"] strong')).toHaveText("Fixture commit 0");
  await expect(page.locator(".commit-summary")).toHaveCount(0);
  expect(repository.requests.some(request => request.method === "history" && request.input?.revision === "refs/heads/feature")).toBe(true);
});

test("live invalidation refreshes history without replacing older details or stealing diff focus", async ({ page, repository }) => {
  await page.locator('[data-commit-index="0"]').click();
  await page.keyboard.press("End");
  await expect(page.locator(".commit-summary h3")).toHaveText("Fixture commit 119");
  await expect(page.locator(".commits li").first()).toHaveAttribute("aria-setsize", "140");
  const diff = page.getByRole("region", { name: "Diff content" });
  await expect(diff).toContainText("a.txt fixture line 79");
  await page.keyboard.press("l");
  await page.keyboard.press("l");
  await expect(diff).toBeFocused();
  await page.keyboard.press("End");
  await expect.poll(() => diff.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const scrollTop = await diff.evaluate(element => element.scrollTop);
  const detailRequests = repository.requests.filter(request => ["commit", "diff"].includes(request.method)).length;
  await repository.invalidate(page);
  await expect(page.locator(".commits li").first()).toHaveAttribute("aria-setsize", "121");
  await expect(page.locator('.commits button[aria-pressed="true"] strong')).toHaveText("Fixture commit 119");
  await expect(page.locator(".commit-summary h3")).toHaveText("Fixture commit 119");
  await expect(diff).toBeFocused();
  expect(await diff.evaluate(element => element.scrollTop)).toBe(scrollTop);
  expect(repository.requests.filter(request => ["commit", "diff"].includes(request.method))).toHaveLength(detailRequests);
  // Return to the top through real scrolling without changing the selected older commit.
  await page.locator(".commit-scroll").evaluate(element => element.scrollTo({ top: 0 }));
  await expect(page.locator('[data-commit-index="0"] strong')).toHaveText("Fixture commit 300");
  await expect(page.locator(".commit-summary h3")).toHaveText("Fixture commit 119");
});

test("view preferences persist across commit switches and reloads", async ({ page, repository }) => {
  await page.locator('[data-commit-index="0"]').click();
  const pairing = page.getByRole("button", { name: "Pair lines", exact: true });
  const whitespace = page.getByRole("button", { name: "Ignore whitespace changes", exact: true });
  const wrap = page.getByRole("button", { name: "Wrap diff lines", exact: true });
  await pairing.click();
  await whitespace.click();
  await wrap.click();
  await expect.poll(() => page.evaluate(() => ({
    pair: localStorage.getItem("gitudium.diff-pairing.v1"),
    whitespace: localStorage.getItem("gitudium.diff-whitespace.v1"),
    wrap: localStorage.getItem("gitudium.diff-wrap.v1"),
  }))).toEqual({ pair: "true", whitespace: "all", wrap: "true" });
  await page.locator('[data-commit-index="1"]').click();
  await expect(page.locator(".commit-summary h3")).toHaveText("Fixture commit 1");
  for (const button of [pairing, whitespace, wrap]) await expect(button).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await page.locator('[data-commit-index="0"]').click();
  for (const button of [pairing, whitespace, wrap]) await expect(button).toHaveAttribute("aria-pressed", "true");
  await pairing.click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("gitudium.diff-pairing.v1"))).toBe("false");
});

test("log exclusion settings save, reload, and combine with the reference selector", async ({ page, repository }) => {
  const gear = page.getByRole("button", { name: "Log settings", exact: true });
  await page.locator('[data-commit-index="0"]').click();
  await gear.click();
  const input = page.getByRole("textbox", { name: "Exclude refs" });
  await expect(input).toBeFocused();
  await input.fill("refs/agents/*, foo, bar");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".commit-summary")).toHaveCount(0);
  await expect.poll(() => repository.requests.filter(request => request.method === "history").at(-1)?.input?.exclude).toBe("refs/agents/*, foo, bar");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("gitudium.ref-exclusions.v1"))).toBe("refs/agents/*, foo, bar");
  const refs = page.getByRole("combobox", { name: "References" });
  await refs.fill("refs/heads/feature");
  await refs.press("Enter");
  await expect.poll(() => repository.requests.filter(request => request.method === "history").at(-1)?.input).toMatchObject({ revision: "refs/heads/feature", exclude: "refs/agents/*, foo, bar" });
  await gear.click();
  await input.fill("--all");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await input.press("Escape");
  await expect(gear).toBeFocused();
  await page.reload();
  await gear.click();
  await expect(input).toHaveValue("refs/agents/*, foo, bar");
  await input.fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("gitudium.ref-exclusions.v1"))).toBe("");
  await expect.poll(() => repository.requests.filter(request => request.method === "history").at(-1)?.input?.exclude).toBeUndefined();
});
