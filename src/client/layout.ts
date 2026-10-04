export const layoutModes = ["columns", "left", "bottom"] as const;
export type LayoutMode = typeof layoutModes[number];
export type PaneSizes = { primary: number; secondary: number };
export type LayoutConfig = { mode: LayoutMode; sizes: Record<LayoutMode, PaneSizes> };
export const layoutStorageKey = "gitudium.layout.v1";

export function defaultLayout(): LayoutConfig {
  return { mode: "columns", sizes: { columns: { primary: 30, secondary: 30 }, left: { primary: 30, secondary: 40 }, bottom: { primary: 50, secondary: 40 } } };
}

export function clampSize(value: number) {
  return Math.max(15, Math.min(85, value));
}

export function readLayout(storage: Pick<Storage, "getItem">): LayoutConfig {
  const config = defaultLayout();
  try {
    const saved = JSON.parse(storage.getItem(layoutStorageKey) ?? "null");
    if (!saved || typeof saved !== "object") return config;
    if (layoutModes.includes(saved.mode)) config.mode = saved.mode;
    for (const mode of layoutModes) {
      for (const axis of ["primary", "secondary"] as const) {
        const value = saved.sizes?.[mode]?.[axis];
        if (typeof value === "number" && Number.isFinite(value)) config.sizes[mode][axis] = clampSize(value);
      }
    }
  } catch { /* Storage may be unavailable or contain invalid JSON. */ }
  return config;
}

export function writeLayout(storage: Pick<Storage, "setItem">, config: LayoutConfig) {
  try { storage.setItem(layoutStorageKey, JSON.stringify(config)); } catch { /* Keep the layout usable when storage is unavailable. */ }
}
