import { describe, expect, it } from "vitest";
import { SchedulingDataError, buildExams, periodsByKey } from "./exams";
import { Course, ExamPeriod, ProgramEnrollment } from "./model";

function enrollment(overrides: Partial<ProgramEnrollment> = {}): ProgramEnrollment {
  return { programNumber: "83101", year: 1, semester: "FALL", requirement: "Obligatory", ...overrides };
}

function course(overrides: Partial<Course> = {}): Course {
  return {
    number: "83101",
    name: "Course",
    instructor: "Dr. A",
    enrollments: [enrollment()],
    evaluation: "Exam",
    ...overrides,
  };
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

describe("periodsByKey", () => {
  it("indexes periods by semester and moed", () => {
    const p = period();
    const map = periodsByKey([p]);
    expect(map.get("FALL|ALEPH")).toBe(p);
  });

  it("returns an empty map for no periods", () => {
    expect(periodsByKey([]).size).toBe(0);
  });

  it("indexes every period given, one entry each", () => {
    const map = periodsByKey([period({ moed: "ALEPH" }), period({ moed: "BET" })]);
    expect(map.size).toBe(2);
  });
});

describe("buildExams", () => {
  it("builds one exam per moed period for a course's semester", () => {
    const courses = [course()];
    const periods = [period({ moed: "ALEPH" }), period({ moed: "BET" })];
    const exams = buildExams(courses, periods, ["83101"]);
    expect(exams).toHaveLength(2);
    expect(exams.map((e) => e.moed)).toEqual(["ALEPH", "BET"]);
  });

  it("skips a course whose evaluation is not Exam", () => {
    const courses = [course({ evaluation: "Project" })];
    const exams = buildExams(courses, [period()], ["83101"]);
    expect(exams).toEqual([]);
  });

  it("skips a course with no enrollment in a selected program", () => {
    const courses = [course({ enrollments: [enrollment({ programNumber: "99999" })] })];
    const exams = buildExams(courses, [period()], ["83101"]);
    expect(exams).toEqual([]);
  });

  it("only includes enrollments for selected programs, not every enrollment of the course", () => {
    const courses = [
      course({
        enrollments: [enrollment({ programNumber: "83101" }), enrollment({ programNumber: "99999" })],
      }),
    ];
    const exams = buildExams(courses, [period()], ["83101"]);
    expect(exams[0].slots.map((s) => s.programNumber)).toEqual(["83101"]);
  });

  it("builds separate exams for each semester the course is taught in", () => {
    const courses = [
      course({
        enrollments: [enrollment({ semester: "FALL" }), enrollment({ semester: "SPRI" })],
      }),
    ];
    const periods = [period({ semester: "FALL" }), period({ semester: "SPRI" })];
    const exams = buildExams(courses, periods, ["83101"]);
    expect(exams.map((e) => e.semester).sort()).toEqual(["FALL", "SPRI"]);
  });

  it("gives every exam of a course in a semester the same slots", () => {
    const courses = [course()];
    const periods = [period({ moed: "ALEPH" }), period({ moed: "BET" })];
    const exams = buildExams(courses, periods, ["83101"]);
    expect(exams[0].slots).toEqual(exams[1].slots);
  });

  it("gives each exam an id combining course number, semester and moed", () => {
    const courses = [course({ number: "83101" })];
    const exams = buildExams(courses, [period({ semester: "FALL", moed: "ALEPH" })], ["83101"]);
    expect(exams[0].id).toBe("83101|FALL|ALEPH");
  });

  it("orders exams by semester, then moed, then course number", () => {
    const courses = [
      course({ number: "83102", enrollments: [enrollment({ semester: "SPRI" })] }),
      course({ number: "83101", enrollments: [enrollment({ semester: "FALL" })] }),
    ];
    const periods = [period({ semester: "FALL" }), period({ semester: "SPRI" })];
    const exams = buildExams(courses, periods, ["83101"]);
    expect(exams.map((e) => e.course.number)).toEqual(["83101", "83102"]);
  });

  it("throws when a course's semester has no exam period defined", () => {
    const courses = [course({ enrollments: [enrollment({ semester: "SUMM" })] })];
    expect(() => buildExams(courses, [period({ semester: "FALL" })], ["83101"])).toThrow(
      SchedulingDataError
    );
  });

  it("lists every missing semester once, sorted, in the thrown error", () => {
    const courses = [
      course({
        number: "83101",
        enrollments: [enrollment({ semester: "SUMM" }), enrollment({ semester: "SPRI" })],
      }),
    ];
    try {
      buildExams(courses, [period({ semester: "FALL" })], ["83101"]);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain("SPRI");
      expect((error as Error).message).toContain("SUMM");
    }
  });

  it("does not throw for a semester with no course activity, even without a period", () => {
    const courses = [course({ enrollments: [enrollment({ semester: "FALL" })] })];
    const exams = buildExams(courses, [period({ semester: "FALL" })], ["83101"]);
    expect(exams).toHaveLength(1);
  });

  it("returns an empty list for no courses", () => {
    expect(buildExams([], [period()], ["83101"])).toEqual([]);
  });

  it("returns an empty list when no programs are selected", () => {
    expect(buildExams([course()], [period()], [])).toEqual([]);
  });

  it("builds exams for several courses sharing a program", () => {
    const courses = [course({ number: "83101" }), course({ number: "83102" })];
    const exams = buildExams(courses, [period()], ["83101"]);
    expect(exams.map((e) => e.course.number)).toEqual(["83101", "83102"]);
  });
});
