/**
 * A history of past searches, kept in the browser (performance benchmarking).
 *
 * Nothing here is sent anywhere: it is a rolling record, per browser, of how
 * long recent searches took and how good what they found was, so a trend -
 * getting faster, getting slower, finding wider gaps or not - is visible
 * without anyone having to remember the numbers from three runs ago.
 */

const STORAGE_KEY = "scheduleforge.v3.benchmarks";
const MAX_RUNS = 50;

export interface BenchmarkRun {
  at: string; // ISO timestamp
  exams: number;
  totalSystems: string | null; // too large for JSON to keep as a number
  examined: number;
  accepted: number;
  kept: number;
  seconds: number;
  bestAverageGap: number | null;
}

export function loadBenchmarks(): BenchmarkRun[] {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    if (!text) return [];
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordBenchmark(run: BenchmarkRun): BenchmarkRun[] {
  const next = [...loadBenchmarks(), run].slice(-MAX_RUNS);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* A browser that refuses to store simply keeps no history between runs. */
  }
  return next;
}

export function clearBenchmarks(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}
