import { useMemo } from "react";
import { splitPatch, type DiffMode } from "./diff";

export function DiffPatch({ patch, mode, wrap = false }: { patch: string; mode: DiffMode; wrap?: boolean }) {
  const rows = useMemo(() => mode === "split" ? splitPatch(patch) : [], [patch, mode]);
  if (mode === "unified") return <pre className={`patch${wrap ? " wrap-lines" : ""}`} aria-label="File diff"><code>{patch.split("\n").map((line, index) => <span key={index} className={line.startsWith("+") ? "addition" : line.startsWith("-") ? "deletion" : line.startsWith("@@") ? "hunk" : undefined}>{line || " "}</span>)}</code></pre>;
  return <div className={`split-patch${wrap ? " wrap-lines" : ""}`} style={wrap ? { gridTemplateRows: `auto repeat(${rows.length}, auto)` } : undefined} aria-label="Side-by-side file diff">
    {(["left", "right"] as const).map(side => <div className="split-side" style={wrap ? { gridRow: `1 / span ${rows.length + 1}` } : undefined} key={side} role="region" aria-label={side === "left" ? "Before changes" : "After changes"} tabIndex={0}>
      <div className="split-title">{side === "left" ? "Before" : "After"}</div>
      <pre><code>{rows.map((row, index) => {
        if ("header" in row) return <span className="split-line hunk" key={index}>{row.header || " "}</span>;
        const line = row[side];
        return <span className={`split-line ${line?.kind ?? "placeholder"}`} key={index}><span className="line-number" aria-hidden="true">{line?.number ?? " "}</span>{line?.text || " "}{line?.noNewline && <span className="no-newline" title="No newline at end of file"> ⏎ No newline at end of file</span>}</span>;
      })}</code></pre>
    </div>)}
  </div>;
}
