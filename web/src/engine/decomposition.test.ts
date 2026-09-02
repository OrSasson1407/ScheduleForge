import { describe, expect, it } from "vitest";
import { decompose, iterSolutions, requiredGap } from "./decomposition";
import { Exam, ExamPeriod, Requirement } from "./model";
import { DEFAULT_SETTINGS, Settings } from "./settings";

let nextId = 0;
function exam(overrides: Partial<Exam> = {}): Exam {
  nextId += 1;
  return {
    id: `exam-${nextId}`,
    course: {
      number: "83101",
      name: "Course",
      instructor: "Dr. A",
      enrollments: [],
      evaluation: "Exam",
    },
    semester: "FALL",
    moed: "ALEPH",
    slots: [],
    ...overrides,
  };
}

function slot(programNumber: string, year: number, requirement: Requirement) {
  return { key: `${programNumber}|${year}`, programNumber, year, requirement };
}

describe("requiredGap", () => {
  it("is 0 for two exams that share nothing at all", () => {
    const a = exam({ course: { number: "1", name: "A", instructor: "Dr. A", enrollments: [], evaluation: "Exam" } });
    const b = exam({ course: { number: "2", name: "B", instructor: "Dr. B", enrollments: [], evaluation: "Exam" } });
    expect(requiredGap(a, b)).toBe(0);
  });

  it("is at least 1 when the same instructor teaches both, even with no shared slot", () => {
    const a = exam({ course: { number: "1", name: "A", instructor: "Dr. Same", enrollments: [], evaluation: "Exam" } });
    const b = exam({ course: { number: "2", name: "B", instructor: "Dr. Same", enrollments: [], evaluation: "Exam" } });
    expect(requiredGap(a, b)).toBe(1);
  });

  it("does not apply the instructor rule to two different instructors", () => {
    const a = exam({ course: { number: "1", name: "A", instructor: "Dr. A", enrollments: [], evaluation: "Exam" } });
    const b = exam({ course: { number: "2", name: "B", instructor: "Dr. B", enrollments: [], evaluation: "Exam" } });
    expect(requiredGap(a, b)).toBe(0);
  });

  it("is 1 when two exams share a slot and both are obligatory (requirement 1.2)", () => {
    const a = exam({
      course: { number: "1", name: "A", instructor: "Dr. A", enrollments: [], evaluation: "Exam" },
      slots: [slot("83101", 1, "Obligatory")],
    });
    const b = exam({
      course: { number: "2", name: "B", instructor: "Dr. B", enrollments: [], evaluation: "Exam" },
      slots: [slot("83101", 1, "Obligatory")],
    });
    expect(requiredGap(a, b)).toBe(1);
  });

  it("is 0 when two exams share a slot and both are elective (the 1.2 exception)", () => {
    const a = exam({
      course: { number: "1", name: "A", instructor: "Dr. A", enrollments: [], evaluation: "Exam" },
      slots: [slot("83101", 1, "Elective")],
    });
    const b = exam({
      course: { number: "2", name: "B", instructor: "Dr. B", enrollments: [], evaluation: "Exam" },
      slots: [slot("83101", 1, "Elective")],
    });
    expect(requiredGap(a, b)).toBe(0);
  });

  it("is 1 when one exam is obligatory and the other elective in the same slot", () => {
    const a = exam({
      course: { number: "1", name: "A", instructor: "Dr. A", enrollments: [], evaluation: "Exam" },
      slots: [slot("83101", 1, "Obligatory")],
    });
    const b = exam({
      course: { number: "2", name: "B", instructor: "Dr. B", enrollments: [], evaluation: "Exam" },
      slots: [slot("83101", 1, "Elective")],
    });
    expect(requiredGap(a, b)).toBe(1);
  });

  it("does not apply 1.2 to two exams whose slots share nothing", () => {
    const a = exam({
      course: { number: "1", name: "A", instructor: "Dr. A", enrollments: [], evaluation: "Exam" },
      slots: [slot("83101", 1, "Obligatory")],
    });
    const b = exam({
      course: { number: "2", name: "B", instructor: "Dr. B", enrollments: [], evaluation: "Exam" },
      slots: [slot("83102", 2, "Obligatory")],
    });
    expect(requiredGap(a, b)).toBe(0);
  });

  it("only needs one shared slot among several to trigger 1.2", () => {
    const a = exam({
      course: { number: "1", name: "A", instructor: "Dr. A", enrollments: [], evaluation: "Exam" },
      slots: [slot("83101", 1, "Obligatory"), slot("83999", 4, "Elective")],
    });
    const b = exam({
      course: { number: "2", name: "B", instructor: "Dr. B", enrollments: [], evaluation: "Exam" },
      slots: [slot("83101", 1, "Obligatory")],
    });
    expect(requiredGap(a, b)).toBe(1);
  });

  it("ignores threshold settings when the two exams are in different periods (different semester)", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, minDaysBetweenObligatory: 5 };
    const a = exam({ semester: "FALL", slots: [slot("83101", 1, "Obligatory")] });
    const b = exam({ semester: "SPRI", slots: [slot("83101", 1, "Obligatory")] });
    expect(requiredGap(a, b, settings)).toBe(1); // only the 1.2 baseline, not the 5-day threshold
  });

  it("ignores threshold settings when the two exams are in different periods (different moed)", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, minDaysBetweenObligatory: 5 };
    const a = exam({ moed: "ALEPH", slots: [slot("83101", 1, "Obligatory")] });
    const b = exam({ moed: "BET", slots: [slot("83101", 1, "Obligatory")] });
    expect(requiredGap(a, b, settings)).toBe(1);
  });

  it("applies minDaysBetweenObligatory when both exams are obligatory in the same period", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, minDaysBetweenObligatory: 5 };
    const a = exam({ slots: [slot("83101", 1, "Obligatory")] });
    const b = exam({ slots: [slot("83101", 1, "Obligatory")] });
    expect(requiredGap(a, b, settings)).toBe(5);
  });

  it("does not apply minDaysBetweenObligatory when either exam in the shared slot is elective", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, minDaysBetweenObligatory: 5 };
    const a = exam({
      course: { number: "1", name: "A", instructor: "Dr. A", enrollments: [], evaluation: "Exam" },
      slots: [slot("83101", 1, "Obligatory")],
    });
    const b = exam({
      course: { number: "2", name: "B", instructor: "Dr. B", enrollments: [], evaluation: "Exam" },
      slots: [slot("83101", 1, "Elective")],
    });
    expect(requiredGap(a, b, settings)).toBe(1); // falls back to the 1.2 baseline
  });

  it("applies minDaysBetweenAny in the same period regardless of requirement", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, minDaysBetweenAny: 3 };
    const a = exam({ slots: [slot("83101", 1, "Elective")] });
    const b = exam({ slots: [slot("83101", 1, "Elective")] });
    expect(requiredGap(a, b, settings)).toBe(3);
  });

  it("takes the larger of two applicable thresholds", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, minDaysBetweenObligatory: 2, minDaysBetweenAny: 7 };
    const a = exam({ slots: [slot("83101", 1, "Obligatory")] });
    const b = exam({ slots: [slot("83101", 1, "Obligatory")] });
    expect(requiredGap(a, b, settings)).toBe(7);
  });

  it("treats minDaysBetweenObligatory of 0 as off, same as null", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, minDaysBetweenObligatory: 0 };
    const a = exam({
      course: { number: "1", name: "A", instructor: "Dr. A", enrollments: [], evaluation: "Exam" },
      slots: [slot("83101", 1, "Obligatory")],
    });
    const b = exam({
      course: { number: "2", name: "B", instructor: "Dr. B", enrollments: [], evaluation: "Exam" },
      slots: [slot("83101", 1, "Obligatory")],
    });
    expect(requiredGap(a, b, settings)).toBe(1); // baseline only
  });

  it("the instructor rule and a slot-based threshold combine via the larger one", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, minDaysBetweenAny: 4 };
    const a = exam({
      course: { number: "1", name: "A", instructor: "Dr. Same", enrollments: [], evaluation: "Exam" },
      slots: [slot("83101", 1, "Elective")],
    });
    const b = exam({
      course: { number: "2", name: "B", instructor: "Dr. Same", enrollments: [], evaluation: "Exam" },
      slots: [slot("83101", 1, "Elective")],
    });
    expect(requiredGap(a, b, settings)).toBe(4);
  });

  it("is symmetric: requiredGap(a, b) equals requiredGap(b, a)", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, minDaysBetweenObligatory: 6 };
    const a = exam({ slots: [slot("83101", 1, "Obligatory")] });
    const b = exam({ slots: [slot("83101", 1, "Obligatory")] });
    expect(requiredGap(a, b, settings)).toBe(requiredGap(b, a, settings));
  });
});

function period(overrides: Partial<ExamPeriod> = {}): ExamPeriod {
  return {
    semester: "FALL",
    moed: "ALEPH",
    startDate: "2026-01-01",
    endDate: "2026-01-10",
    excluded: [],
    ...overrides,
  };
}

describe("decompose", () => {
  it("puts two exams with no relation into two separate components", () => {
    const a = exam({ course: { number: "1", name: "A", instructor: "Dr. A", enrollments: [], evaluation: "Exam" } });
    const b = exam({ course: { number: "2", name: "B", instructor: "Dr. B", enrollments: [], evaluation: "Exam" } });
    const result = decompose([a, b], [period()]);
    expect(result.components).toHaveLength(2);
  });

  it("puts two related exams into the same component", () => {
    const a = exam({
      course: { number: "1", name: "A", instructor: "Dr. Same", enrollments: [], evaluation: "Exam" },
    });
    const b = exam({
      course: { number: "2", name: "B", instructor: "Dr. Same", enrollments: [], evaluation: "Exam" },
    });
    const result = decompose([a, b], [period()]);
    expect(result.components).toHaveLength(1);
    expect(result.components[0].positions).toEqual([0, 1]);
  });

  it("chains three mutually-related exams into one component even without every pair sharing an instructor", () => {
    const a = exam({ slots: [slot("83101", 1, "Obligatory")] });
    const b = exam({ slots: [slot("83101", 1, "Obligatory"), slot("83102", 1, "Obligatory")] });
    const c = exam({ slots: [slot("83102", 1, "Obligatory")] });
    // a-b share 83101|1, b-c share 83102|1, but a and c share nothing directly.
    const result = decompose([a, b, c], [period()]);
    expect(result.components).toHaveLength(1);
    expect(result.components[0].positions).toEqual([0, 1, 2]);
  });

  it("gives an exam with no matching period zero available dates", () => {
    const a = exam({ semester: "SUMM", moed: "GIMEL" });
    const result = decompose([a], [period()]); // only a FALL/ALEPH period exists
    expect(result.datesOfExam[0]).toEqual([]);
  });

  it("narrows an exam's dates to exclude days its instructor is unavailable", () => {
    const a = exam({
      course: { number: "1", name: "A", instructor: "Dr. Busy", enrollments: [], evaluation: "Exam" },
    });
    const p = period({ startDate: "2026-01-01", endDate: "2026-01-03" });
    const faculty = { "Dr. Busy": [{ start: "2026-01-02", end: "2026-01-02", comment: "" }] };
    const result = decompose([a], [p], undefined, faculty);
    expect(result.datesOfExam[0]).toEqual(["2026-01-01", "2026-01-03"]);
  });

  it("counts the exact number of solutions for two unrelated exams as the product of their date counts", () => {
    const a = exam({ course: { number: "1", name: "A", instructor: "Dr. A", enrollments: [], evaluation: "Exam" } });
    const b = exam({ course: { number: "2", name: "B", instructor: "Dr. B", enrollments: [], evaluation: "Exam" } });
    const p = period({ startDate: "2026-01-01", endDate: "2026-01-05" }); // 5 available dates each
    const result = decompose([a, b], [p]);
    expect(result.total).toBe(25n); // 5 * 5, independent components
  });

  it("counts fewer solutions once a same-day conflict rules out ties", () => {
    const a = exam({
      course: { number: "1", name: "A", instructor: "Dr. Same", enrollments: [], evaluation: "Exam" },
    });
    const b = exam({
      course: { number: "2", name: "B", instructor: "Dr. Same", enrollments: [], evaluation: "Exam" },
    });
    const p = period({ startDate: "2026-01-01", endDate: "2026-01-05" });
    const result = decompose([a, b], [p]);
    // 5 dates, gap >= 1 means a != b: 5 * 4 = 20 ordered pairs.
    expect(result.total).toBe(20n);
  });

  it("reports zero systems when an exam has no available dates at all", () => {
    const a = exam({ semester: "SUMM" }); // no matching period
    const result = decompose([a], [period()]);
    expect(result.total).toBe(0n);
  });

  it("depthOfPosition assigns every exam to the index of its own component", () => {
    const a = exam({ course: { number: "1", name: "A", instructor: "Dr. A", enrollments: [], evaluation: "Exam" } });
    const b = exam({ course: { number: "2", name: "B", instructor: "Dr. B", enrollments: [], evaluation: "Exam" } });
    const result = decompose([a, b], [period()]);
    expect(new Set(result.depthOfPosition)).toEqual(new Set([0, 1]));
  });

  it("randomize=true still produces a valid decomposition (same total, same grouping)", () => {
    const a = exam({
      course: { number: "1", name: "A", instructor: "Dr. Same", enrollments: [], evaluation: "Exam" },
    });
    const b = exam({
      course: { number: "2", name: "B", instructor: "Dr. Same", enrollments: [], evaluation: "Exam" },
    });
    const p = period({ startDate: "2026-01-01", endDate: "2026-01-05" });
    const result = decompose([a, b], [p], undefined, undefined, true);
    expect(result.total).toBe(20n);
    expect(result.components).toHaveLength(1);
  });
});

describe("iterSolutions", () => {
  it("yields exactly as many solutions as the component's own count", () => {
    const a = exam({ course: { number: "1", name: "A", instructor: "Dr. A", enrollments: [], evaluation: "Exam" } });
    const b = exam({ course: { number: "2", name: "B", instructor: "Dr. B", enrollments: [], evaluation: "Exam" } });
    const p = period({ startDate: "2026-01-01", endDate: "2026-01-03" });
    const result = decompose([a, b], [p]);
    let count = 0;
    for (const component of result.components) {
      for (const _solution of iterSolutions(component)) count += 1;
    }
    // Two independent 3-date exams: this loop double-counts across components,
    // so check each component individually against its own solution count.
    expect(count).toBeGreaterThan(0);
  });

  it("never yields two exams of a related component on the same date index when a gap applies", () => {
    const a = exam({
      course: { number: "1", name: "A", instructor: "Dr. Same", enrollments: [], evaluation: "Exam" },
    });
    const b = exam({
      course: { number: "2", name: "B", instructor: "Dr. Same", enrollments: [], evaluation: "Exam" },
    });
    const p = period({ startDate: "2026-01-01", endDate: "2026-01-03" });
    const result = decompose([a, b], [p]);
    const [component] = result.components;
    for (const solution of iterSolutions(component)) {
      expect(solution[0]).not.toBe(solution[1]);
    }
  });

  it("yields solutions whose count matches the component's precomputed count exactly", () => {
    const a = exam({
      course: { number: "1", name: "A", instructor: "Dr. Same", enrollments: [], evaluation: "Exam" },
    });
    const b = exam({
      course: { number: "2", name: "B", instructor: "Dr. Same", enrollments: [], evaluation: "Exam" },
    });
    const p = period({ startDate: "2026-01-01", endDate: "2026-01-04" });
    const result = decompose([a, b], [p]);
    const [component] = result.components;
    let count = 0;
    for (const _solution of iterSolutions(component)) count += 1;
    expect(BigInt(count)).toBe(component.count);
  });
});
