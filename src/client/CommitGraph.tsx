import { segmentPath, laneX as x } from "./graphGeometry";
import type { GraphRow } from "./graph";

import { graphWidth } from "./graphViewport";
const colors = ["#9eb3e8", "#b9a4ed", "#80c8b5", "#e4b878", "#d593b8", "#89bfdc"];
const color = (lane: number) => colors[lane % colors.length];

export function CommitGraph({ row, width }: { row: GraphRow; width: number }) {
  return <svg className="commit-graph" width={graphWidth(width)} height="100%" aria-hidden="true">
    {row.segments.map((segment, index) => <path key={index} d={segmentPath(segment)} stroke={color(segment.to)} />)}
    <circle cx={x(row.lane)} cy={22} r={row.root ? 5 : 4} stroke={color(row.lane)} className={row.root ? "graph-root" : undefined} />
    {row.root && <circle cx={x(row.lane)} cy={22} r={2} style={{ fill: color(row.lane), stroke: "none" }} />}
  </svg>;
}
