import { describe, expect, it } from "vitest";
import { BoundedBest } from "./topk";

const numericBetter = (a: number, b: number) => a > b;

describe("BoundedBest", () => {
  it("keeps nothing when the limit is 0", () => {
    const best = new BoundedBest<number>(0, numericBetter);
    best.offer(5);
    expect(best.size).toBe(0);
  });

  it("keeps nothing when the limit is negative", () => {
    const best = new BoundedBest<number>(-3, numericBetter);
    best.offer(5);
    expect(best.size).toBe(0);
  });

  it("keeps every item while under the limit", () => {
    const best = new BoundedBest<number>(5, numericBetter);
    [3, 1, 4].forEach((n) => best.offer(n));
    expect(best.size).toBe(3);
    expect([...best.items].sort((a, b) => a - b)).toEqual([1, 3, 4]);
  });

  it("keeps only the limit's worth of items once the stream exceeds it", () => {
    const best = new BoundedBest<number>(3, numericBetter);
    [1, 2, 3, 4, 5].forEach((n) => best.offer(n));
    expect(best.size).toBe(3);
    expect([...best.items].sort((a, b) => a - b)).toEqual([3, 4, 5]);
  });

  it("discards an item worse than everything already kept, once full", () => {
    const best = new BoundedBest<number>(2, numericBetter);
    best.offer(10);
    best.offer(20);
    best.offer(1); // worse than both
    expect([...best.items].sort((a, b) => a - b)).toEqual([10, 20]);
  });

  it("swaps in an item better than the current worst kept item", () => {
    const best = new BoundedBest<number>(2, numericBetter);
    best.offer(10);
    best.offer(20);
    best.offer(15); // better than 10, worse than 20
    expect([...best.items].sort((a, b) => a - b)).toEqual([15, 20]);
  });

  it("keeps the correct top K regardless of the order items arrive in", () => {
    const ascending = new BoundedBest<number>(3, numericBetter);
    [1, 2, 3, 4, 5].forEach((n) => ascending.offer(n));
    const descending = new BoundedBest<number>(3, numericBetter);
    [5, 4, 3, 2, 1].forEach((n) => descending.offer(n));
    expect([...ascending.items].sort((a, b) => a - b)).toEqual([...descending.items].sort((a, b) => a - b));
  });

  it("tolerates duplicate values", () => {
    const best = new BoundedBest<number>(2, numericBetter);
    [5, 5, 5].forEach((n) => best.offer(n));
    expect([...best.items]).toEqual([5, 5]);
  });

  it("handles a limit of 1, keeping only the single best item", () => {
    const best = new BoundedBest<number>(1, numericBetter);
    [3, 9, 1, 7].forEach((n) => best.offer(n));
    expect([...best.items]).toEqual([9]);
  });

  it("matches a slow reference implementation across a larger random stream", () => {
    const values = Array.from({ length: 200 }, () => Math.floor(Math.random() * 1000));
    const K = 10;
    const best = new BoundedBest<number>(K, numericBetter);
    for (const v of values) best.offer(v);
    const expected = [...values].sort((a, b) => b - a).slice(0, K);
    expect([...best.items].sort((a, b) => b - a)).toEqual(expected);
  });

  it("supports a minimizing comparator (keeps the smallest values)", () => {
    const smallerIsBetter = (a: number, b: number) => a < b;
    const best = new BoundedBest<number>(2, smallerIsBetter);
    [5, 3, 8, 1, 9].forEach((n) => best.offer(n));
    expect([...best.items].sort((a, b) => a - b)).toEqual([1, 3]);
  });

  it("supports a comparator over structured objects", () => {
    interface Candidate {
      name: string;
      score: number;
    }
    const better = (a: Candidate, b: Candidate) => a.score > b.score;
    const best = new BoundedBest<Candidate>(2, better);
    best.offer({ name: "a", score: 3 });
    best.offer({ name: "b", score: 9 });
    best.offer({ name: "c", score: 5 });
    const names = [...best.items].map((c) => c.name).sort();
    expect(names).toEqual(["b", "c"]);
  });

  it("size grows as items are added and stays capped at the limit", () => {
    const best = new BoundedBest<number>(3, numericBetter);
    expect(best.size).toBe(0);
    best.offer(1);
    expect(best.size).toBe(1);
    best.offer(2);
    best.offer(3);
    expect(best.size).toBe(3);
    best.offer(4);
    expect(best.size).toBe(3);
  });

  it("items reflects a live view backed by the same heap across offers", () => {
    const best = new BoundedBest<number>(2, numericBetter);
    const view = best.items;
    best.offer(1);
    expect(view).toContain(1);
  });
});
