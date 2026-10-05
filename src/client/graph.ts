import type { CommitSummary, Reference } from "../repository/types";

type GraphCommit = Pick<CommitSummary, "id" | "parents"> & Partial<Pick<CommitSummary, "references">>;
interface GraphOptions {
  references?: Pick<Reference, "name" | "commitId">[];
  head?: string | null;
}

const mainNames = ["main", "trunk", "mainline", "default", "stable", "master"];
const devNames = ["dev", "devel", "develop", "development"];

function branchPriority(name: string): number {
  const branch = name.match(/^refs\/(?:heads|remotes\/(?:origin|upstream))\/([^/]+)$/)?.[1];
  if (branch && mainNames.includes(branch)) return 0;
  if (branch && devNames.includes(branch)) return 1;
  return 3;
}

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

export function buildCommitGraph(commits: GraphCommit[], options: GraphOptions = {}): { rows: GraphRow[]; columns: number } {
  const byId = new Map(commits.map(commit => [commit.id, commit]));
  const tips = new Map<string, number>();
  const addTip = (id: string, priority: number) => tips.set(id, Math.min(tips.get(id) ?? 3, priority));
  for (const ref of options.references ?? []) {
    if (ref.commitId && /^refs\/(heads|remotes)\//.test(ref.name)
      && (branchPriority(ref.name) < 3 || byId.has(ref.commitId))) addTip(ref.commitId, branchPriority(ref.name));
  }
  for (const commit of commits) {
    for (const ref of commit.references ?? []) {
      if (/^refs\/(heads|remotes)\//.test(ref)) addTip(commit.id, branchPriority(ref));
    }
  }
  if (options.head) addTip(options.head, 2);
  const assigned = new Map<string, number>();
  const indices = new Map(commits.map((commit, index) => [commit.id, index]));
  const children = new Map<string, Set<string>>();
  for (const commit of commits) {
    for (const parent of commit.parents) {
      const ids = children.get(parent) ?? new Set<string>();
      ids.add(commit.id);
      children.set(parent, ids);
    }
  }
  const occupied: { start: number; end: number; tip: string }[][] = [];
  let nextColumn = 0;
  const extended = new Set<string>();
  const assignChain = (tip: string) => {
    if (assigned.has(tip)) return;
    const chain: string[] = [];
    let id: string | undefined = tip;
    while (id && !assigned.has(id)) {
      chain.push(id);
      id = byId.get(id)?.parents[0];
    }
    const start = (tips.get(tip) ?? 3) < 3 ? 0 : indices.get(tip) ?? 0;
    const lastIndex = indices.get(chain.at(-1)!) ?? Infinity;
    const ancestorIndex = id ? indices.get(id) ?? Infinity : lastIndex;
    const ancestorColumn = id ? assigned.get(id) : undefined;
    const blocked = id && commits.some((commit, index) => index <= lastIndex
      && assigned.get(commit.id) === ancestorColumn
      && commit.parents[0] !== id && (indices.get(commit.parents[0]!) ?? Infinity) > lastIndex);
    const end = (tips.get(tip) ?? 3) < 3 || blocked
      ? ancestorIndex
      : lastIndex + (id ? 0.5 : 0);
    const canContinue = id && !extended.has(id)
      && (children.get(id)?.size === 1 || occupied[ancestorColumn!]?.some(range => range.tip === id))
      && !occupied[ancestorColumn!]?.some(range => range.tip !== id
        && start <= range.end && lastIndex >= range.start);
    let column = canContinue ? ancestorColumn! : ancestorColumn === undefined ? 0 : ancestorColumn + 1;
    if (!canContinue) {
      while (occupied[column]?.some(range => start <= range.end && end >= range.start)) column++;
    }
    if (canContinue) extended.add(id!);
    (occupied[column] ??= []).push({ start, end, tip });
    nextColumn = Math.max(nextColumn, column + 1);
    for (const item of chain) assigned.set(item, column);
  };
  // Reserve priority spines, reusing lanes only where their row ranges do not overlap.
  // Among equal priorities, descendants claim their spine before ancestor refs.
  for (const [tip] of [...tips].sort((a, b) => a[1] - b[1]
    || (indices.get(a[0]) ?? Infinity) - (indices.get(b[0]) ?? Infinity))) assignChain(tip);
  for (const commit of commits) assignChain(commit.id);
  for (const commit of commits) for (const parent of commit.parents) assignChain(parent);
  const lanes: (string | null)[] = [];
  let columns = 0;
  const rows = commits.map(commit => {
    const before = [...lanes];
    const column = assigned.get(commit.id)!;
    columns = Math.max(columns, column + 1);
    const incoming = before.flatMap((id, lane) => id == null
      ? [] : [{ from: lane, to: id === commit.id ? column : lane, color: lane }]);
    before.forEach((id, lane) => { if (id === commit.id) lanes[lane] = null; });
    const outgoing: GraphEdge[] = [];
    [...new Set(commit.parents)].forEach((parent, index) => {
      // Join the parent's spine after the last unique commit, freeing the side lane.
      let target = assigned.get(parent)!;
      if (index === 0 && lanes[target] != null && lanes[target] !== parent) target = column;
      if (index > 0 && (target <= column || (lanes[target] != null && lanes[target] !== parent))) {
        target = Math.max(nextColumn, lanes.length);
        nextColumn = target + 1;
      }
      lanes[target] = parent;
      outgoing.push({ from: column, to: target, color: target });
    });
    before.forEach((id, lane) => {
      if (id != null && id !== commit.id) outgoing.push({ from: lane, to: lane, color: lane });
    });
    columns = Math.max(columns, lanes.length);
    while (lanes.length && lanes.at(-1) === null) lanes.pop();
    return { column, incoming, outgoing };
  });
  return { rows, columns };
}
