import { useId, useRef } from "react";
import type { WhitespaceMode } from "./diff";
import type { DiffAlgorithm } from "./preferences";
import type { GitDiffAlgorithm } from "../repository/types";

const alignments = [
  ["simple", "Simple", "Pair changed lines by position."],
  ["paired", "Similarity", "Match lines with similar text."],
  ["syntax", "Syntax-aware", "Match syntax tokens with Web Tree-sitter."],
] as const;
const algorithms = [
  ["myers", "Myers (default)", "Fast, general-purpose line matching."],
  ["histogram", "Histogram", "Anchor on uncommon lines; useful for source code."],
  ["patience", "Patience", "Anchor on unique lines; useful for rearranged blocks."],
  ["minimal", "Minimal", "Spend more time finding the smallest change set."],
] as const;

export function DiffOptions({ alignment, algorithm, whitespace, onAlignmentChange, onAlgorithmChange, onWhitespaceChange, status, busy = false }: {
  alignment: DiffAlgorithm; algorithm: GitDiffAlgorithm; whitespace: WhitespaceMode;
  onAlignmentChange: (value: DiffAlgorithm) => void;
  onAlgorithmChange: (value: GitDiffAlgorithm) => void;
  onWhitespaceChange: (value: WhitespaceMode) => void;
  status?: string; busy?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const summary = `${algorithm[0]!.toUpperCase()}${algorithm.slice(1)} · ${alignments.find(option => option[0] === alignment)![1]} · ${whitespace === "none" ? "Include whitespace" : "Ignore whitespace"}`;
  const close = () => { panel.current?.hidePopover(); trigger.current?.focus(); };
  return <div className="diff-options">
    <button ref={trigger} type="button" className="diff-options-toggle" aria-label="Diff options" aria-haspopup="dialog" popoverTarget={id} title={`${summary}${status ? `. ${status}` : ""}`} aria-busy={busy}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M19.69 9.79 L21.85 10.26 L21.85 13.74 L19.69 14.21 L19 15.88 L20.19 17.74 L17.74 20.19 L15.88 19 L14.21 19.69 L13.74 21.85 L10.26 21.85 L9.79 19.69 L8.12 19 L6.26 20.19 L3.81 17.74 L5 15.88 L4.31 14.21 L2.15 13.74 L2.15 10.26 L4.31 9.79 L5 8.12 L3.81 6.26 L6.26 3.81 L8.12 5 L9.79 4.31 L10.26 2.15 L13.74 2.15 L14.21 4.31 L15.88 5 L17.74 3.81 L20.19 6.26 L19 8.12 Z" /><circle cx="12" cy="12" r="3.5" /></svg>
    </button>
    <div ref={panel} id={id} popover="auto" className="diff-options-popover" role="dialog" aria-label="Diff options" onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); close(); }
    }}>
      <div className="diff-options-heading"><strong>Diff options</strong><button type="button" aria-label="Close diff options" onClick={close}>×</button></div>
      <p className="diff-options-help">Git algorithms determine changed lines. Line alignment controls how those changes are displayed.</p>
      <fieldset><legend>Line alignment</legend>{alignments.map(([value, label, description]) => <label key={value}>
        <input type="radio" name={`${id}-alignment`} checked={alignment === value} onChange={() => onAlignmentChange(value)} />
        <span><strong>{label}</strong><small>{description}</small></span>
      </label>)}</fieldset>
      <fieldset><legend>Git algorithm</legend>{algorithms.map(([value, label, description]) => <label key={value}>
        <input type="radio" name={`${id}-algorithm`} checked={algorithm === value} onChange={() => onAlgorithmChange(value)} />
        <span><strong>{label}</strong><small>{description}</small></span>
      </label>)}</fieldset>
      <fieldset className="diff-options-whitespace"><legend>Whitespace</legend>
        <label><input type="radio" name={`${id}-whitespace`} checked={whitespace === "none"} onChange={() => onWhitespaceChange("none")} />Include</label>
        <label><input type="radio" name={`${id}-whitespace`} checked={whitespace !== "none"} onChange={() => onWhitespaceChange("all")} />Ignore</label>
      </fieldset>
      {status && <p className="diff-options-help" role="status">{status}</p>}
      <button type="button" onClick={() => { onAlignmentChange("simple"); onAlgorithmChange("myers"); onWhitespaceChange("none"); }}>Reset to defaults</button>
    </div>
  </div>;
}
