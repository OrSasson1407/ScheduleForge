import { describe, expect, it } from "vitest";
import { colorDay, conflicts } from "./timeSlots";
import { EnrollmentRoster, Exam, Requirement } from "./model";

let nextId = 0;
function exam(slots: { programNumber: string; year: number; requirement: Requirement }[]): Exam {
  nextId += 1;
  return {
    id: `exam-${nextId}`,
    course: { number: `8310${nextId}`, name: "Course", instructor: "Dr. A", enrollments: [], evaluation: "Exam" },
    semester: "FALL",
    moed: "ALEPH",
    slots: slots.map((s) => ({ key: `${s.programNumber}|${s.year}`, ...s })),
  };
}

describe("conflicts", () => {
  it("conflicts when two exams share a program and year", () => {
    const first = exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const second = exam([{ programNumber: "83101", year: 1, requirement: "Elective" }]);
    expect(conflicts(first, second)).toBe(true);
  });

  it("does not conflict with no shared slot and no roster", () => {
    const first = exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const second = exam([{ programNumber: "83102", year: 1, requirement: "Obligatory" }]);
    expect(conflicts(first, second)).toBe(false);
  });

  it("conflicts via a roster even with no shared slot", () => {
    const first = exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const second = exam([{ programNumber: "83102", year: 1, requirement: "Obligatory" }]);
    const roster: EnrollmentRoster = { [first.course.number]: ["2021001"], [second.course.number]: ["2021001"] };
    expect(conflicts(first, second, roster)).toBe(true);
  });

  it("a roster with no overlap does not conflict", () => {
    const first = exam([]);
    const second = exam([]);
    const roster: EnrollmentRoster = { [first.course.number]: ["2021001"], [second.course.number]: ["2021002"] };
    expect(conflicts(first, second, roster)).toBe(false);
  });
});

describe("colorDay", () => {
  it("gives a single exam the first slot", () => {
    const only = exam([]);
    expect(colorDay([only], 2)).toEqual(new Map([[only.id, 0]]));
  });

  it("lets two non-conflicting exams share a slot", () => {
    const first = exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const second = exam([{ programNumber: "83102", year: 1, requirement: "Obligatory" }]);
    const colors = colorDay([first, second], 1);
    expect(colors?.get(first.id)).toBe(0);
    expect(colors?.get(second.id)).toBe(0);
  });

  it("gives two conflicting exams different slots", () => {
    const first = exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const second = exam([{ programNumber: "83101", year: 1, requirement: "Elective" }]);
    const colors = colorDay([first, second], 2);
    expect(colors?.get(first.id)).not.toBe(colors?.get(second.id));
  });

  it("returns null when there are not enough slots", () => {
    const first = exam([{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const second = exam([{ programNumber: "83101", year: 1, requirement: "Elective" }]);
    expect(colorDay([first, second], 1)).toBeNull();
  });

  it("needs three slots for a triangle of mutual conflicts", () => {
    const slot = [{ programNumber: "83101", year: 1, requirement: "Obligatory" as Requirement }];
    const exams = [exam(slot), exam(slot), exam(slot)];
    expect(colorDay(exams, 3)).not.toBeNull();
    expect(colorDay(exams, 2)).toBeNull();
  });

  it("colors an empty list to an empty map", () => {
    expect(colorDay([], 1)).toEqual(new Map());
  });

  it("handles exactly as many mutually conflicting exams as slots", () => {
    const slot = [{ programNumber: "83101", year: 1, requirement: "Obligatory" as Requirement }];
    const exams = [exam(slot), exam(slot), exam(slot)];
    const colors = colorDay(exams, 3);
    expect(colors).not.toBeNull();
    expect(new Set(colors!.values()).size).toBe(3);
  });
});
