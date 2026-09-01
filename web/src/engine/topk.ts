/**
 * Keeps the K best items seen out of a stream, without holding onto the rest.
 *
 * "Best" is whatever `isBetter(a, b)` says: true when `a` should rank ahead of
 * `b`. Every item offered is compared against the worst item currently kept -
 * offering costs O(log K), so streaming through a search space of hundreds of
 * thousands of exam systems while keeping the best 1000 of them stays fast.
 *
 * This is what turns "the first K systems that passed the thresholds" into
 * "the K best systems out of everything the search looked at": the search no
 * longer stops the moment K systems have been found, it keeps looking for a
 * better one to swap in until its budget (how many systems to examine, or how
 * long it may run) is spent.
 */

export class BoundedBest<T> {
  /** A binary min-heap ordered so the worst kept item is always the root. */
  private readonly heap: T[] = [];

  constructor(private readonly limit: number, private readonly isBetter: (a: T, b: T) => boolean) {}

  get items(): readonly T[] {
    return this.heap;
  }

  get size(): number {
    return this.heap.length;
  }

  /** True when `a` is worse than `b` - the one that belongs closer to the root. */
  private worse(a: T, b: T): boolean {
    return this.isBetter(b, a);
  }

  offer(item: T): void {
    if (this.limit <= 0) return;
    if (this.heap.length < this.limit) {
      this.heap.push(item);
      this.siftUp(this.heap.length - 1);
      return;
    }
    if (this.isBetter(item, this.heap[0])) {
      this.heap[0] = item;
      this.siftDown(0);
    }
  }

  private siftUp(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.worse(this.heap[index], this.heap[parent])) break;
      [this.heap[parent], this.heap[index]] = [this.heap[index], this.heap[parent]];
      index = parent;
    }
  }

  private siftDown(index: number): void {
    const size = this.heap.length;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let candidate = index;
      if (left < size && this.worse(this.heap[left], this.heap[candidate])) candidate = left;
      if (right < size && this.worse(this.heap[right], this.heap[candidate])) candidate = right;
      if (candidate === index) return;
      [this.heap[candidate], this.heap[index]] = [this.heap[index], this.heap[candidate]];
      index = candidate;
    }
  }
}
