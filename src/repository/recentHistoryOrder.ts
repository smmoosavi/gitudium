import type { HistoryOrderStrategy } from "./historyOrdering";

export const recentHistoryOrder: HistoryOrderStrategy = ({ source }) => {
  const indexes = new Map(source.map((node, index) => [node.id, index]));
  const children = new Uint32Array(source.length);
  for (const node of source) for (const parent of node.parents) {
    const index = indexes.get(parent);
    if (index !== undefined) children[index]!++;
  }
  const heap: number[] = [];
  const before = (left: number, right: number) => {
    const difference = source[left]!.committerTimestamp - source[right]!.committerTimestamp;
    return difference > 0 || difference === 0 && left < right;
  };
  const push = (value: number) => {
    let position = heap.length;
    heap.push(value);
    while (position > 0) {
      const parent = (position - 1) >>> 1;
      if (!before(value, heap[parent]!)) break;
      heap[position] = heap[parent]!;
      position = parent;
    }
    heap[position] = value;
  };
  for (let index = 0; index < source.length; index++) if (children[index] === 0) push(index);
  const result: string[] = [];
  while (heap.length) {
    const index = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      let position = 0;
      while (position * 2 + 1 < heap.length) {
        let child = position * 2 + 1;
        if (child + 1 < heap.length && before(heap[child + 1]!, heap[child]!)) child++;
        if (!before(heap[child]!, last)) break;
        heap[position] = heap[child]!;
        position = child;
      }
      heap[position] = last;
    }
    const node = source[index]!;
    result.push(node.id);
    for (const parent of node.parents) {
      const parentIndex = indexes.get(parent);
      if (parentIndex !== undefined && --children[parentIndex]! === 0) push(parentIndex);
    }
  }
  return result;
};
