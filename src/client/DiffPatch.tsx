import { useMemo } from "react";
import type { DiffMode } from "./diff";
import type { SyntaxResult } from "./syntaxTypes";
import { applyDiffSyntax } from "./diffSyntax";
import { buildDiffModel, type DiffEngine, type DiffSegment } from "./diffModel";

function inlineText(text: string, segments?: DiffSegment[]) {
  return segments ? segments.map((segment, index) => segment.changed
    ? <mark className="word-change" style={segment.color ? { color: segment.color } : undefined} key={index}>{segment.text}</mark>
    : segment.color ? <span className="syntax-token" style={{ color: segment.color }} key={index}>{segment.text}</span> : segment.text) : text || " ";
}

import { contextPageSize, expandDiffContext, type ContextSources, type ContextExpansion, type ContextGap } from "./diffContext";

function expandIcon(direction: "above" | "below" | "all") {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    {direction !== "above" && <path d="M8 7V2m-3 3 3-3 3 3" />}
    {direction !== "below" && <path d="M8 9v5m-3-3 3 3 3-3" />}
    <path d="M3 8h10" strokeDasharray="1 1.5" />
  </svg>;
}

function gapControls(gap: ContextGap, onExpand?: (id: string, direction: "above" | "below") => void) {
  const compact = gap.count <= contextPageSize;
  return <span className="context-gap"><span className={`context-gap-actions${compact ? " single" : ""}`}>
    <button type="button" aria-label={compact ? "Show all hidden lines" : "Show more below"} title={compact ? "Show all hidden lines" : "Show more below"} onClick={() => onExpand?.(gap.id, "above")}>{expandIcon(compact ? "all" : "above")}</button>
    {!compact && <button type="button" aria-label="Show more above" title="Show more above" onClick={() => onExpand?.(gap.id, "below")}>{expandIcon("below")}</button>}
  </span><span className="context-gap-label">{gap.count} hidden lines</span></span>;
}

export function DiffPatch({ patch, mode, wrap = false, engine, sources, expansion = {}, full = false, onExpand, syntax }: { syntax?: SyntaxResult; patch: string; mode: DiffMode; wrap?: boolean; engine?: DiffEngine; sources?: ContextSources; expansion?: ContextExpansion; full?: boolean; onExpand?: (id: string, direction: "above" | "below") => void }) {
  const base = useMemo(() => buildDiffModel(patch, engine), [patch, engine]);
  const contextModel = useMemo(() => sources ? expandDiffContext(base, sources, expansion, full) : base, [base, sources, expansion, full]);
  const model = useMemo(() => applyDiffSyntax(contextModel, syntax), [contextModel, syntax]);
  const rows = model.split;
  if (mode === "unified") return <pre className={`patch${wrap ? " wrap-lines" : ""}`} aria-label="File diff"><code>{model.unified.map((line, index) => <span key={index} className={line.gap ? "context-gap-row" : line.kind}>{line.gap ? gapControls(line.gap, onExpand) : <>{line.prefix}{inlineText(line.text, line.segments)}</>}</span>)}</code></pre>;
  return <div className={`split-patch${wrap ? " wrap-lines" : ""}`} style={wrap ? { gridTemplateRows: `auto repeat(${rows.length}, auto)` } : undefined} aria-label="Side-by-side file diff">
    {(["left", "right"] as const).map(side => <div className="split-side" style={wrap ? { gridRow: `1 / span ${rows.length + 1}` } : undefined} key={side} role="region" aria-label={side === "left" ? "Before changes" : "After changes"} tabIndex={0}>
      <div className="split-title">{side === "left" ? "Before" : "After"}</div>
      <pre><code>{rows.map((row, index) => {
        if ("header" in row) return <span className="split-line hunk" key={index}>{row.header || " "}</span>;
        if ("gap" in row) return <span className="split-line context-gap-row" key={index}>{side === "left" ? gapControls(row.gap, onExpand) : <span className="context-gap"><span className="context-gap-label">{row.gap.count} hidden lines</span></span>}</span>;
        const line = row[side];
        return <span className={`split-line ${line?.kind ?? "placeholder"}`} key={index}><span className="line-number" aria-hidden="true">{line?.number ?? " "}</span>{inlineText(line?.text ?? "", line?.segments)}{line?.noNewline && <span className="no-newline" title="No newline at end of file"> ⏎ No newline at end of file</span>}</span>;
      })}</code></pre>
    </div>)}
  </div>;
}
