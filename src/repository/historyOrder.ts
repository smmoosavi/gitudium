import type { CommitSummary } from "./types";
import { indexCommitTopology } from "./commitTopology";

export function orderHistory<T extends Pick<CommitSummary, "id" | "parents" | "references">>(source: T[], head: string | null = null): T[] {
  const { indexes, priorities } = indexCommitTopology(source, head);
  const children: number[][] = source.map(() => []);
  const roots: number[] = [];
  const first = source.map((_, index) => index);
  const importance = [...priorities];
  source.forEach((commit, index) => {
    let loadedParents = 0;
    for (const id of commit.parents) {
      const parent = indexes.get(id);
      if (parent === undefined) continue;
      children[parent]!.push(index);
      importance[parent] = Math.min(importance[parent]!, importance[index]!);
      first[parent] = Math.min(first[parent]!, first[index]!);
      loadedParents++;
    }
    if (!loadedParents) roots.push(index);
  });
  roots.sort((left, right) => importance[left]! - importance[right]! || first[left]! - first[right]!);
  for (const [parent, list] of children.entries()) {
    list.sort((left, right) => priorities[left]! - priorities[right]!
      || Number(source[left]!.parents[0] !== source[parent]!.id) - Number(source[right]!.parents[0] !== source[parent]!.id)
      || left - right);
  }
  const ordered: T[] = [];
  const visited = new Set<number>();
  for (const root of roots) {
    if (visited.has(root)) continue;
    const stack = [{ index: root, child: 0 }];
    visited.add(root);
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const child = children[frame.index]![frame.child++];
      if (child === undefined) {
        ordered.push(source[frame.index]!);
        stack.pop();
      } else if (!visited.has(child)) {
        visited.add(child);
        stack.push({ index: child, child: 0 });
      }
    }
  }
  return ordered;
}
