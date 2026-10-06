import type { GraphRow } from "./graph";

import { graphLaneWidth, graphWidth } from "./graphViewport";
const x = (lane: number) => 16 + lane * graphLaneWidth;
const colors = ["#9eb3e8", "#b9a4ed", "#80c8b5", "#e4b878", "#d593b8", "#89bfdc"];
const color = (lane: number) => colors[lane % colors.length];

export function CommitGraph({ row, width }: { row: GraphRow; width: number }) {
  return <svg className="commit-graph" width={graphWidth(width)} height="100%" aria-hidden="true">
    {row.above.map(lane => <path key={`above-${lane}`} d={`M ${x(lane)} 0 V 22`} stroke={color(lane)} />)}
    {row.below.map(lane => <path key={`below-${lane}`} d={`M ${x(lane)} 22 V 10000`} stroke={color(lane)} />)}
    {row.outgoing.map((edge, index) => <path key={`edge-${index}`} stroke={color(edge.to)}
      d={edge.from === edge.to ? `M ${x(edge.from)} 22 V 10000` : `M ${x(edge.from)} 22 C ${x(edge.from)} 36, ${x(edge.to)} 36, ${x(edge.to)} 50 V 10000`} />)}
    <circle cx={x(row.lane)} cy={22} r={row.root ? 5 : 4} stroke={color(row.lane)} className={row.root ? "graph-root" : undefined} />
    {row.root && <circle cx={x(row.lane)} cy={22} r={2} style={{ fill: color(row.lane), stroke: "none" }} />}
  </svg>;
}
