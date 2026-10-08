import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { useViewerPreferences } from "../src/client/useViewerPreferences";
import { defaultLayout } from "../src/client/layout";

function Preferences() {
  const { wrap, filesMode, diffMode, layout } = useViewerPreferences();
  return <span>{JSON.stringify({ wrap, filesMode, diffMode, layout })}</span>;
}

test("preference initialization survives blocked localStorage property access and methods", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const expected = renderToStaticMarkup(<span>{JSON.stringify({ wrap: false, filesMode: "list", diffMode: "unified", layout: defaultLayout() })}</span>);
  try {
    for (const window of [
      { get localStorage(): Storage { throw new Error("blocked property"); } },
      { localStorage: { getItem() { throw new Error("blocked method"); } } },
    ]) {
      Object.defineProperty(globalThis, "window", { configurable: true, value: window });
      expect(renderToStaticMarkup(<Preferences />)).toBe(expected);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
