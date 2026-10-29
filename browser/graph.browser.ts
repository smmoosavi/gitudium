import { test, expect, summary, id } from "./fixtures";

test("wide routed graphs clip and scroll together without moving text or changing paths", async ({ page, repository }) => {
  repository.historyCommits = Array.from({ length: 120 }, (_, index) => ({ ...summary(index),
    parents: index < 24 ? [id(60 + index)] : index >= 60 && index < 84 ? [id(119)] : [],
  }));
  await page.reload();
  const row = page.locator('[data-commit-index="0"]');
  await expect(row).toBeVisible();
  const scrollbar = page.getByRole("region", { name: "Scroll commit graph horizontally" });
  await expect(scrollbar).toBeVisible();
  const paths = () => row.locator("path").evaluateAll(paths => paths.map(path => path.getAttribute("d")));
  const before = await paths();
  const textBefore = await row.locator("strong").boundingBox();
  const graph = row.locator("svg");
  const clip = row.locator(".commit-graph-window");
  expect(await clip.evaluate(element => getComputedStyle(element).overflow)).toBe("hidden");
  expect((await graph.boundingBox())!.width).toBeGreaterThan((await clip.boundingBox())!.width);
  expect((await clip.boundingBox())!.width).toBeLessThanOrEqual(180);
  await scrollbar.focus();
  await page.keyboard.press("End");
  await expect.poll(() => scrollbar.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  expect((await row.locator("strong").boundingBox())!.x).toBe(textBefore!.x);
  expect(await paths()).toEqual(before);
  const transforms = await page.locator(".commit-graph").evaluateAll(elements => elements.map(element => getComputedStyle(element).transform));
  expect(new Set(transforms).size).toBe(1);
  await page.setViewportSize({ width: 1000, height: 900 });
  expect(await paths()).toEqual(before);
  await page.locator(".commit-scroll").evaluate(element => element.scrollTo({ top: 4000 }));
  await expect(row).toHaveCount(0);
  const passing = page.locator('[data-commit-index="40"]');
  await expect(passing).toBeVisible();
  expect(await passing.locator("path").count()).toBeGreaterThan(20);
  await expect(scrollbar).toBeVisible();
});

test("HEAD history precedes an independent tip and keyboard navigation follows the displayed order", async ({ page, repository }) => {
  repository.head = id(0);
  repository.historyCommits = [
    { ...summary(50), parents: [id(4)], references: ["refs/heads/x"] },
    { ...summary(0), references: ["refs/heads/refactor/graph-routing-maintenance"] },
    summary(1), summary(2), summary(3),
    { ...summary(4), parents: [], references: ["refs/heads/main"] },
  ];
  await page.reload();
  const expected = [0, 1, 2, 3, 50, 4];
  await expect(page.locator(".commits button")).toHaveCount(expected.length);
  expect(await page.locator(".commits button").evaluateAll(buttons => buttons.map(button => button.getAttribute("data-commit-id"))))
    .toEqual(expected.map(id));
  expect(await page.locator(".commit-graph circle").evaluateAll(dots => dots.map(dot => dot.getAttribute("cx"))))
    .toEqual(["16", "16", "16", "16", "32", "16", "16"]); // Root has an inner dot.
  const side = page.locator(`[data-commit-id="${id(50)}"]`);
  await expect(side.locator('path[d="M 32 22 C 32 36, 16 36, 16 50 V 10000"]')).toHaveCount(1);
  await page.locator(`[data-commit-id="${id(3)}"]`).click();
  await page.keyboard.press("ArrowDown");
  await expect(side).toBeFocused();
  await expect(side).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".commit-summary h3")).toHaveText("Fixture commit 50");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(`[data-commit-id="${id(4)}"]`)).toBeFocused();
  await expect(page.locator(".commit-summary h3")).toHaveText("Fixture commit 4");
  expect(repository.requests.filter(request => request.method === "commit").at(-1)?.input?.revision).toBe(id(4));
  await side.click();
  repository.head = id(50);
  await repository.invalidate(page);
  await expect(side).toHaveAttribute("data-commit-index", "0");
  await expect(side).toBeFocused();
  await expect(side).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(`[data-commit-id="${id(0)}"]`)).toBeFocused();
  await expect(page.locator(".commit-summary h3")).toHaveText("Fixture commit 0");
});

test("appending priority-ordered pages preserves selected identity, visible rows, and lanes", async ({ page, repository }) => {
  repository.head = id(0);
  repository.historyPages = [
    { commits: [{ ...summary(500), parents: [id(120)] },
      ...Array.from({ length: 119 }, (_, index) => ({ ...summary(index), references: [] }))],
    nextCursor: { snapshot: "fixture-snapshot", offset: 120 } },
    { commits: [summary(119), { ...summary(120), parents: [], references: ["refs/heads/main"] }], nextCursor: null },
  ];
  await page.reload();
  await expect(page.locator('[data-commit-index="0"]')).toHaveAttribute("data-commit-id", id(0));
  await expect(page.locator(".commits li").first()).toHaveAttribute("aria-setsize", "120");
  await page.locator('[data-commit-index="0"]').click();
  await page.keyboard.press("End");
  const side = page.locator(`[data-commit-id="${id(500)}"]`);
  await expect(side).toBeFocused();
  await expect(side).toHaveAttribute("data-commit-index", "119");
  await expect(page.locator(".commits li").first()).toHaveAttribute("aria-setsize", "122");
  await expect(side).toHaveAttribute("aria-pressed", "true");
  await expect(side.locator("circle").first()).toHaveAttribute("cx", "32");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(`[data-commit-id="${id(119)}"]`)).toBeFocused();
  await expect(page.locator(".commit-summary h3")).toHaveText("Fixture commit 119");
  expect(repository.paginationAttempts).toBe(1);
});
