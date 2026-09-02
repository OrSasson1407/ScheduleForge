import { describe, expect, it } from "vitest";
import {
  mergeCourses,
  mergeFaculty,
  mergePeriods,
  mergeRooms,
  replacePeriod,
  setPeriodDates,
  toggleExcludedDay,
} from "./edits";
import { Course, ExamPeriod, FacultyRules, Room } from "./model";

function course(number: string, name = "Course"): Course {
  return { number, name, instructor: "Dr. A", enrollments: [], evaluation: "Exam" };
}

function room(name: string, capacity = 30): Room {
  return { name, capacity, location: "" };
}

function period(overrides: Partial<ExamPeriod> = {}): ExamPeriod {
  return {
    semester: "FALL",
    moed: "ALEPH",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    excluded: [],
    ...overrides,
  };
}

describe("mergeCourses", () => {
  it("adds a new course to the existing list", () => {
    const result = mergeCourses([course("83101")], [course("83102")]);
    expect(result.map((c) => c.number).sort()).toEqual(["83101", "83102"]);
  });

  it("replaces an existing course with the same number", () => {
    const result = mergeCourses([course("83101", "Old Name")], [course("83101", "New Name")]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("New Name");
  });

  it("preserves the position of courses not touched by the incoming list", () => {
    const result = mergeCourses([course("83101"), course("83102")], [course("83102", "Updated")]);
    expect(result.map((c) => c.number)).toEqual(["83101", "83102"]);
    expect(result[1].name).toBe("Updated");
  });

  it("returns the existing list unchanged when incoming is empty", () => {
    expect(mergeCourses([course("83101")], [])).toEqual([course("83101")]);
  });

  it("returns just the incoming courses when existing is empty", () => {
    expect(mergeCourses([], [course("83101")])).toEqual([course("83101")]);
  });
});

describe("mergeRooms", () => {
  it("adds a new room and replaces one with the same name", () => {
    const result = mergeRooms([room("A", 10)], [room("A", 20), room("B", 30)]);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.name === "A")?.capacity).toBe(20);
  });
});

describe("mergeFaculty", () => {
  it("merges two disjoint rule sets", () => {
    const existing: FacultyRules = { "Dr. A": [] };
    const incoming: FacultyRules = { "Dr. B": [] };
    expect(Object.keys(mergeFaculty(existing, incoming)).sort()).toEqual(["Dr. A", "Dr. B"]);
  });

  it("replaces an existing instructor's rules entirely, not merging arrays", () => {
    const existing: FacultyRules = { "Dr. A": [{ start: "2026-01-01", end: "2026-01-01", comment: "" }] };
    const incoming: FacultyRules = { "Dr. A": [{ start: "2026-02-01", end: "2026-02-01", comment: "" }] };
    const result = mergeFaculty(existing, incoming);
    expect(result["Dr. A"]).toEqual(incoming["Dr. A"]);
  });
});

describe("mergePeriods", () => {
  it("adds a period for a new semester/moed", () => {
    const result = mergePeriods([period({ moed: "ALEPH" })], [period({ moed: "BET" })]);
    expect(result).toHaveLength(2);
  });

  it("replaces an existing period with the same semester and moed", () => {
    const result = mergePeriods(
      [period({ startDate: "2026-01-01" })],
      [period({ startDate: "2026-02-01" })]
    );
    expect(result).toHaveLength(1);
    expect(result[0].startDate).toBe("2026-02-01");
  });
});

describe("toggleExcludedDay", () => {
  it("excludes a date that was not excluded", () => {
    const result = toggleExcludedDay(period(), "2026-01-15");
    expect(result.excluded).toEqual([{ start: "2026-01-15", end: "2026-01-15", comment: expect.any(String) }]);
  });

  it("re-includes a single-day exclusion, removing the rule entirely", () => {
    const excluded = [{ start: "2026-01-15", end: "2026-01-15", comment: "" }];
    const result = toggleExcludedDay(period({ excluded }), "2026-01-15");
    expect(result.excluded).toEqual([]);
  });

  it("splits a multi-day exclusion when the middle day is re-included", () => {
    const excluded = [{ start: "2026-01-10", end: "2026-01-20", comment: "" }];
    const result = toggleExcludedDay(period({ excluded }), "2026-01-15");
    expect(result.excluded).toEqual([
      { start: "2026-01-10", end: "2026-01-14", comment: "" },
      { start: "2026-01-16", end: "2026-01-20", comment: "" },
    ]);
  });

  it("shrinks a range from the start when its first day is re-included", () => {
    const excluded = [{ start: "2026-01-10", end: "2026-01-20", comment: "" }];
    const result = toggleExcludedDay(period({ excluded }), "2026-01-10");
    expect(result.excluded).toEqual([{ start: "2026-01-11", end: "2026-01-20", comment: "" }]);
  });

  it("shrinks a range from the end when its last day is re-included", () => {
    const excluded = [{ start: "2026-01-10", end: "2026-01-20", comment: "" }];
    const result = toggleExcludedDay(period({ excluded }), "2026-01-20");
    expect(result.excluded).toEqual([{ start: "2026-01-10", end: "2026-01-19", comment: "" }]);
  });

  it("leaves other exclusion ranges untouched", () => {
    const excluded = [
      { start: "2026-01-10", end: "2026-01-10", comment: "" },
      { start: "2026-01-20", end: "2026-01-20", comment: "" },
    ];
    const result = toggleExcludedDay(period({ excluded }), "2026-01-10");
    expect(result.excluded).toEqual([{ start: "2026-01-20", end: "2026-01-20", comment: "" }]);
  });

  it("is its own inverse for a plain single-day toggle", () => {
    const once = toggleExcludedDay(period(), "2026-01-15");
    const twice = toggleExcludedDay(once, "2026-01-15");
    expect(twice.excluded).toEqual([]);
  });
});

describe("setPeriodDates", () => {
  it("updates the start and end date", () => {
    const result = setPeriodDates(period(), "2026-02-01", "2026-02-28");
    expect(result.startDate).toBe("2026-02-01");
    expect(result.endDate).toBe("2026-02-28");
  });

  it("keeps an excluded range that is fully inside the new dates", () => {
    const excluded = [{ start: "2026-01-10", end: "2026-01-15", comment: "" }];
    const result = setPeriodDates(period({ excluded }), "2026-01-01", "2026-01-31");
    expect(result.excluded).toEqual(excluded);
  });

  it("drops an excluded range now fully outside the new dates", () => {
    const excluded = [{ start: "2026-01-10", end: "2026-01-15", comment: "" }];
    const result = setPeriodDates(period({ excluded }), "2026-02-01", "2026-02-28");
    expect(result.excluded).toEqual([]);
  });

  it("clips an excluded range that starts before the new start date", () => {
    const excluded = [{ start: "2026-01-01", end: "2026-01-15", comment: "" }];
    const result = setPeriodDates(period({ excluded }), "2026-01-10", "2026-01-31");
    expect(result.excluded).toEqual([{ start: "2026-01-10", end: "2026-01-15", comment: "" }]);
  });

  it("clips an excluded range that ends after the new end date", () => {
    const excluded = [{ start: "2026-01-10", end: "2026-01-31", comment: "" }];
    const result = setPeriodDates(period({ excluded }), "2026-01-01", "2026-01-20");
    expect(result.excluded).toEqual([{ start: "2026-01-10", end: "2026-01-20", comment: "" }]);
  });

  it("drops an excluded range that becomes inverted after clipping both ends", () => {
    // The new window (05..10) sits entirely before the exclusion (15..20): clipping
    // start up to 05 and end down to 10 would invert start>end, so it must be dropped.
    const excluded = [{ start: "2026-01-15", end: "2026-01-20", comment: "" }];
    const result = setPeriodDates(period({ excluded }), "2026-01-05", "2026-01-10");
    expect(result.excluded).toEqual([]);
  });
});

describe("replacePeriod", () => {
  it("replaces the period matching the updated one's semester and moed", () => {
    const periods = [period({ semester: "FALL", moed: "ALEPH" }), period({ semester: "SPRI", moed: "ALEPH" })];
    const updated = period({ semester: "FALL", moed: "ALEPH", startDate: "2026-03-01" });
    const result = replacePeriod(periods, updated);
    expect(result[0].startDate).toBe("2026-03-01");
    expect(result[1].startDate).toBe("2026-01-01");
  });

  it("leaves the list unchanged when no period matches", () => {
    const periods = [period({ semester: "FALL", moed: "ALEPH" })];
    const updated = period({ semester: "SPRI", moed: "ALEPH" });
    expect(replacePeriod(periods, updated)).toEqual(periods);
  });
});
