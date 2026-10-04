import type { LayoutMode } from "./layout";
import type { DiffMode } from "./diff";
import type { FilesMode } from "./files";

type View = LayoutMode | DiffMode | FilesMode;
const icons: Record<View, string[]> = {
  columns: ["M8 4v16", "M16 4v16"],
  left: ["M8 4v16", "M8 11h12"],
  bottom: ["M4 12h16", "M12 4v8"],
  unified: [],
  split: ["M12 4v16"],
  tree: ["M8 7v10h3", "M8 12h3", "M13 8h4", "M13 12h4", "M13 17h4"],
  list: ["M7 8h2m2 0h6", "M7 12h2m2 0h6", "M7 16h2m2 0h6"],
};

export const layoutOptions: { value: LayoutMode; label: string }[] = [
  { value: "columns", label: "Three columns" },
  { value: "left", label: "Log left, files above diff" },
  { value: "bottom", label: "Log and files above diff" },
];
export const diffOptions: { value: DiffMode; label: string }[] = [
  { value: "split", label: "Side-by-side" },
  { value: "unified", label: "Unified" },
];

export const filesOptions: { value: FilesMode; label: string }[] = [
  { value: "tree", label: "Tree view" },
  { value: "list", label: "List view" },
];

export function ViewToggle<T extends View>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void;
}) {
  return <div className="view-toggle" role="group" aria-label={label}>
    {options.map(option => <button type="button" key={option.value} aria-label={option.label} title={option.label}
      aria-pressed={value === option.value} onClick={() => onChange(option.value)}
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = options.indexOf(option);
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowLeft" ? -1 : 1) + options.length) % options.length;
        onChange(options[next]!.value);
        (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
      }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
        <rect x="4" y="4" width="16" height="16" rx="1.5" />
        {icons[option.value].map(d => <path key={d} d={d} />)}
      </svg>
    </button>)}
  </div>;
}
