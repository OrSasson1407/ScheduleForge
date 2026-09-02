import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BenchmarkRun, clearBenchmarks, loadBenchmarks, recordBenchmark } from "./benchmarks";

function run(overrides: Partial<BenchmarkRun> = {}): BenchmarkRun {
  return {
    at: "2026-01-01T00:00:00.000Z",
    exams: 10,
    totalSystems: "1000",
    examined: 500,
    accepted: 20,
    kept: 5,
    seconds: 1.5,
    bestAverageGap: 3.2,
    ...overrides,
  };
}

beforeEach(() => {
  clearBenchmarks();
});

describe("loadBenchmarks", () => {
  it("returns an empty list when nothing has been recorded", () => {
    expect(loadBenchmarks()).toEqual([]);
  });

  it("returns an empty list when the stored value is not valid JSON", () => {
    window.localStorage.setItem("scheduleforge.v3.benchmarks", "{not json");
    expect(loadBenchmarks()).toEqual([]);
  });

  it("returns an empty list when the stored value is valid JSON but not an array", () => {
    window.localStorage.setItem("scheduleforge.v3.benchmarks", JSON.stringify({ not: "an array" }));
    expect(loadBenchmarks()).toEqual([]);
  });

  it("returns the previously recorded runs", () => {
    recordBenchmark(run());
    expect(loadBenchmarks()).toHaveLength(1);
  });
});

describe("recordBenchmark", () => {
  it("appends a run to the stored history", () => {
    recordBenchmark(run({ exams: 1 }));
    recordBenchmark(run({ exams: 2 }));
    const history = loadBenchmarks();
    expect(history.map((r) => r.exams)).toEqual([1, 2]);
  });

  it("returns the updated history", () => {
    const result = recordBenchmark(run());
    expect(result).toHaveLength(1);
  });

  it("keeps only the most recent 50 runs", () => {
    for (let i = 0; i < 55; i += 1) recordBenchmark(run({ exams: i }));
    const history = loadBenchmarks();
    expect(history).toHaveLength(50);
    expect(history[0].exams).toBe(5); // the oldest 5 were dropped
    expect(history[49].exams).toBe(54);
  });

  it("persists a run with a null totalSystems and bestAverageGap", () => {
    recordBenchmark(run({ totalSystems: null, bestAverageGap: null }));
    const history = loadBenchmarks();
    expect(history[0].totalSystems).toBeNull();
    expect(history[0].bestAverageGap).toBeNull();
  });

  it("does not throw when localStorage.setItem fails", () => {
    const spy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => recordBenchmark(run())).not.toThrow();
    spy.mockRestore();
  });
});

describe("clearBenchmarks", () => {
  it("removes all recorded history", () => {
    recordBenchmark(run());
    clearBenchmarks();
    expect(loadBenchmarks()).toEqual([]);
  });

  it("does not throw when there is nothing to clear", () => {
    expect(() => clearBenchmarks()).not.toThrow();
  });

  it("does not throw when localStorage.removeItem fails", () => {
    const spy = vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => clearBenchmarks()).not.toThrow();
    spy.mockRestore();
  });
});

afterEach(() => {
  clearBenchmarks();
});
