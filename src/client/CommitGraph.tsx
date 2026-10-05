import type { GraphRow } from "./graph";

const laneWidth = 16;
const colors = ["#9eb3e8", "#91c499", "#b9a4ed", "#e6b76a", "#ed9690", "#75c5cc"];
const x = (column: number) => column * laneWidth + laneWidth / 2;
const color = (column: number) => colors[column % colors.length];

export function CommitGraph({ row, columns, root }: { row: GraphRow; columns: number; root: boolean }) {
  const width = columns * laneWidth;
  return <div className="commit-graph" style={{ width }} aria-hidden="true">
    <svg width={width} height="100%" viewBox={`0 0 ${width} 100`} preserveAspectRatio="none">
      {row.incoming.map((edge, index) => <path key={`in-${index}`} d={`M ${x(edge.from)} 0 L ${x(edge.to)} 50`} stroke={color(edge.color)} />)}
      {row.outgoing.map((edge, index) => <path key={`out-${index}`} d={`M ${x(edge.from)} 50 C ${x(edge.from)} 80 ${x(edge.to)} 70 ${x(edge.to)} 100`} stroke={color(edge.color)} />)}
    </svg>
    <span className={`graph-node${root ? " graph-root" : ""}`} style={{ left: x(row.column), borderColor: color(row.column) }} />
  </div>;
}
