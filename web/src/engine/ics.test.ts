import { describe, expect, it } from "vitest";
import { calendarsOf } from "./ics";
import { Exam, ExamSystem, Requirement } from "./model";
import { RoomAllocation } from "./rooms";
import { StudyProgram } from "./catalog";

function exam(
  courseNumber: string,
  slots: { programNumber: string; year: number; requirement: Requirement }[],
  overrides: Partial<Exam> = {}
): Exam {
  return {
    id: `exam-${courseNumber}`,
    course: { number: courseNumber, name: "Intro to Testing", instructor: "Dr. A", enrollments: [], evaluation: "Exam" },
    semester: "FALL",
    moed: "ALEPH",
    slots: slots.map((s) => ({ key: `${s.programNumber}|${s.year}`, ...s })),
    ...overrides,
  };
}

function scheduled(date: string, e: Exam): ExamSystem[number] {
  return { exam: e, date };
}

const programs: StudyProgram[] = [{ number: "83101", name: "Computer Science" }];

function eventBlocks(text: string): string[] {
  return text.split("BEGIN:VEVENT").slice(1);
}

/** Reverses RFC 5545 line folding, so an assertion is not at the mercy of where a fold happened to land. */
function unfold(text: string): string {
  return text.replace(/\r\n /g, "");
}

describe("calendarsOf", () => {
  it("produces no calendars for an empty system", () => {
    expect(calendarsOf([], ["83101"], programs, null)).toEqual([]);
  });

  it("produces one calendar per selected program and year", () => {
    const e = exam("83101", [
      { programNumber: "83101", year: 1, requirement: "Obligatory" },
      { programNumber: "83101", year: 2, requirement: "Obligatory" },
    ]);
    const calendars = calendarsOf([scheduled("2026-01-01", e)], ["83101"], programs, null);
    expect(calendars).toHaveLength(2);
    expect(calendars.map((c) => c.year).sort()).toEqual([1, 2]);
  });

  it("only produces a calendar for a selected program", () => {
    const e = exam("83101", [{ programNumber: "83102", year: 1, requirement: "Obligatory" }]);
    const calendars = calendarsOf([scheduled("2026-01-01", e)], ["83101"], programs, null);
    expect(calendars).toEqual([]);
  });

  it("names the file after the program number and year", () => {
    const e = exam("83101", [{ programNumber: "83101", year: 2, requirement: "Obligatory" }]);
    const [calendar] = calendarsOf([scheduled("2026-01-01", e)], ["83101"], programs, null);
    expect(calendar.fileName).toBe("exams-83101-year-2.ics");
  });

  it("sorts calendars by program/year key", () => {
    const e = exam("83101", [
      { programNumber: "83101", year: 2, requirement: "Obligatory" },
      { programNumber: "83101", year: 1, requirement: "Obligatory" },
    ]);
    const calendars = calendarsOf([scheduled("2026-01-01", e)], ["83101"], programs, null);
    expect(calendars.map((c) => c.year)).toEqual([1, 2]);
  });

  it("begins and ends the file with VCALENDAR markers", () => {
    const e = exam("83101", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const [calendar] = calendarsOf([scheduled("2026-01-01", e)], ["83101"], programs, null);
    expect(calendar.text).toContain("BEGIN:VCALENDAR");
    expect(calendar.text).toContain("END:VCALENDAR");
    expect(calendar.text.startsWith("BEGIN:VCALENDAR")).toBe(true);
  });

  it("includes the resolved program name and year in the calendar's display name", () => {
    const e = exam("83101", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const [calendar] = calendarsOf([scheduled("2026-01-01", e)], ["83101"], programs, null);
    expect(calendar.text).toContain("X-WR-CALNAME:Exams - Computer Science - year 1");
  });

  it("sets DTSTART to the exam date and DTEND to the day after", () => {
    const e = exam("83101", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const [calendar] = calendarsOf([scheduled("2026-01-29", e)], ["83101"], programs, null);
    expect(calendar.text).toContain("DTSTART;VALUE=DATE:20260129");
    expect(calendar.text).toContain("DTEND;VALUE=DATE:20260130");
  });

  it("rolls DTEND over a month boundary", () => {
    const e = exam("83101", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const [calendar] = calendarsOf([scheduled("2026-01-31", e)], ["83101"], programs, null);
    expect(calendar.text).toContain("DTEND;VALUE=DATE:20260201");
  });

  it("includes the course number, name and moed in the summary", () => {
    const e = exam("83101", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const [calendar] = calendarsOf([scheduled("2026-01-01", e)], ["83101"], programs, null);
    expect(calendar.text).toContain("SUMMARY:83101 Intro to Testing (moed Aleph)");
  });

  it("includes the exam's requirement type in the description", () => {
    const e = exam("83101", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const [calendar] = calendarsOf([scheduled("2026-01-01", e)], ["83101"], programs, null);
    expect(unfold(calendar.text)).toContain("Type: Obligatory");
  });

  it("orders events of a calendar by date, then course number", () => {
    const e1 = exam("83102", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const e2 = exam("83101", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const [calendar] = calendarsOf(
      [scheduled("2026-01-01", e1), scheduled("2026-01-01", e2)],
      ["83101"],
      programs,
      null
    );
    const blocks = eventBlocks(calendar.text);
    expect(blocks[0]).toContain("83101 Intro");
    expect(blocks[1]).toContain("83102 Intro");
  });

  it("omits LOCATION and Rooms when no room allocation is given", () => {
    const e = exam("83101", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const [calendar] = calendarsOf([scheduled("2026-01-01", e)], ["83101"], programs, null);
    expect(calendar.text).not.toContain("LOCATION:");
    expect(calendar.text).not.toContain("Rooms:");
  });

  it("includes LOCATION and Rooms when the exam has a room booking", () => {
    const e = exam("83101", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const allocation: RoomAllocation = {
      bookings: new Map([
        [e.id, { exam: e, date: "2026-01-01", rooms: [{ name: "Hall A", capacity: 100, location: "Building 3" }] }],
      ]),
      failures: [],
      isComplete: true,
    };
    const [calendar] = calendarsOf([scheduled("2026-01-01", e)], ["83101"], programs, allocation);
    expect(calendar.text).toContain("LOCATION:Hall A (Building 3)");
    expect(calendar.text).toContain("Rooms: Hall A");
  });

  it("omits the room's parenthesized location when it has none", () => {
    const e = exam("83101", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const allocation: RoomAllocation = {
      bookings: new Map([[e.id, { exam: e, date: "2026-01-01", rooms: [{ name: "Hall A", capacity: 100, location: "" }] }]]),
      failures: [],
      isComplete: true,
    };
    const [calendar] = calendarsOf([scheduled("2026-01-01", e)], ["83101"], programs, allocation);
    expect(calendar.text).toContain("LOCATION:Hall A");
    expect(calendar.text).not.toContain("LOCATION:Hall A (");
  });

  it("escapes a comma in the course name", () => {
    const e = exam("83101", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }], {
      course: { number: "83101", name: "Testing, Advanced", instructor: "Dr. A", enrollments: [], evaluation: "Exam" },
    });
    const [calendar] = calendarsOf([scheduled("2026-01-01", e)], ["83101"], programs, null);
    expect(calendar.text).toContain("Testing\\, Advanced");
  });

  it("escapes a semicolon in the instructor name", () => {
    const e = exam("83101", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }], {
      course: { number: "83101", name: "Course", instructor: "Dr. A; Prof. B", enrollments: [], evaluation: "Exam" },
    });
    const [calendar] = calendarsOf([scheduled("2026-01-01", e)], ["83101"], programs, null);
    expect(calendar.text).toContain("Dr. A\\; Prof. B");
  });

  it("folds a very long description line to at most 75 octets per physical line", () => {
    const e = exam("83101", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }], {
      course: {
        number: "83101",
        name: "A".repeat(200),
        instructor: "Dr. A",
        enrollments: [],
        evaluation: "Exam",
      },
    });
    const [calendar] = calendarsOf([scheduled("2026-01-01", e)], ["83101"], programs, null);
    const physicalLines = calendar.text.split("\r\n");
    for (const line of physicalLines) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    // A folded continuation line starts with a single space (RFC 5545).
    expect(physicalLines.some((line) => line.startsWith(" "))).toBe(true);
  });

  it("gives every exam a unique UID combining course, moed, program and year", () => {
    const e1 = exam("83101", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const e2 = exam("83102", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const [calendar] = calendarsOf(
      [scheduled("2026-01-01", e1), scheduled("2026-01-02", e2)],
      ["83101"],
      programs,
      null
    );
    expect(calendar.text).toContain("UID:83101-ALEPH-83101-1@scheduleforge");
    expect(calendar.text).toContain("UID:83102-ALEPH-83101-1@scheduleforge");
  });

  it("ends each physical line with CRLF", () => {
    const e = exam("83101", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const [calendar] = calendarsOf([scheduled("2026-01-01", e)], ["83101"], programs, null);
    expect(calendar.text.endsWith("\r\n")).toBe(true);
    expect(calendar.text).toContain("\r\n");
  });
});
