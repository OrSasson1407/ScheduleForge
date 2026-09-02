import { describe, expect, it } from "vitest";
import { PartialThresholdChecker } from "./partial";
import { Exam, Requirement } from "./model";
import { DEFAULT_SETTINGS, Settings } from "./settings";

let nextId = 0;
function exam(
  slots: { programNumber: string; year: number; requirement: Requirement }[],
  students?: number
): Exam {
  nextId += 1;
  return {
    id: `exam-${nextId}`,
    course: { number: `8310${nextId}`, name: "Course", instructor: "Dr. A", enrollments: [], evaluation: "Exam", students },
    semester: "FALL",
    moed: "ALEPH",
    slots: slots.map((s) => ({ key: `${s.programNumber}|${s.year}`, ...s })),
  };
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("PartialThresholdChecker.isNeeded", () => {
  it("is false when no threshold and no room capacity apply", () => {
    const checker = new PartialThresholdChecker([], [], settings(), null);
    expect(checker.isNeeded).toBe(false);
  });
  it("is true when maxExamsPerDay is set", () => {
    const checker = new PartialThresholdChecker([], [], settings({ maxExamsPerDay: 2 }), null);
    expect(checker.isNeeded).toBe(true);
  });
  it("is true when maxElectiveCollisions is 0 (not just when truthy)", () => {
    const checker = new PartialThresholdChecker([], [], settings({ maxElectiveCollisions: 0 }), null);
    expect(checker.isNeeded).toBe(true);
  });
  it("is true when minObligatorySpan is set", () => {
    const checker = new PartialThresholdChecker([], [], settings({ minObligatorySpan: 3 }), null);
    expect(checker.isNeeded).toBe(true);
  });
  it("is true when a total room capacity is given, even with no active thresholds", () => {
    const checker = new PartialThresholdChecker([], [], settings(), 100);
    expect(checker.isNeeded).toBe(true);
  });
});

describe("PartialThresholdChecker.apply / unapply - maxExamsPerDay", () => {
  it("allows exams up to the daily limit", () => {
    const exams = [exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }])];
    const checker = new PartialThresholdChecker(exams, [0], settings({ maxExamsPerDay: 1 }), null);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
  });

  it("rejects the exam that pushes a date over the daily limit", () => {
    const exams = [
      exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam([{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
    ];
    const checker = new PartialThresholdChecker(exams, [0, 1], settings({ maxExamsPerDay: 1 }), null);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
    expect(checker.apply(1, [[1, "2026-01-01"]])).toBe(false);
  });

  it("allows exams on different dates even under a tight limit", () => {
    const exams = [
      exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam([{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
    ];
    const checker = new PartialThresholdChecker(exams, [0, 1], settings({ maxExamsPerDay: 1 }), null);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
    expect(checker.apply(1, [[1, "2026-01-02"]])).toBe(true);
  });

  it("unapply frees up the day count so a later apply can succeed again", () => {
    const exams = [
      exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam([{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
    ];
    const checker = new PartialThresholdChecker(exams, [0, 1], settings({ maxExamsPerDay: 1 }), null);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
    expect(checker.apply(1, [[1, "2026-01-01"]])).toBe(false);
    checker.unapply(1);
    checker.unapply(0);
    expect(checker.apply(0, [[0, "2026-01-02"]])).toBe(true);
    expect(checker.apply(1, [[1, "2026-01-01"]])).toBe(true);
  });

  it("treats maxExamsPerDay of 0 as off", () => {
    const exams = [
      exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam([{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
    ];
    const checker = new PartialThresholdChecker(exams, [0, 1], settings({ maxExamsPerDay: 0 }), null);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
    expect(checker.apply(1, [[1, "2026-01-01"]])).toBe(true);
  });

  it("counts several exams applied together in one call toward the same day", () => {
    const exams = [
      exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam([{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
      exam([{ programNumber: "83103", year: 1, requirement: "Obligatory" }]),
    ];
    const checker = new PartialThresholdChecker(exams, [0, 0, 0], settings({ maxExamsPerDay: 2 }), null);
    const ok = checker.apply(0, [
      [0, "2026-01-01"],
      [1, "2026-01-01"],
      [2, "2026-01-01"],
    ]);
    expect(ok).toBe(false);
  });
});

describe("PartialThresholdChecker.apply / unapply - room capacity", () => {
  it("rejects a placement that would exceed the total room capacity for a day", () => {
    const exams = [
      exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }], 60),
      exam([{ programNumber: "83102", year: 1, requirement: "Obligatory" }], 60),
    ];
    const checker = new PartialThresholdChecker(exams, [0, 1], settings(), 100);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
    expect(checker.apply(1, [[1, "2026-01-01"]])).toBe(false);
  });

  it("allows a placement that stays within the total room capacity", () => {
    const exams = [
      exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }], 40),
      exam([{ programNumber: "83102", year: 1, requirement: "Obligatory" }], 40),
    ];
    const checker = new PartialThresholdChecker(exams, [0, 1], settings(), 100);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
    expect(checker.apply(1, [[1, "2026-01-01"]])).toBe(true);
  });

  it("uses the settings' default student count when a course has none", () => {
    const exams = [exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }], undefined)];
    const checker = new PartialThresholdChecker(exams, [0], settings({ defaultStudents: 50 }), 40);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(false);
  });

  it("does not check capacity at all when totalCapacity is null", () => {
    const exams = [exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }], 10_000)];
    const checker = new PartialThresholdChecker(exams, [0], settings(), null);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
  });
});

describe("PartialThresholdChecker.apply / unapply - maxElectiveCollisions", () => {
  it("allows two electives of the same program on different dates", () => {
    const exams = [
      exam([{ programNumber: "83101", year: 1, requirement: "Elective" }]),
      exam([{ programNumber: "83101", year: 1, requirement: "Elective" }]),
    ];
    const checker = new PartialThresholdChecker(exams, [0, 1], settings({ maxElectiveCollisions: 0 }), null);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
    expect(checker.apply(1, [[1, "2026-01-02"]])).toBe(true);
  });

  it("rejects two electives of the same program colliding on the same date under a 0 threshold", () => {
    const exams = [
      exam([{ programNumber: "83101", year: 1, requirement: "Elective" }]),
      exam([{ programNumber: "83101", year: 1, requirement: "Elective" }]),
    ];
    const checker = new PartialThresholdChecker(exams, [0, 1], settings({ maxElectiveCollisions: 0 }), null);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
    expect(checker.apply(1, [[1, "2026-01-01"]])).toBe(false);
  });

  it("does not count obligatory exams toward elective collisions", () => {
    const exams = [
      exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
    ];
    const checker = new PartialThresholdChecker(exams, [0, 1], settings({ maxElectiveCollisions: 0 }), null);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
    expect(checker.apply(1, [[1, "2026-01-01"]])).toBe(true);
  });

  it("does not count electives of different programs against each other", () => {
    const exams = [
      exam([{ programNumber: "83101", year: 1, requirement: "Elective" }]),
      exam([{ programNumber: "83102", year: 1, requirement: "Elective" }]),
    ];
    const checker = new PartialThresholdChecker(exams, [0, 1], settings({ maxElectiveCollisions: 0 }), null);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
    expect(checker.apply(1, [[1, "2026-01-01"]])).toBe(true);
  });

  it("allows a collision count up to the threshold", () => {
    const exams = [
      exam([{ programNumber: "83101", year: 1, requirement: "Elective" }]),
      exam([{ programNumber: "83101", year: 1, requirement: "Elective" }]),
      exam([{ programNumber: "83101", year: 1, requirement: "Elective" }]),
    ];
    const checker = new PartialThresholdChecker(exams, [0, 1, 2], settings({ maxElectiveCollisions: 1 }), null);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
    expect(checker.apply(1, [[1, "2026-01-01"]])).toBe(true); // 1 collision so far, within threshold
    expect(checker.apply(2, [[2, "2026-01-01"]])).toBe(false); // now 2, over threshold
  });

  it("unapply reverses a recorded collision", () => {
    const exams = [
      exam([{ programNumber: "83101", year: 1, requirement: "Elective" }]),
      exam([{ programNumber: "83101", year: 1, requirement: "Elective" }]),
    ];
    const checker = new PartialThresholdChecker(exams, [0, 1], settings({ maxElectiveCollisions: 0 }), null);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
    expect(checker.apply(1, [[1, "2026-01-01"]])).toBe(false);
    checker.unapply(1);
    checker.unapply(0);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
    expect(checker.apply(1, [[1, "2026-01-02"]])).toBe(true);
  });
});

describe("PartialThresholdChecker.apply - minObligatorySpan", () => {
  function twoObligatoryExams() {
    return [
      exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
    ];
  }

  it("rejects a span narrower than the minimum, once the group's last exam is placed", () => {
    const exams = twoObligatoryExams();
    const checker = new PartialThresholdChecker(exams, [0, 1], settings({ minObligatorySpan: 5 }), null);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
    expect(checker.apply(1, [[1, "2026-01-03"]])).toBe(false); // span 2 < 5
  });

  it("allows a span at or above the minimum", () => {
    const exams = twoObligatoryExams();
    const checker = new PartialThresholdChecker(exams, [0, 1], settings({ minObligatorySpan: 5 }), null);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
    expect(checker.apply(1, [[1, "2026-01-06"]])).toBe(true); // span 5 == 5
  });

  it("does not check the span until the group's last depth is reached", () => {
    const exams = twoObligatoryExams();
    const checker = new PartialThresholdChecker(exams, [0, 1], settings({ minObligatorySpan: 100 }), null);
    // Placing only the first exam of the group never triggers the span check by itself.
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
  });

  it("does not check the span for a group with only one obligatory exam", () => {
    const exams = [
      exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam([{ programNumber: "83102", year: 1, requirement: "Obligatory" }]), // different program: its own group of 1
    ];
    const checker = new PartialThresholdChecker(exams, [0, 1], settings({ minObligatorySpan: 1000 }), null);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
    expect(checker.apply(1, [[1, "2026-01-02"]])).toBe(true);
  });

  it("treats minObligatorySpan of 0 as off, same as null", () => {
    const exams = twoObligatoryExams();
    const checker = new PartialThresholdChecker(exams, [0, 1], settings({ minObligatorySpan: 0 }), null);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
    expect(checker.apply(1, [[1, "2026-01-02"]])).toBe(true);
  });

  it("checks span across the widest gap when a group has more than two exams", () => {
    const exams = [
      exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
    ];
    const checker = new PartialThresholdChecker(exams, [0, 0, 1], settings({ minObligatorySpan: 5 }), null);
    expect(
      checker.apply(0, [
        [0, "2026-01-01"],
        [1, "2026-01-02"],
      ])
    ).toBe(true);
    // Last exam completes the group; span is first-to-last = 2026-01-01 to 2026-01-10 = 9 days.
    expect(checker.apply(1, [[2, "2026-01-10"]])).toBe(true);
  });
});

describe("PartialThresholdChecker.reset", () => {
  it("clears all accumulated counts back to a fresh state", () => {
    const exams = [
      exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam([{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
    ];
    const checker = new PartialThresholdChecker(exams, [0, 1], settings({ maxExamsPerDay: 1 }), null);
    expect(checker.apply(0, [[0, "2026-01-01"]])).toBe(true);
    checker.reset();
    expect(checker.apply(1, [[1, "2026-01-01"]])).toBe(true);
  });
});
