import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ViewToggle, layoutOptions, diffOptions } from "../src/client/ViewToggle";

test("layout toggle renders labeled icon buttons with one active selection", () => {
  for (const option of layoutOptions) {
    const html = renderToStaticMarkup(createElement(ViewToggle, { label: "Viewer layout", value: option.value, options: layoutOptions, onChange: () => {} }));
    expect(html).toContain('role="group" aria-label="Viewer layout"');
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(html.match(/<button/g)?.length).toBe(3);
    expect(html.match(/<svg/g)?.length).toBe(3);
    expect(html).toContain(`aria-label="${option.label}" title="${option.label}" aria-pressed="true"`);
    expect(html).not.toContain("<select");
  }
});

test("diff toggle presents side-by-side and unified buttons with accessible names", () => {
  const html = renderToStaticMarkup(createElement(ViewToggle, { label: "Diff view", value: "unified", options: diffOptions, onChange: () => {} }));
  expect(html).toContain('role="group" aria-label="Diff view"');
  expect(html).toContain('aria-label="Unified" title="Unified" aria-pressed="true"');
  expect(html).toContain('aria-label="Side-by-side" title="Side-by-side" aria-pressed="false"');
  expect(html.match(/aria-hidden="true"/g)?.length).toBe(2);
});
