import { useMemo } from "react";
import type { DiffMode } from "./diff";
import { buildDiffModel, type DiffEngine, type DiffSegment } from "./diffModel";

function inlineText(text: string, segments?: DiffSegment[]) {
  return segments ? segments.map((segment, index) => segment.changed
    ? <mark className="word-change" key={index}>{segment.text}</mark>
    : segment.text) : text || " ";
}

export function DiffPatch({ patch, mode, wrap = false, engine }: { patch: string; mode: DiffMode; wrap?: boolean; engine?: DiffEngine }) {
  const model = useMemo(() => buildDiffModel(patch, engine), [patch, engine]);
  const rows = model.split;
  if (mode === "unified") return <pre className={`patch${wrap ? " wrap-lines" : ""}`} aria-label="File diff"><code>{model.unified.map((line, index) => <span key={index} className={line.kind}>{line.prefix}{inlineText(line.text, line.segments)}</span>)}</code></pre>;
  return <div className={`split-patch${wrap ? " wrap-lines" : ""}`} style={wrap ? { gridTemplateRows: `auto repeat(${rows.length}, auto)` } : undefined} aria-label="Side-by-side file diff">
    {(["left", "right"] as const).map(side => <div className="split-side" style={wrap ? { gridRow: `1 / span ${rows.length + 1}` } : undefined} key={side} role="region" aria-label={side === "left" ? "Before changes" : "After changes"} tabIndex={0}>
      <div className="split-title">{side === "left" ? "Before" : "After"}</div>
      <pre><code>{rows.map((row, index) => {
        if ("header" in row) return <span className="split-line hunk" key={index}>{row.header || " "}</span>;
        const line = row[side];
        return <span className={`split-line ${line?.kind ?? "placeholder"}`} key={index}><span className="line-number" aria-hidden="true">{line?.number ?? " "}</span>{inlineText(line?.text ?? "", line?.segments)}{line?.noNewline && <span className="no-newline" title="No newline at end of file"> ⏎ No newline at end of file</span>}</span>;
      })}</code></pre>
    </div>)}
  </div>;
}
