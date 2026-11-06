import type { HistoryOrderNode } from "./historyOrdering";

export function referencePriority(reference: string): number {
  const name = reference.match(/^refs\/(?:heads\/|remotes\/(?:origin|upstream)\/)([^/]+)$/)?.[1] ?? "";
  if (["main", "trunk", "mainline", "default", "stable", "master"].includes(name)) return 0;
  if (["dev", "devel", "develop", "development"].includes(name)) return 1;
  return reference === "HEAD" ? 2 : 3;
}

export function indexCommitTopology(commits: readonly HistoryOrderNode[], head: string | null = null) {
  const indexes = new Map(commits.map((commit, index) => [commit.id, index]));
  const priorities = commits.map(commit => Math.min(commit.id === head ? 2 : 3, ...commit.references.map(referencePriority)));
  const firstParentChildren: number[][] = commits.map(() => []);
  commits.forEach((commit, index) => {
    const parent = indexes.get(commit.parents[0] ?? "");
    if (parent !== undefined) {
      firstParentChildren[parent]!.push(index);
      priorities[parent] = Math.min(priorities[parent]!, priorities[index]!);
    }
  });
  return { indexes, priorities, firstParentChildren };
}
