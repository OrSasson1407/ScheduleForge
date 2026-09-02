import { describe, expect, it } from "vitest";
import { NO_PAIR, compareByCriteria, describeMetrics, measure, passesThresholds } from "./quality";
import { Exam, ExamSystem, Requirement } from "./model";

let nextId = 0;
function scheduled(
  date: string,
  slots: { programNumber: string; year: number; requirement: Requirement }[],
  overrides: Partial<Exam> = {}
): ExamSystem[number] {
  nextId += 1;
  const exam: Exam = {
    id: `exam-${nextId}`,
    course: { number: "83101", name: "Course", instructor: "Dr. A", enrollments: [], evaluation: "Exam" },
    semester: "FALL",
    moed: "ALEPH",
    slots: slots.map((s) => ({ key: `${s.programNumber}|${s.year}`, ...s })),
    ...overrides,
  };
  return { exam, date };
}

describe("measure", () => {
  it("returns NO_PAIR sentinels and zero counts for an empty system", () => {
    const metrics = measure([]);
    expect(metrics.min_days_between_obligatory).toBe(NO_PAIR);
    expect(metrics.min_days_between_exams).toBe(NO_PAIR);
    expect(metrics.average_days_between_exams).toBe(0);
    expect(metrics.elective_collisions).toBe(0);
    expect(metrics.obligatory_span).toBe(NO_PAIR);
    expect(metrics.max_exams_per_day).toBe(0);
  });

  it("returns NO_PAIR for a single exam with no pair to compare", () => {
    const system = [scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }])];
    const metrics = measure(system);
    expect(metrics.min_days_between_obligatory).toBe(NO_PAIR);
    expect(metrics.average_days_between_exams).toBe(0);
  });

  it("computes the gap between two obligatory exams of the same program and year", () => {
    const system = [
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-06", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
    ];
    const metrics = measure(system);
    expect(metrics.min_days_between_obligatory).toBe(5);
    expect(metrics.min_days_between_exams).toBe(5);
    expect(metrics.average_days_between_exams).toBe(5);
  });

  it("does not count a gap between exams of different programs", () => {
    const system = [
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-02", [{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
    ];
    const metrics = measure(system);
    expect(metrics.min_days_between_obligatory).toBe(NO_PAIR);
  });

  it("does not count a gap between different years of the same program", () => {
    const system = [
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-02", [{ programNumber: "83101", year: 2, requirement: "Obligatory" }]),
    ];
    const metrics = measure(system);
    expect(metrics.min_days_between_obligatory).toBe(NO_PAIR);
  });

  it("takes the smallest gap among more than two exams in the same group", () => {
    const system = [
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-10", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-12", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
    ];
    const metrics = measure(system);
    // pairs: (1,10)=9, (1,12)=11, (10,12)=2 -> smallest is 2
    expect(metrics.min_days_between_obligatory).toBe(2);
  });

  it("min_days_between_exams counts an obligatory/elective pair too, unlike min_days_between_obligatory", () => {
    const system = [
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-03", [{ programNumber: "83101", year: 1, requirement: "Elective" }]),
    ];
    const metrics = measure(system);
    expect(metrics.min_days_between_obligatory).toBe(NO_PAIR); // no obligatory/obligatory pair
    expect(metrics.min_days_between_exams).toBe(2); // but the any-pair gap is counted
  });

  it("counts an elective collision when two electives of the same program land on the same day", () => {
    const system = [
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Elective" }]),
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Elective" }]),
    ];
    const metrics = measure(system);
    expect(metrics.elective_collisions).toBe(1);
    expect(metrics.worst_program_collisions).toBe(1);
  });

  it("does not count a collision between electives on different days", () => {
    const system = [
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Elective" }]),
      scheduled("2026-01-02", [{ programNumber: "83101", year: 1, requirement: "Elective" }]),
    ];
    expect(measure(system).elective_collisions).toBe(0);
  });

  it("does not count a collision between an obligatory and an elective on the same day", () => {
    const system = [
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Elective" }]),
    ];
    expect(measure(system).elective_collisions).toBe(0);
  });

  it("counts collisions per program independently, and worst_program_collisions is the largest one", () => {
    const system = [
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Elective" }]),
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Elective" }]),
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Elective" }]),
      scheduled("2026-01-05", [{ programNumber: "83102", year: 1, requirement: "Elective" }]),
      scheduled("2026-01-05", [{ programNumber: "83102", year: 1, requirement: "Elective" }]),
    ];
    // program 83101: 3 electives on the same day -> C(3,2) = 3 collisions
    // program 83102: 2 electives on the same day -> C(2,2) = 1 collision
    const metrics = measure(system);
    expect(metrics.elective_collisions).toBe(4);
    expect(metrics.worst_program_collisions).toBe(3);
  });

  it("computes obligatory_span as the days from the first to the last obligatory exam of a group", () => {
    const system = [
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-05", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-20", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
    ];
    expect(measure(system).obligatory_span).toBe(19);
  });

  it("does not compute a span for a group with fewer than two obligatory exams", () => {
    const system = [
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-05", [{ programNumber: "83101", year: 1, requirement: "Elective" }]),
    ];
    expect(measure(system).obligatory_span).toBe(NO_PAIR);
  });

  it("takes the smallest span across every group when several qualify", () => {
    const system = [
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-20", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-02-01", [{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-02-03", [{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
    ];
    expect(measure(system).obligatory_span).toBe(2);
  });

  it("max_exams_per_day counts how many exams share the busiest single date", () => {
    const system = [
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-01", [{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-01", [{ programNumber: "83103", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-02", [{ programNumber: "83104", year: 1, requirement: "Obligatory" }]),
    ];
    expect(measure(system).max_exams_per_day).toBe(3);
  });

  it("groups by semester and moed too, not only program and year", () => {
    const system = [
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }], { moed: "ALEPH" }),
      scheduled("2026-01-03", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }], { moed: "BET" }),
    ];
    // Same program/year, but a different moed - a different sitting, not a pair to compare.
    expect(measure(system).min_days_between_obligatory).toBe(NO_PAIR);
  });

  it("an exam with slots in two programs contributes a gap entry to each program's group", () => {
    const system = [
      scheduled("2026-01-01", [
        { programNumber: "83101", year: 1, requirement: "Obligatory" },
        { programNumber: "83102", year: 1, requirement: "Obligatory" },
      ]),
      scheduled("2026-01-04", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
    ];
    expect(measure(system).min_days_between_obligatory).toBe(3);
  });
});

describe("passesThresholds", () => {
  const metrics = measure([
    scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Elective" }]),
    scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Elective" }]),
  ]);

  it("passes when no threshold is active", () => {
    expect(
      passesThresholds(metrics, { maxElectiveCollisions: null, minObligatorySpan: null, maxExamsPerDay: null })
    ).toBe(true);
  });

  it("fails when worst_program_collisions exceeds maxElectiveCollisions", () => {
    expect(
      passesThresholds(metrics, { maxElectiveCollisions: 0, minObligatorySpan: null, maxExamsPerDay: null })
    ).toBe(false);
  });

  it("passes when worst_program_collisions is within maxElectiveCollisions", () => {
    expect(
      passesThresholds(metrics, { maxElectiveCollisions: 5, minObligatorySpan: null, maxExamsPerDay: null })
    ).toBe(true);
  });

  it("passes at exactly the maxElectiveCollisions boundary", () => {
    expect(
      passesThresholds(metrics, { maxElectiveCollisions: 1, minObligatorySpan: null, maxExamsPerDay: null })
    ).toBe(true);
  });

  it("fails when obligatory_span is below minObligatorySpan", () => {
    const tight = measure([
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-02", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
    ]);
    expect(
      passesThresholds(tight, { maxElectiveCollisions: null, minObligatorySpan: 10, maxExamsPerDay: null })
    ).toBe(false);
  });

  it("does not fail minObligatorySpan when the span is NO_PAIR (no group had two obligatory exams)", () => {
    expect(
      passesThresholds(metrics, { maxElectiveCollisions: null, minObligatorySpan: 10, maxExamsPerDay: null })
    ).toBe(true);
  });

  it("fails when max_exams_per_day exceeds maxExamsPerDay", () => {
    const busy = measure([
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-01", [{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
    ]);
    expect(
      passesThresholds(busy, { maxElectiveCollisions: null, minObligatorySpan: null, maxExamsPerDay: 1 })
    ).toBe(false);
  });

  it("treats maxExamsPerDay of 0 as off (falsy), same as null", () => {
    const busy = measure([
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-01", [{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
    ]);
    expect(
      passesThresholds(busy, { maxElectiveCollisions: null, minObligatorySpan: null, maxExamsPerDay: 0 })
    ).toBe(true);
  });
});

describe("compareByCriteria", () => {
  const better = measure([
    scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
    scheduled("2026-01-20", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
  ]);
  const worse = measure([
    scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
    scheduled("2026-01-02", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
  ]);

  it("returns 0 when both systems are identical on the given criteria", () => {
    expect(compareByCriteria(better, better, ["min_days_between_obligatory"])).toBe(0);
  });

  it("returns a negative number when the first system is better on a maximize criterion", () => {
    expect(compareByCriteria(better, worse, ["min_days_between_obligatory"])).toBeLessThan(0);
  });

  it("returns a positive number when the first system is worse on a maximize criterion", () => {
    expect(compareByCriteria(worse, better, ["min_days_between_obligatory"])).toBeGreaterThan(0);
  });

  it("returns a negative number when the first system is better on a minimize criterion", () => {
    const fewCollisions = measure([
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Elective" }]),
    ]);
    const manyCollisions = measure([
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Elective" }]),
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Elective" }]),
    ]);
    expect(compareByCriteria(fewCollisions, manyCollisions, ["elective_collisions"])).toBeLessThan(0);
  });

  it("falls through to the second criterion when the first is tied", () => {
    // Both have the same min_days_between_obligatory but differ elsewhere via average gap.
    const a = measure([
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-10", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
    ]);
    const b = measure([
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-10", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-06-01", [{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-06-10", [{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
    ]);
    // Same min gap (9) but different averages; the first criterion alone ties.
    expect(compareByCriteria(a, a, ["min_days_between_obligatory"])).toBe(0);
    const result = compareByCriteria(a, b, ["min_days_between_obligatory", "average_days_between_exams"]);
    expect(typeof result).toBe("number");
  });

  it("returns 0 for an empty criteria list", () => {
    expect(compareByCriteria(better, worse, [])).toBe(0);
  });

  it("stops at the first criterion that actually differs", () => {
    const first = compareByCriteria(better, worse, ["min_days_between_obligatory", "elective_collisions"]);
    const second = compareByCriteria(better, worse, ["min_days_between_obligatory"]);
    expect(first).toBe(second);
  });
});

describe("describeMetrics", () => {
  it("renders a dash for a NO_PAIR sentinel value", () => {
    const text = describeMetrics(measure([]));
    expect(text).toContain("smallest gap between obligatory exams: -");
    expect(text).toContain("tightest span of obligatory exams: -");
  });

  it("renders a real number when the metric has one", () => {
    const system = [
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-06", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
    ];
    const text = describeMetrics(measure(system));
    expect(text).toContain("smallest gap between obligatory exams: 5");
  });

  it("formats the average gap to two decimal places", () => {
    const system = [
      scheduled("2026-01-01", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-02", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      scheduled("2026-01-06", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
    ];
    const text = describeMetrics(measure(system));
    expect(text).toMatch(/average gap: \d+\.\d{2}/);
  });
});
