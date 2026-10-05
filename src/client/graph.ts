import type { CommitSummary } from "../repository/types";

export interface GraphEdge {
  from: number;
  to: number;
  color: number;
}

export interface GraphRow {
  column: number;
  incoming: GraphEdge[];
  outgoing: GraphEdge[];
}

export function buildCommitGraph(commits: Pick<CommitSummary, "id" | "parents">[]): { rows: GraphRow[]; columns: number } {
  const lanes: (string | null)[] = [];
  let columns = 0;
  const rows = commits.map(commit => {
    const before = [...lanes];
    let column = lanes.indexOf(commit.id);
    if (column === -1) {
      column = lanes.indexOf(null);
      if (column === -1) column = lanes.length;
      lanes[column] = commit.id;
    }
    columns = Math.max(columns, lanes.length);
    const incoming = before.flatMap((id, lane) => id === null
      ? [] : [{ from: lane, to: lane, color: lane }]);
    lanes[column] = null;
    const outgoing: GraphEdge[] = [];
    for (const parent of new Set(commit.parents)) {
      let target = lanes.indexOf(parent);
      if (target === -1) {
        target = lanes[column] === null ? column : lanes.indexOf(null);
        if (target === -1) target = lanes.length;
        lanes[target] = parent;
      }
      outgoing.push({ from: column, to: target, color: target });
    }
    before.forEach((id, lane) => {
      if (id !== null && lane !== column) outgoing.push({ from: lane, to: lane, color: lane });
    });
    columns = Math.max(columns, lanes.length);
    while (lanes.length && lanes.at(-1) === null) lanes.pop();
    return { column, incoming, outgoing };
  });
  return { rows, columns };
}
