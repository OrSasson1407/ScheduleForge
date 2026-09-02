import { describe, expect, it } from "vitest";
import {
  courseProblems,
  dataProblems,
  excludedDateProblems,
  facultyProblems,
  periodProblems,
  roomCapacityProblems,
  roomProblems,
} from "./completeness";
import { Course, ExamPeriod, FacultyRules, Room } from "./model";

function course(overrides: Partial<Course> = {}): Course {
  return {
    number: "83101",
    name: "Test Course",
    instructor: "Dr. Test",
    enrollments: [{ programNumber: "83101", year: 1, semester: "FALL", requirement: "Obligatory" }],
    evaluation: "Exam",
    ...overrides,
  };
}

function room(overrides: Partial<Room> = {}): Room {
  return { name: "Room A", capacity: 100, location: "Building 1", ...overrides };
}

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

describe("courseProblems", () => {
  it("finds nothing wrong with a fully valid course", () => {
    expect(courseProblems([course()])).toEqual([]);
  });

  it.each([
    ["123", "too short"],
    ["123456", "too long"],
    ["ABCDE", "letters"],
    ["", "empty"],
    ["831 1", "contains a space"],
  ])("flags a course number that is %s (%s)", (number) => {
    expect(courseProblems([course({ number })])).toHaveLength(1);
  });

  it("accepts a course number that is exactly five digits", () => {
    expect(courseProblems([course({ number: "00001" })])).toEqual([]);
  });

  it("flags an empty course name", () => {
    expect(courseProblems([course({ name: "" })])).toHaveLength(1);
  });

  it("flags a whitespace-only course name", () => {
    expect(courseProblems([course({ name: "   " })])).toHaveLength(1);
  });

  it("flags an empty instructor", () => {
    expect(courseProblems([course({ instructor: "" })])).toHaveLength(1);
  });

  it("flags a whitespace-only instructor", () => {
    expect(courseProblems([course({ instructor: "  " })])).toHaveLength(1);
  });

  it("flags a course with no enrollments at all", () => {
    expect(courseProblems([course({ enrollments: [] })])).toHaveLength(1);
  });

  it("flags an enrollment whose program number is not five digits", () => {
    const c = course({
      enrollments: [{ programNumber: "123", year: 1, semester: "FALL", requirement: "Obligatory" }],
    });
    expect(courseProblems([c])).toHaveLength(1);
  });

  it("flags every invalid enrollment independently", () => {
    const c = course({
      enrollments: [
        { programNumber: "123", year: 1, semester: "FALL", requirement: "Obligatory" },
        { programNumber: "456", year: 2, semester: "SPRI", requirement: "Elective" },
      ],
    });
    expect(courseProblems([c])).toHaveLength(2);
  });

  it("does not flag students when it is left unset (optional)", () => {
    expect(courseProblems([course({ students: undefined })])).toEqual([]);
  });

  it.each([0, -1, -100])("flags a non-positive student count (%i)", (students) => {
    expect(courseProblems([course({ students })])).toHaveLength(1);
  });

  it("flags a non-integer student count", () => {
    expect(courseProblems([course({ students: 30.5 })])).toHaveLength(1);
  });

  it("accepts a positive integer student count", () => {
    expect(courseProblems([course({ students: 220 })])).toEqual([]);
  });

  it("accepts a student count of exactly 1", () => {
    expect(courseProblems([course({ students: 1 })])).toEqual([]);
  });

  it("reports one problem per broken field on the same course, not just the first", () => {
    const c = course({ number: "1", name: "", instructor: "", enrollments: [] });
    expect(courseProblems([c])).toHaveLength(4);
  });

  it("checks every course in the list independently", () => {
    const valid = course();
    const broken = course({ number: "1" });
    expect(courseProblems([valid, broken])).toHaveLength(1);
    expect(courseProblems([broken, valid])).toHaveLength(1);
    expect(courseProblems([broken, broken])).toHaveLength(2);
  });

  it("returns an empty list for an empty course list", () => {
    expect(courseProblems([])).toEqual([]);
  });
});

describe("roomProblems", () => {
  it("finds nothing wrong with a valid room", () => {
    expect(roomProblems([room()])).toEqual([]);
  });

  it("flags an empty room name", () => {
    expect(roomProblems([room({ name: "" })])).toHaveLength(1);
  });

  it("flags a whitespace-only room name", () => {
    expect(roomProblems([room({ name: "   " })])).toHaveLength(1);
  });

  it.each([0, -1, -50])("flags a non-positive capacity (%i)", (capacity) => {
    expect(roomProblems([room({ capacity })])).toHaveLength(1);
  });

  it("flags a non-integer capacity", () => {
    expect(roomProblems([room({ capacity: 10.5 })])).toHaveLength(1);
  });

  it("accepts a capacity of exactly 1", () => {
    expect(roomProblems([room({ capacity: 1 })])).toEqual([]);
  });

  it("does not require a location to be filled in", () => {
    expect(roomProblems([room({ location: "" })])).toEqual([]);
  });

  it("returns an empty list for an empty room list", () => {
    expect(roomProblems([])).toEqual([]);
  });

  it("checks every room independently", () => {
    expect(roomProblems([room(), room({ capacity: 0 }), room({ name: "" })])).toHaveLength(2);
  });
});

describe("facultyProblems", () => {
  it("finds nothing wrong with a valid faculty record", () => {
    const faculty: FacultyRules = { "Dr. A": [{ start: "2026-01-01", end: "2026-01-05", comment: "leave" }] };
    expect(facultyProblems(faculty)).toEqual([]);
  });

  it("flags an instructor whose name is empty", () => {
    const faculty: FacultyRules = { "": [] };
    expect(facultyProblems(faculty)).toHaveLength(1);
  });

  it("flags an instructor whose name is whitespace only", () => {
    const faculty: FacultyRules = { "   ": [] };
    expect(facultyProblems(faculty)).toHaveLength(1);
  });

  it("flags an excluded range whose start is after its end", () => {
    const faculty: FacultyRules = { "Dr. A": [{ start: "2026-01-10", end: "2026-01-05", comment: "" }] };
    expect(facultyProblems(faculty)).toHaveLength(1);
  });

  it("accepts a single-day range where start equals end", () => {
    const faculty: FacultyRules = { "Dr. A": [{ start: "2026-01-05", end: "2026-01-05", comment: "" }] };
    expect(facultyProblems(faculty)).toEqual([]);
  });

  it("flags every broken range for the same instructor independently", () => {
    const faculty: FacultyRules = {
      "Dr. A": [
        { start: "2026-01-10", end: "2026-01-05", comment: "" },
        { start: "2026-02-10", end: "2026-02-05", comment: "" },
      ],
    };
    expect(facultyProblems(faculty)).toHaveLength(2);
  });

  it("checks every instructor in the record independently", () => {
    const faculty: FacultyRules = {
      "Dr. A": [],
      "Dr. B": [{ start: "2026-01-10", end: "2026-01-05", comment: "" }],
    };
    expect(facultyProblems(faculty)).toHaveLength(1);
  });

  it("accepts an instructor with no excluded ranges at all", () => {
    const faculty: FacultyRules = { "Dr. A": [] };
    expect(facultyProblems(faculty)).toEqual([]);
  });

  it("returns an empty list for an empty faculty record", () => {
    expect(facultyProblems({})).toEqual([]);
  });
});

describe("roomCapacityProblems", () => {
  it("returns nothing when no rooms are loaded at all", () => {
    expect(roomCapacityProblems([course({ students: 5000 })], [], 30)).toEqual([]);
  });

  it("flags a course whose students exceed the combined capacity of every room", () => {
    const rooms = [room({ capacity: 100 }), room({ capacity: 50 })];
    expect(roomCapacityProblems([course({ students: 200 })], rooms, 30)).toHaveLength(1);
  });

  it("accepts a course whose students fit within the combined capacity", () => {
    const rooms = [room({ capacity: 100 }), room({ capacity: 50 })];
    expect(roomCapacityProblems([course({ students: 150 })], rooms, 30)).toEqual([]);
  });

  it("accepts a course exactly at the combined capacity", () => {
    const rooms = [room({ capacity: 100 })];
    expect(roomCapacityProblems([course({ students: 100 })], rooms, 30)).toEqual([]);
  });

  it("uses the default student count when a course does not specify its own", () => {
    const rooms = [room({ capacity: 20 })];
    expect(roomCapacityProblems([course({ students: undefined })], rooms, 30)).toHaveLength(1);
    expect(roomCapacityProblems([course({ students: undefined })], rooms, 10)).toEqual([]);
  });

  it("ignores a course that is not evaluated by exam", () => {
    const rooms = [room({ capacity: 10 })];
    expect(roomCapacityProblems([course({ students: 5000, evaluation: "Project" })], rooms, 30)).toEqual([]);
    expect(roomCapacityProblems([course({ students: 5000, evaluation: "Attendance" })], rooms, 30)).toEqual([]);
  });

  it("sums capacity across every room, not just the largest one", () => {
    const rooms = [room({ capacity: 10 }), room({ capacity: 10 }), room({ capacity: 10 })];
    expect(roomCapacityProblems([course({ students: 25 })], rooms, 30)).toEqual([]);
    expect(roomCapacityProblems([course({ students: 35 })], rooms, 30)).toHaveLength(1);
  });

  it("checks every course independently", () => {
    const rooms = [room({ capacity: 50 })];
    const fits = course({ number: "11111", students: 40 });
    const overflows = course({ number: "22222", students: 60 });
    expect(roomCapacityProblems([fits, overflows], rooms, 30)).toHaveLength(1);
  });
});

describe("periodProblems", () => {
  it("finds nothing wrong with periods that do not overlap", () => {
    const a = period({ startDate: "2026-01-01", endDate: "2026-01-10" });
    const b = period({ startDate: "2026-02-01", endDate: "2026-02-10", moed: "BET" });
    expect(periodProblems([a, b])).toEqual([]);
  });

  it("flags two periods whose ranges overlap", () => {
    const a = period({ startDate: "2026-01-01", endDate: "2026-01-10" });
    const b = period({ startDate: "2026-01-05", endDate: "2026-01-15", moed: "BET" });
    expect(periodProblems([a, b])).toHaveLength(1);
  });

  it("flags periods that touch on exactly one boundary day", () => {
    const a = period({ startDate: "2026-01-01", endDate: "2026-01-10" });
    const b = period({ startDate: "2026-01-10", endDate: "2026-01-20", moed: "BET" });
    expect(periodProblems([a, b])).toHaveLength(1);
  });

  it("does not flag periods that are adjacent with no shared day", () => {
    const a = period({ startDate: "2026-01-01", endDate: "2026-01-10" });
    const b = period({ startDate: "2026-01-11", endDate: "2026-01-20", moed: "BET" });
    expect(periodProblems([a, b])).toEqual([]);
  });

  it("flags one period fully contained inside another", () => {
    const a = period({ startDate: "2026-01-01", endDate: "2026-01-31" });
    const b = period({ startDate: "2026-01-10", endDate: "2026-01-15", moed: "BET" });
    expect(periodProblems([a, b])).toHaveLength(1);
  });

  it("checks every pair, not just adjacent ones in the list", () => {
    const a = period({ startDate: "2026-01-01", endDate: "2026-01-10" });
    const b = period({ startDate: "2026-02-01", endDate: "2026-02-10", moed: "BET" });
    const c = period({ startDate: "2026-01-05", endDate: "2026-01-08", moed: "GIMEL" });
    // a and c overlap; b overlaps with neither.
    expect(periodProblems([a, b, c])).toHaveLength(1);
  });

  it("flags multiple independent overlapping pairs", () => {
    const a = period({ startDate: "2026-01-01", endDate: "2026-01-10" });
    const b = period({ startDate: "2026-01-05", endDate: "2026-01-15", moed: "BET" });
    const c = period({ startDate: "2026-01-08", endDate: "2026-01-20", moed: "GIMEL" });
    // a-b overlap, b-c overlap, a-c overlap: 3 pairs.
    expect(periodProblems([a, b, c])).toHaveLength(3);
  });

  it("returns an empty list for a single period", () => {
    expect(periodProblems([period()])).toEqual([]);
  });

  it("returns an empty list for no periods", () => {
    expect(periodProblems([])).toEqual([]);
  });
});

describe("excludedDateProblems", () => {
  it("finds nothing wrong when neither period excludes any date", () => {
    const a = period();
    const b = period({ moed: "BET" });
    expect(excludedDateProblems([a, b])).toEqual([]);
  });

  it("flags two periods that both exclude the same single date", () => {
    const a = period({ excluded: [{ start: "2026-03-01", end: "2026-03-01", comment: "" }] });
    const b = period({ moed: "BET", excluded: [{ start: "2026-03-01", end: "2026-03-01", comment: "" }] });
    expect(excludedDateProblems([a, b])).toHaveLength(1);
  });

  it("does not flag two periods that exclude different dates", () => {
    const a = period({ excluded: [{ start: "2026-03-01", end: "2026-03-01", comment: "" }] });
    const b = period({ moed: "BET", excluded: [{ start: "2026-04-01", end: "2026-04-01", comment: "" }] });
    expect(excludedDateProblems([a, b])).toEqual([]);
  });

  it("flags overlapping excluded ranges even when the periods' own ranges do not overlap", () => {
    // This is the exact scenario DESIGN.md documents: two periods whose
    // outer ranges never touch can still collide on an excluded date.
    const a = period({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      excluded: [{ start: "2026-01-15", end: "2026-01-15", comment: "" }],
    });
    const b = period({
      moed: "BET",
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      excluded: [{ start: "2026-01-15", end: "2026-01-15", comment: "" }],
    });
    expect(periodProblems([a, b])).toEqual([]); // outer ranges do not overlap
    expect(excludedDateProblems([a, b])).toHaveLength(1); // but the exclusion does
  });

  it("checks every pair of periods independently", () => {
    const a = period({ excluded: [{ start: "2026-03-01", end: "2026-03-01", comment: "" }] });
    const b = period({ moed: "BET", excluded: [] });
    const c = period({ moed: "GIMEL", excluded: [{ start: "2026-03-01", end: "2026-03-01", comment: "" }] });
    expect(excludedDateProblems([a, b, c])).toHaveLength(1);
  });

  it("returns an empty list for a single period", () => {
    const a = period({ excluded: [{ start: "2026-03-01", end: "2026-03-01", comment: "" }] });
    expect(excludedDateProblems([a])).toEqual([]);
  });
});

describe("dataProblems", () => {
  it("returns nothing when everything is valid", () => {
    expect(dataProblems([course()], [period()], [room()], {}, 30)).toEqual([]);
  });

  it("combines problems from every category at once", () => {
    const badCourse = course({ number: "1" });
    const badRoom = room({ capacity: 0 });
    const overlapping = [period(), period({ startDate: "2026-01-05", moed: "BET" })];
    const badFaculty: FacultyRules = { "Dr. A": [{ start: "2026-02-01", end: "2026-01-01", comment: "" }] };
    const problems = dataProblems([badCourse], overlapping, [badRoom], badFaculty, 30);
    // 1 course problem + 1 period-overlap problem + 1 room problem + 1 faculty problem
    expect(problems.length).toBeGreaterThanOrEqual(4);
  });

  it("is the empty list only when courses, periods, rooms and faculty are all clean", () => {
    const problems = dataProblems([course(), course({ number: "83102" })], [period()], [room()], {}, 30);
    expect(problems).toEqual([]);
  });
});
