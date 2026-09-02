import { describe, expect, it } from "vitest";
import { parseCoursesCsv, parsePeriodsCsv } from "./csvImport";
import { DataFileError } from "./parsers";

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csv(header: string[], rows: (string | number)[][]): string {
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => csvField(String(cell))).join(","));
  }
  return lines.join("\n");
}

const COURSE_HEADER = [
  "CourseNumber",
  "CourseName",
  "Instructor",
  "Program",
  "Year",
  "Semester",
  "Requirement",
  "Evaluation",
  "Students",
];

function courseRow(overrides: Partial<Record<(typeof COURSE_HEADER)[number], string | number>> = {}) {
  const defaults: Record<string, string | number> = {
    CourseNumber: "83101",
    CourseName: "Intro to Testing",
    Instructor: "Dr. A",
    Program: "83101",
    Year: 1,
    Semester: "FALL",
    Requirement: "OBLIGATORY",
    Evaluation: "EXAM",
    Students: "",
  };
  const merged = { ...defaults, ...overrides };
  return COURSE_HEADER.map((column) => merged[column]);
}

describe("parseCoursesCsv", () => {
  it("parses a single course row", () => {
    const [course] = parseCoursesCsv(csv(COURSE_HEADER, [courseRow()]));
    expect(course).toMatchObject({ number: "83101", name: "Intro to Testing", instructor: "Dr. A", evaluation: "Exam" });
    expect(course.enrollments).toEqual([
      { programNumber: "83101", year: 1, semester: "FALL", requirement: "Obligatory" },
    ]);
  });

  it("merges several rows sharing the same course number into one course with multiple enrollments", () => {
    const text = csv(COURSE_HEADER, [
      courseRow({ Program: "83101", Year: 1 }),
      courseRow({ Program: "83102", Year: 2 }),
    ]);
    const [course] = parseCoursesCsv(text);
    expect(course.enrollments).toHaveLength(2);
  });

  it("keeps courses with different numbers separate", () => {
    const text = csv(COURSE_HEADER, [courseRow({ CourseNumber: "83101" }), courseRow({ CourseNumber: "83102" })]);
    const courses = parseCoursesCsv(text);
    expect(courses.map((c) => c.number)).toEqual(["83101", "83102"]);
  });

  it("parses an optional student count from the first row of a course", () => {
    const [course] = parseCoursesCsv(csv(COURSE_HEADER, [courseRow({ Students: "45" })]));
    expect(course.students).toBe(45);
  });

  it("leaves students undefined when the column is blank", () => {
    const [course] = parseCoursesCsv(csv(COURSE_HEADER, [courseRow({ Students: "" })]));
    expect(course.students).toBeUndefined();
  });

  it("handles a course name containing a comma via CSV quoting", () => {
    const [course] = parseCoursesCsv(csv(COURSE_HEADER, [courseRow({ CourseName: "Testing, Advanced" })]));
    expect(course.name).toBe("Testing, Advanced");
  });

  it("handles a field containing an embedded, doubled quote", () => {
    const [course] = parseCoursesCsv(csv(COURSE_HEADER, [courseRow({ CourseName: 'The "Best" Course' })]));
    expect(course.name).toBe('The "Best" Course');
  });

  it("throws for a file with no rows at all", () => {
    expect(() => parseCoursesCsv("")).toThrow(DataFileError);
  });

  it("throws for a header-only file with no data rows", () => {
    expect(() => parseCoursesCsv(COURSE_HEADER.join(","))).toThrow(DataFileError);
  });

  it("throws when a required column is empty", () => {
    expect(() => parseCoursesCsv(csv(COURSE_HEADER, [courseRow({ CourseName: "" })]))).toThrow(DataFileError);
  });

  it("throws when CourseNumber is not 5 digits", () => {
    expect(() => parseCoursesCsv(csv(COURSE_HEADER, [courseRow({ CourseNumber: "831" })]))).toThrow(
      DataFileError
    );
  });

  it("throws when Program is not 5 digits", () => {
    expect(() => parseCoursesCsv(csv(COURSE_HEADER, [courseRow({ Program: "831" })]))).toThrow(DataFileError);
  });

  it.each(["0", "5", "abc"])("throws for an out-of-range Year of %s", (year) => {
    expect(() => parseCoursesCsv(csv(COURSE_HEADER, [courseRow({ Year: year })]))).toThrow(DataFileError);
  });

  it("throws for an invalid Semester", () => {
    expect(() => parseCoursesCsv(csv(COURSE_HEADER, [courseRow({ Semester: "WINTER" })]))).toThrow(
      DataFileError
    );
  });

  it("throws for an invalid Requirement", () => {
    expect(() => parseCoursesCsv(csv(COURSE_HEADER, [courseRow({ Requirement: "MANDATORY" })]))).toThrow(
      DataFileError
    );
  });

  it("throws for an invalid Evaluation", () => {
    expect(() => parseCoursesCsv(csv(COURSE_HEADER, [courseRow({ Evaluation: "QUIZ" })]))).toThrow(
      DataFileError
    );
  });

  it("throws for a non-positive Students value", () => {
    expect(() => parseCoursesCsv(csv(COURSE_HEADER, [courseRow({ Students: "0" })]))).toThrow(DataFileError);
  });

  it("throws for a non-integer Students value", () => {
    expect(() => parseCoursesCsv(csv(COURSE_HEADER, [courseRow({ Students: "12.5" })]))).toThrow(
      DataFileError
    );
  });

  it("ignores a blank line between data rows", () => {
    const [headerLine, row1] = csv(COURSE_HEADER, [courseRow({ CourseNumber: "83101" })]).split("\n");
    const row2 = csv(COURSE_HEADER, [courseRow({ CourseNumber: "83102" })]).split("\n")[1];
    const text = [headerLine, row1, "", row2].join("\n");
    expect(parseCoursesCsv(text).map((c) => c.number)).toEqual(["83101", "83102"]);
  });
});

const PERIOD_HEADER = ["Semester", "Moed", "StartDate", "EndDate", "ExcludedStart", "ExcludedEnd", "Comment"];

function periodRow(overrides: Partial<Record<(typeof PERIOD_HEADER)[number], string>> = {}) {
  const defaults: Record<string, string> = {
    Semester: "FALL",
    Moed: "ALEPH",
    StartDate: "01-01-2026",
    EndDate: "31-01-2026",
    ExcludedStart: "",
    ExcludedEnd: "",
    Comment: "",
  };
  const merged = { ...defaults, ...overrides };
  return PERIOD_HEADER.map((column) => merged[column]);
}

function excludedRow(overrides: Partial<Record<(typeof PERIOD_HEADER)[number], string>> = {}) {
  return periodRow({ StartDate: "", EndDate: "", ExcludedStart: "15-01-2026", ...overrides });
}

describe("parsePeriodsCsv", () => {
  it("parses a period-defining row", () => {
    const [period] = parsePeriodsCsv(csv(PERIOD_HEADER, [periodRow()]));
    expect(period).toEqual({
      semester: "FALL",
      moed: "ALEPH",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      excluded: [],
    });
  });

  it("attaches an excluded-date row to the period defined earlier in the file", () => {
    const text = csv(PERIOD_HEADER, [periodRow(), excludedRow({ Comment: "holiday" })]);
    const [period] = parsePeriodsCsv(text);
    expect(period.excluded).toEqual([{ start: "2026-01-15", end: "2026-01-15", comment: "holiday" }]);
  });

  it("uses ExcludedStart as the end date too when ExcludedEnd is blank", () => {
    const text = csv(PERIOD_HEADER, [periodRow(), excludedRow()]);
    const [period] = parsePeriodsCsv(text);
    expect(period.excluded[0]).toEqual({ start: "2026-01-15", end: "2026-01-15", comment: "" });
  });

  it("parses an excluded range with both ends given", () => {
    const text = csv(PERIOD_HEADER, [periodRow(), excludedRow({ ExcludedStart: "15-01-2026", ExcludedEnd: "17-01-2026" })]);
    const [period] = parsePeriodsCsv(text);
    expect(period.excluded[0]).toEqual({ start: "2026-01-15", end: "2026-01-17", comment: "" });
  });

  it("attaches several excluded rows to the same period", () => {
    const text = csv(PERIOD_HEADER, [
      periodRow(),
      excludedRow({ ExcludedStart: "10-01-2026" }),
      excludedRow({ ExcludedStart: "20-01-2026" }),
    ]);
    const [period] = parsePeriodsCsv(text);
    expect(period.excluded).toHaveLength(2);
  });

  it("parses several distinct periods", () => {
    const text = csv(PERIOD_HEADER, [periodRow({ Semester: "FALL" }), periodRow({ Semester: "SPRI" })]);
    const periods = parsePeriodsCsv(text);
    expect(periods.map((p) => p.semester)).toEqual(["FALL", "SPRI"]);
  });

  it("throws for an empty file", () => {
    expect(() => parsePeriodsCsv("")).toThrow(DataFileError);
  });

  it("throws when the start date is not before the end date", () => {
    const text = csv(PERIOD_HEADER, [periodRow({ StartDate: "31-01-2026", EndDate: "01-01-2026" })]);
    expect(() => parsePeriodsCsv(text)).toThrow(DataFileError);
  });

  it("throws when an excluded row references a period not yet defined", () => {
    const text = csv(PERIOD_HEADER, [excludedRow()]);
    expect(() => parsePeriodsCsv(text)).toThrow(DataFileError);
  });

  it("throws when an excluded range is backwards", () => {
    const text = csv(PERIOD_HEADER, [
      periodRow(),
      excludedRow({ ExcludedStart: "20-01-2026", ExcludedEnd: "10-01-2026" }),
    ]);
    expect(() => parsePeriodsCsv(text)).toThrow(DataFileError);
  });

  it("throws when a row has neither dates nor an excluded start", () => {
    const text = csv(PERIOD_HEADER, [periodRow({ StartDate: "", EndDate: "" })]);
    expect(() => parsePeriodsCsv(text)).toThrow(DataFileError);
  });

  it("throws when a date cannot be parsed", () => {
    const text = csv(PERIOD_HEADER, [periodRow({ StartDate: "not-a-date" })]);
    expect(() => parsePeriodsCsv(text)).toThrow(DataFileError);
  });

  it("throws for an invalid Moed", () => {
    const text = csv(PERIOD_HEADER, [periodRow({ Moed: "DALET" })]);
    expect(() => parsePeriodsCsv(text)).toThrow(DataFileError);
  });
});
