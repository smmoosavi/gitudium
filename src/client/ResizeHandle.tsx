import { useState, type RefObject } from "react";
import { clampSize } from "./layout";

export function ResizeHandle({ axis, value, initial, label, className, viewer, offset = 0, onChange }: {
  axis: "horizontal" | "vertical"; value: number; initial: number; label: string; className: string;
  viewer: RefObject<HTMLDivElement | null>; offset?: number; onChange: (value: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const vertical = axis === "vertical";
  return <div className={`pane-resizer ${className}${dragging ? " dragging" : ""}`} role="separator" aria-label={label}
    aria-orientation={axis} aria-valuemin={15} aria-valuemax={85} aria-valuenow={Math.round(value)} tabIndex={0}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }}
    onPointerMove={event => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const bounds = viewer.current?.getBoundingClientRect();
      if (!bounds) return;
      const length = vertical ? bounds.width : bounds.height;
      const inset = offset ? (length - 12) * offset / 100 + 6 : 0;
      const start = (vertical ? bounds.left : bounds.top) + inset;
      onChange(clampSize(((vertical ? event.clientX : event.clientY) - start - 3) / (length - inset - 6) * 100));
    }}
    onPointerUp={event => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      setDragging(false);
    }}
    onPointerCancel={() => setDragging(false)} onLostPointerCapture={() => setDragging(false)}
    onDoubleClick={() => onChange(initial)}
    onKeyDown={event => {
      const decrease = vertical ? "ArrowLeft" : "ArrowUp";
      const increase = vertical ? "ArrowRight" : "ArrowDown";
      if (![decrease, increase, "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      onChange(clampSize(event.key === "Home" ? 15 : event.key === "End" ? 85 : value + (event.key === decrease ? -2 : 2)));
    }} />;
}
