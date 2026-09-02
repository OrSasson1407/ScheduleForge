import { describe, expect, it } from "vitest";
import {
  DataFileError,
  parseCourses,
  parseEvaluation,
  parseExamPeriods,
  parseFacultyConstraints,
  parseMoed,
  parseRequirement,
  parseRooms,
  parseSemester,
} from "./parsers";

const SEP = "$$$$";

describe("parseSemester", () => {
  it.each([
    ["FALL", "FALL"],
    ["fall", "FALL"],
    ["SPRI", "SPRI"],
    ["SPRING", "SPRI"],
    ["spring", "SPRI"],
    ["SUMM", "SUMM"],
    ["SUMMER", "SUMM"],
  ])("accepts %s as %s", (input, expected) => {
    expect(parseSemester(input, 1)).toBe(expected);
  });

  it("trims surrounding whitespace", () => {
    expect(parseSemester("  FALL  ", 1)).toBe("FALL");
  });

  it("throws a DataFileError with the line number for an unrecognized semester", () => {
    try {
      parseSemester("WINTER", 7);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DataFileError);
      expect((error as DataFileError).line).toBe(7);
      expect((error as Error).message).toContain("line 7");
    }
  });
});

describe("parseMoed", () => {
  it.each([
    ["ALEPH", "ALEPH"],
    ["A", "ALEPH"],
    ["BET", "BET"],
    ["B", "BET"],
    ["GIMEL", "GIMEL"],
    ["C", "GIMEL"],
    ["aleph", "ALEPH"],
  ])("accepts %s as %s", (input, expected) => {
    expect(parseMoed(input, 1)).toBe(expected);
  });

  it("throws for an unrecognized moed", () => {
    expect(() => parseMoed("D", 3)).toThrow(DataFileError);
  });
});

describe("parseRequirement", () => {
  it("accepts Obligatory case-insensitively", () => {
    expect(parseRequirement("obligatory", 1)).toBe("Obligatory");
  });
  it("accepts Elective case-insensitively", () => {
    expect(parseRequirement("ELECTIVE", 1)).toBe("Elective");
  });
  it("throws for anything else", () => {
    expect(() => parseRequirement("Mandatory", 1)).toThrow(DataFileError);
  });
});

describe("parseEvaluation", () => {
  it.each([
    ["EXAM", "Exam"],
    ["exam", "Exam"],
    ["PROJECT", "Project"],
    ["ATTENDANCE", "Attendance"],
  ])("accepts %s as %s", (input, expected) => {
    expect(parseEvaluation(input, 1)).toBe(expected);
  });
  it("throws for an unrecognized evaluation", () => {
    expect(() => parseEvaluation("QUIZ", 1)).toThrow(DataFileError);
  });
});

function courseRecord(overrides: {
  name?: string;
  number?: string;
  instructor?: string;
  enrollments?: string[];
  evaluation?: string;
  students?: string;
} = {}): string {
  const {
    name = "Intro to Testing",
    number = "83101",
    instructor = "Dr. A",
    enrollments = ["83101,1,FALL,OBLIGATORY"],
    evaluation = "Exam",
    students,
  } = overrides;
  const lines = [name, number, instructor, ...enrollments, evaluation];
  if (students !== undefined) lines.push(students);
  return lines.join("\n");
}

describe("parseCourses", () => {
  it("parses a single well-formed course record", () => {
    const [course] = parseCourses(courseRecord());
    expect(course).toMatchObject({
      name: "Intro to Testing",
      number: "83101",
      instructor: "Dr. A",
      evaluation: "Exam",
    });
    expect(course.enrollments).toEqual([
      { programNumber: "83101", year: 1, semester: "FALL", requirement: "Obligatory" },
    ]);
    expect(course.students).toBeUndefined();
  });

  it("parses several courses separated by the record separator", () => {
    const text = [courseRecord({ number: "83101" }), courseRecord({ number: "83102" })].join(`\n${SEP}\n`);
    const courses = parseCourses(text);
    expect(courses.map((c) => c.number)).toEqual(["83101", "83102"]);
  });

  it("ignores blank lines within and between records", () => {
    const text = `\n\n${courseRecord()}\n\n${SEP}\n\n`;
    expect(parseCourses(text)).toHaveLength(1);
  });

  it("parses multiple enrollments for one course", () => {
    const [course] = parseCourses(
      courseRecord({ enrollments: ["83101,1,FALL,OBLIGATORY", "83102,2,SPRI,ELECTIVE"] })
    );
    expect(course.enrollments).toHaveLength(2);
    expect(course.enrollments[1]).toEqual({
      programNumber: "83102",
      year: 2,
      semester: "SPRI",
      requirement: "Elective",
    });
  });

  it("parses an optional trailing student count (version 3.0)", () => {
    const [course] = parseCourses(courseRecord({ students: "45" }));
    expect(course.students).toBe(45);
  });

  it("rejects a student count of 0", () => {
    expect(() => parseCourses(courseRecord({ students: "0" }))).toThrow(DataFileError);
  });

  it("throws for an empty file", () => {
    expect(() => parseCourses("")).toThrow(DataFileError);
  });

  it("throws for a record with too few lines", () => {
    expect(() => parseCourses("Name\n83101\nDr. A")).toThrow(DataFileError);
  });

  it("throws when the course number is not exactly 5 digits", () => {
    expect(() => parseCourses(courseRecord({ number: "831" }))).toThrow(DataFileError);
  });

  it("throws when the same course number appears twice", () => {
    const text = [courseRecord({ number: "83101" }), courseRecord({ number: "83101" })].join(`\n${SEP}\n`);
    expect(() => parseCourses(text)).toThrow(DataFileError);
  });

  it("throws when an enrollment line does not have exactly 4 comma-separated fields", () => {
    expect(() => parseCourses(courseRecord({ enrollments: ["83101,1,FALL"] }))).toThrow(DataFileError);
  });

  it("throws when an enrollment's program number is not 5 digits", () => {
    expect(() => parseCourses(courseRecord({ enrollments: ["831,1,FALL,OBLIGATORY"] }))).toThrow(
      DataFileError
    );
  });

  it.each(["0", "5", "abc", "1.5"])("rejects an enrollment year of %s", (year) => {
    expect(() => parseCourses(courseRecord({ enrollments: [`83101,${year},FALL,OBLIGATORY`] }))).toThrow(
      DataFileError
    );
  });

  it.each(["1", "2", "3", "4"])("accepts an enrollment year of %s", (year) => {
    const [course] = parseCourses(courseRecord({ enrollments: [`83101,${year},FALL,OBLIGATORY`] }));
    expect(course.enrollments[0].year).toBe(Number(year));
  });

  it("throws when the evaluation field is invalid", () => {
    expect(() => parseCourses(courseRecord({ evaluation: "QUIZ" }))).toThrow(DataFileError);
  });

  it("tolerates trailing whitespace on every line", () => {
    const [course] = parseCourses(courseRecord({ name: "  Padded Name  " }));
    expect(course.name).toBe("Padded Name");
  });
});

function roomsFile(records: string[]): string {
  return records.join(`\n${SEP}\n`);
}

describe("parseRooms", () => {
  it("parses a room with a name and capacity", () => {
    const [room] = parseRooms(roomsFile(["Hall A\n100"]));
    expect(room).toEqual({ name: "Hall A", capacity: 100, location: "" });
  });

  it("parses a room's optional location", () => {
    const [room] = parseRooms(roomsFile(["Hall A\n100\nBuilding 3"]));
    expect(room.location).toBe("Building 3");
  });

  it("parses several rooms", () => {
    const rooms = parseRooms(roomsFile(["A\n10", "B\n20"]));
    expect(rooms.map((r) => r.name)).toEqual(["A", "B"]);
  });

  it("throws for an empty file", () => {
    expect(() => parseRooms("")).toThrow(DataFileError);
  });

  it("throws for a record with fewer than 2 lines", () => {
    expect(() => parseRooms(roomsFile(["OnlyName"]))).toThrow(DataFileError);
  });

  it("throws when the capacity is not a number", () => {
    expect(() => parseRooms(roomsFile(["Hall\nmany"]))).toThrow(DataFileError);
  });

  it("throws when the capacity is 0", () => {
    expect(() => parseRooms(roomsFile(["Hall\n0"]))).toThrow(DataFileError);
  });

  it("throws when a room name is repeated", () => {
    expect(() => parseRooms(roomsFile(["Hall\n10", "Hall\n20"]))).toThrow(DataFileError);
  });
});

describe("parseFacultyConstraints", () => {
  it("parses a single instructor's excluded date", () => {
    const rules = parseFacultyConstraints("Dr. A\n01-01-2026");
    expect(rules["Dr. A"]).toEqual([{ start: "2026-01-01", end: "2026-01-01", comment: "" }]);
  });

  it("parses a comment after a single excluded date", () => {
    const rules = parseFacultyConstraints("Dr. A\n01-01-2026 conference");
    expect(rules["Dr. A"][0].comment).toBe("conference");
  });

  it("parses an excluded date range", () => {
    const rules = parseFacultyConstraints("Dr. A\n01-01-2026,05-01-2026");
    expect(rules["Dr. A"][0]).toEqual({ start: "2026-01-01", end: "2026-01-05", comment: "" });
  });

  it("parses a comment on the end date of a range", () => {
    const rules = parseFacultyConstraints("Dr. A\n01-01-2026,05-01-2026 sabbatical");
    expect(rules["Dr. A"][0].comment).toBe("sabbatical");
  });

  it("merges several excluded dates for one instructor across records", () => {
    const rules = parseFacultyConstraints(`Dr. A\n01-01-2026\n${SEP}\nDr. A\n05-01-2026`);
    expect(rules["Dr. A"]).toHaveLength(2);
  });

  it("keeps different instructors separate", () => {
    const rules = parseFacultyConstraints(`Dr. A\n01-01-2026\n${SEP}\nDr. B\n02-01-2026`);
    expect(Object.keys(rules)).toEqual(["Dr. A", "Dr. B"]);
  });

  it("throws for an empty file", () => {
    expect(() => parseFacultyConstraints("")).toThrow(DataFileError);
  });

  it("throws for a record with only the instructor name and no dates", () => {
    expect(() => parseFacultyConstraints("Dr. A")).toThrow(DataFileError);
  });

  it("throws when an excluded range is backwards", () => {
    expect(() => parseFacultyConstraints("Dr. A\n05-01-2026,01-01-2026")).toThrow(DataFileError);
  });

  it("throws when a date is missing its DD-MM-YYYY prefix", () => {
    expect(() => parseFacultyConstraints("Dr. A\nnot a date")).toThrow(DataFileError);
  });

  it("throws when a date line has more than 2 comma-separated fields", () => {
    expect(() => parseFacultyConstraints("Dr. A\n01-01-2026,02-01-2026,03-01-2026")).toThrow(DataFileError);
  });

  it("throws when a date is not a real calendar date", () => {
    expect(() => parseFacultyConstraints("Dr. A\n32-01-2026")).toThrow(DataFileError);
  });
});

function periodRecord(overrides: {
  semester?: string;
  moed?: string;
  start?: string;
  end?: string;
  excluded?: string[];
} = {}): string {
  const { semester = "FALL", moed = "ALEPH", start = "01-01-2026", end = "31-01-2026", excluded = [] } = overrides;
  return [`${semester},${moed}`, `${start},${end}`, ...excluded].join("\n");
}

describe("parseExamPeriods", () => {
  it("parses a well-formed period", () => {
    const [period] = parseExamPeriods(periodRecord());
    expect(period).toEqual({
      semester: "FALL",
      moed: "ALEPH",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      excluded: [],
    });
  });

  it("parses a period's excluded dates", () => {
    const [period] = parseExamPeriods(periodRecord({ excluded: ["15-01-2026 holiday"] }));
    expect(period.excluded).toEqual([{ start: "2026-01-15", end: "2026-01-15", comment: "holiday" }]);
  });

  it("parses several periods", () => {
    const text = [
      periodRecord({ semester: "FALL", moed: "ALEPH" }),
      periodRecord({ semester: "SPRI", moed: "ALEPH" }),
    ].join(`\n${SEP}\n`);
    const periods = parseExamPeriods(text);
    expect(periods.map((p) => p.semester)).toEqual(["FALL", "SPRI"]);
  });

  it("throws for an empty file", () => {
    expect(() => parseExamPeriods("")).toThrow(DataFileError);
  });

  it("throws for a record with fewer than 2 lines", () => {
    expect(() => parseExamPeriods("FALL,ALEPH")).toThrow(DataFileError);
  });

  it("throws when the header does not have exactly 2 fields", () => {
    expect(() => parseExamPeriods("FALL\n01-01-2026,31-01-2026")).toThrow(DataFileError);
  });

  it("throws when the dates line does not have exactly 2 fields", () => {
    expect(() => parseExamPeriods("FALL,ALEPH\n01-01-2026")).toThrow(DataFileError);
  });

  it("throws when the start date is not before the end date", () => {
    expect(() => parseExamPeriods(periodRecord({ start: "31-01-2026", end: "01-01-2026" }))).toThrow(
      DataFileError
    );
  });

  it("throws when the start date equals the end date", () => {
    expect(() => parseExamPeriods(periodRecord({ start: "01-01-2026", end: "01-01-2026" }))).toThrow(
      DataFileError
    );
  });

  it("throws when the same semester/moed pair is defined twice", () => {
    const text = [periodRecord(), periodRecord()].join(`\n${SEP}\n`);
    expect(() => parseExamPeriods(text)).toThrow(DataFileError);
  });

  it("allows the same semester with a different moed", () => {
    const text = [periodRecord({ moed: "ALEPH" }), periodRecord({ moed: "BET" })].join(`\n${SEP}\n`);
    expect(parseExamPeriods(text)).toHaveLength(2);
  });

  it("throws when a date in the header cannot be parsed", () => {
    expect(() => parseExamPeriods(periodRecord({ start: "not-a-date" }))).toThrow(DataFileError);
  });
});
