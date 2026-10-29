import type { CommitSummary, HistoryPage } from "../repository/types";
import { indexCommitTopology } from "./commitTopology";

// A local min-heap keeps ready commits in priority/source order without sorting
// the whole frontier after every parent becomes available (wide histories).
class ReadyCommits {
  private heap: number[] = [];
  constructor(private priorities: number[]) {}
  private before(a: number, b: number) {
    return this.priorities[a]! < this.priorities[b]!
      || (this.priorities[a] === this.priorities[b] && a < b);
  }
  push(index: number) {
    const heap = this.heap;
    heap.push(index);
    let slot = heap.length - 1;
    while (slot > 0) {
      const parent = (slot - 1) >>> 1;
      if (!this.before(index, heap[parent]!)) break;
      heap[slot] = heap[parent]!;
      slot = parent;
    }
    heap[slot] = index;
  }
  pop(): number | undefined {
    const heap = this.heap;
    const first = heap[0];
    const last = heap.pop();
    if (!heap.length) return first;
    let slot = 0;
    while (slot * 2 + 1 < heap.length) {
      let child = slot * 2 + 1;
      if (child + 1 < heap.length && this.before(heap[child + 1]!, heap[child]!)) child++;
      if (!this.before(heap[child]!, last!)) break;
      heap[slot] = heap[child]!;
      slot = child;
    }
    heap[slot] = last!;
    return first;
  }
}

// Order only independent commits. Every loaded parent, including additional
// merge parents, waits for all its children. Source order breaks equal-priority
// ties; dates never override topology. Missing parents remain open endpoints.
export function orderHistoryPages(pages: Pick<HistoryPage, "commits">[], head: string | null = null): CommitSummary[] {
  const source = pages.flatMap(page => page.commits);
  const { indexes, priorities } = indexCommitTopology(source, head);
  const ordered: CommitSummary[] = [];
  let offset = 0;
  for (const page of pages) {
    const end = offset + page.commits.length;
    const children = new Map<number, number>();
    const parents = new Map<number, number[]>();
    for (let index = offset; index < end; index++) {
      const loaded = source[index]!.parents.flatMap(id => {
        const parent = indexes.get(id);
        return parent !== undefined && parent >= offset && parent < end ? [parent] : [];
      });
      parents.set(index, loaded);
      for (const parent of loaded) children.set(parent, (children.get(parent) ?? 0) + 1);
    }
    const ready = new ReadyCommits(priorities);
    for (let index = offset; index < end; index++) if (!children.has(index)) ready.push(index);
    let index: number | undefined;
    while ((index = ready.pop()) !== undefined) {
      ordered.push(source[index]!);
      for (const parent of parents.get(index)!) {
        const remaining = children.get(parent)! - 1;
        children.set(parent, remaining);
        if (remaining === 0) ready.push(parent);
      }
    }
    // Git's topological pages are immutable cursor slices. Keep those boundaries
    // so appending a page cannot move already displayed commits or their focus.
    offset = end;
  }
  return ordered;
}
