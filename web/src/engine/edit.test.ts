import { describe, expect, it } from "vitest";
import { LegalityInput, legalDatesFor, withExamById, withExamOn } from "./edit";
import { Exam, ExamPeriod, ExamSystem, FacultyRules, Requirement } from "./model";
import { DEFAULT_SETTINGS, Settings } from "./settings";
import { RoomAllocator } from "./rooms";

function exam(
  id: string,
  instructor: string,
  slots: { programNumber: string; year: number; requirement: Requirement }[],
  overrides: Partial<Exam> = {}
): Exam {
  return {
    id,
    course: { number: id, name: "Course", instructor, enrollments: [], evaluation: "Exam" },
    semester: "FALL",
    moed: "ALEPH",
    slots: slots.map((s) => ({ key: `${s.programNumber}|${s.year}`, ...s })),
    ...overrides,
  };
}

function scheduled(date: string, e: Exam): ExamSystem[number] {
  return { exam: e, date };
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

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("withExamOn", () => {
  it("moves the matching exam to the new date", () => {
    const a = exam("a", "Dr. A", []);
    const system = [scheduled("2026-01-01", a)];
    const moved = withExamOn(system, a, "2026-01-05");
    expect(moved[0].date).toBe("2026-01-05");
  });

  it("leaves other exams untouched", () => {
    const a = exam("a", "Dr. A", []);
    const b = exam("b", "Dr. B", []);
    const system = [scheduled("2026-01-01", a), scheduled("2026-01-02", b)];
    const moved = withExamOn(system, a, "2026-01-05");
    expect(moved[1].date).toBe("2026-01-02");
  });

  it("matches by object identity, not by id", () => {
    const a1 = exam("a", "Dr. A", []);
    const a2 = exam("a", "Dr. A", []); // same id, different object
    const system = [scheduled("2026-01-01", a1)];
    const moved = withExamOn(system, a2, "2026-01-05");
    expect(moved[0].date).toBe("2026-01-01"); // unchanged: a2 !== a1
  });

  it("does not mutate the original system", () => {
    const a = exam("a", "Dr. A", []);
    const system = [scheduled("2026-01-01", a)];
    withExamOn(system, a, "2026-01-05");
    expect(system[0].date).toBe("2026-01-01");
  });
});

describe("withExamById", () => {
  it("moves the exam matching the given id, regardless of object identity", () => {
    const a1 = exam("a", "Dr. A", []);
    const a2 = exam("a", "Dr. A", []);
    const system = [scheduled("2026-01-01", a1)];
    const moved = withExamById(system, a2.id, "2026-01-05");
    expect(moved[0].date).toBe("2026-01-05");
  });

  it("leaves the system unchanged when no exam matches the id", () => {
    const a = exam("a", "Dr. A", []);
    const system = [scheduled("2026-01-01", a)];
    const moved = withExamById(system, "does-not-exist", "2026-01-05");
    expect(moved[0].date).toBe("2026-01-01");
  });
});

describe("legalDatesFor", () => {
  it("returns an empty set when no period matches the exam's semester and moed", () => {
    const a = exam("a", "Dr. A", [], { semester: "SUMM", moed: "GIMEL" });
    const input: LegalityInput = {
      exam: a,
      system: [scheduled("2026-01-01", a)],
      periods: [period()],
      settings: settings(),
    };
    expect(legalDatesFor(input).size).toBe(0);
  });

  it("allows every date of the period when the exam is alone in the system", () => {
    const a = exam("a", "Dr. A", []);
    const input: LegalityInput = {
      exam: a,
      system: [scheduled("2026-01-01", a)],
      periods: [period()],
      settings: settings(),
    };
    expect(legalDatesFor(input).size).toBe(10);
  });

  it("excludes a date that would collide with another exam of the same program/year", () => {
    const a = exam("a", "Dr. A", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const b = exam("b", "Dr. B", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const input: LegalityInput = {
      exam: a,
      system: [scheduled("2026-01-01", a), scheduled("2026-01-05", b)],
      periods: [period()],
      settings: settings(),
    };
    const legal = legalDatesFor(input);
    expect(legal.has("2026-01-05")).toBe(false);
    expect(legal.has("2026-01-06")).toBe(true);
  });

  it("does not treat two elective exams of the same program/year as colliding", () => {
    const a = exam("a", "Dr. A", [{ programNumber: "83101", year: 1, requirement: "Elective" }]);
    const b = exam("b", "Dr. B", [{ programNumber: "83101", year: 1, requirement: "Elective" }]);
    const input: LegalityInput = {
      exam: a,
      system: [scheduled("2026-01-01", a), scheduled("2026-01-05", b)],
      periods: [period()],
      settings: settings(),
    };
    expect(legalDatesFor(input).has("2026-01-05")).toBe(true);
  });

  it("excludes a date that collides via a shared instructor, even in different programs", () => {
    const a = exam("a", "Dr. A", [{ programNumber: "83101", year: 1, requirement: "Elective" }]);
    const b = exam("b", "Dr. A", [{ programNumber: "83102", year: 1, requirement: "Elective" }]);
    const input: LegalityInput = {
      exam: a,
      system: [scheduled("2026-01-01", a), scheduled("2026-01-05", b)],
      periods: [period()],
      settings: settings(),
    };
    expect(legalDatesFor(input).has("2026-01-05")).toBe(false);
  });

  it("excludes a date outside the period", () => {
    const a = exam("a", "Dr. A", []);
    const input: LegalityInput = {
      exam: a,
      system: [scheduled("2026-01-01", a)],
      periods: [period({ startDate: "2026-01-01", endDate: "2026-01-05" })],
      settings: settings(),
    };
    expect(legalDatesFor(input).has("2026-01-06")).toBe(false);
  });

  it("excludes a date the period itself excludes", () => {
    const a = exam("a", "Dr. A", []);
    const input: LegalityInput = {
      exam: a,
      system: [scheduled("2026-01-01", a)],
      periods: [period({ excluded: [{ start: "2026-01-03", end: "2026-01-03", comment: "" }] })],
      settings: settings(),
    };
    expect(legalDatesFor(input).has("2026-01-03")).toBe(false);
  });

  it("excludes a date the instructor is unavailable on, when faculty rules are given", () => {
    const a = exam("a", "Dr. A", []);
    const faculty: FacultyRules = { "Dr. A": [{ start: "2026-01-03", end: "2026-01-03", comment: "" }] };
    const input: LegalityInput = {
      exam: a,
      system: [scheduled("2026-01-01", a)],
      periods: [period()],
      settings: settings(),
      faculty,
    };
    expect(legalDatesFor(input).has("2026-01-03")).toBe(false);
  });

  it("does not filter by instructor availability when faculty rules are omitted", () => {
    const a = exam("a", "Dr. A", []);
    const input: LegalityInput = {
      exam: a,
      system: [scheduled("2026-01-01", a)],
      periods: [period()],
      settings: settings(),
    };
    expect(legalDatesFor(input).size).toBe(10);
  });

  it("excludes a date that would exceed an active maxExamsPerDay threshold", () => {
    const a = exam("a", "Dr. A", []);
    const b = exam("b", "Dr. B", []);
    const c = exam("c", "Dr. C", []);
    const input: LegalityInput = {
      exam: a,
      system: [scheduled("2026-01-01", a), scheduled("2026-01-05", b), scheduled("2026-01-05", c)],
      periods: [period()],
      settings: settings({ maxExamsPerDay: 2 }),
    };
    expect(legalDatesFor(input).has("2026-01-05")).toBe(false);
  });

  it("respects an active minDaysBetweenObligatory threshold within the same period", () => {
    const a = exam("a", "Dr. A", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const b = exam("b", "Dr. B", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const input: LegalityInput = {
      exam: a,
      system: [scheduled("2026-01-01", a), scheduled("2026-01-05", b)],
      periods: [period()],
      settings: settings({ minDaysBetweenObligatory: 5 }),
    };
    const legal = legalDatesFor(input);
    expect(legal.has("2026-01-06")).toBe(false); // only 1 day away, needs 5
    expect(legal.has("2026-01-10")).toBe(true); // 5 days away
  });

  it("excludes a date that fails room capacity when requireRooms is set", () => {
    const a = exam("a", "Dr. A", []);
    const b = exam("b", "Dr. B", []);
    const allocator = new RoomAllocator([{ name: "Only", capacity: 30, location: "" }]);
    const input: LegalityInput = {
      exam: a,
      system: [scheduled("2026-01-01", a), scheduled("2026-01-05", b)],
      periods: [period()],
      settings: settings({ requireRooms: true }),
      roomAllocator: allocator,
    };
    expect(legalDatesFor(input).has("2026-01-05")).toBe(false);
  });

  it("does not check rooms when requireRooms is off, even with an allocator given", () => {
    const a = exam("a", "Dr. A", []);
    const b = exam("b", "Dr. B", []);
    const allocator = new RoomAllocator([{ name: "Only", capacity: 30, location: "" }]);
    const input: LegalityInput = {
      exam: a,
      system: [scheduled("2026-01-01", a), scheduled("2026-01-05", b)],
      periods: [period()],
      settings: settings({ requireRooms: false }),
      roomAllocator: allocator,
    };
    expect(legalDatesFor(input).has("2026-01-05")).toBe(true);
  });
});
