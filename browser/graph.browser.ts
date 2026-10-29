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
