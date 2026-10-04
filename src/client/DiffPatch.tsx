import { useMemo } from "react";
import { splitPatch, type DiffMode } from "./diff";

export function DiffPatch({ patch, mode }: { patch: string; mode: DiffMode }) {
  const rows = useMemo(() => mode === "split" ? splitPatch(patch) : [], [patch, mode]);
  if (mode === "unified") return <pre className="patch" aria-label="File diff"><code>{patch.split("\n").map((line, index) => <span key={index} className={line.startsWith("+") ? "addition" : line.startsWith("-") ? "deletion" : line.startsWith("@@") ? "hunk" : undefined}>{line || " "}</span>)}</code></pre>;
  return <div className="split-patch" aria-label="Side-by-side file diff">
    {(["left", "right"] as const).map(side => <div className="split-side" key={side} role="region" aria-label={side === "left" ? "Before changes" : "After changes"} tabIndex={0}>
      <div className="split-title">{side === "left" ? "Before" : "After"}</div>
      <pre><code>{rows.map((row, index) => {
        if ("header" in row) return <span className="split-line hunk" key={index}>{row.header || " "}</span>;
        const line = row[side];
        return <span className={`split-line ${line?.kind ?? "placeholder"}`} key={index}><span className="line-number" aria-hidden="true">{line?.number ?? " "}</span>{line?.text || " "}{line?.noNewline && <span className="no-newline" title="No newline at end of file"> ⏎ No newline at end of file</span>}</span>;
      })}</code></pre>
    </div>)}
  </div>;
}
