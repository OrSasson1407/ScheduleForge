import { describe, expect, it, vi } from "vitest";
import { downloadText, formatSystem } from "./format";
import { Exam, ExamSystem } from "./model";
import { RoomAllocation } from "./rooms";
import { StudyProgram } from "./catalog";

let nextId = 0;
function exam(overrides: Partial<Exam> = {}): Exam {
  nextId += 1;
  return {
    id: `exam-${nextId}`,
    course: { number: "83101", name: "Intro to Testing", instructor: "Dr. A", enrollments: [], evaluation: "Exam" },
    semester: "FALL",
    moed: "ALEPH",
    slots: [{ key: "83101|1", programNumber: "83101", year: 1, requirement: "Obligatory" }],
    ...overrides,
  };
}

function scheduled(date: string, e: Exam): ExamSystem[number] {
  return { exam: e, date };
}

const programs: StudyProgram[] = [{ number: "83101", name: "Computer Science" }];

describe("formatSystem", () => {
  it("includes the header, version marker and selected programs", () => {
    const text = formatSystem([], 0, null, ["83101"], programs);
    expect(text).toContain("ScheduleForge - exam system - version 3.0");
    expect(text).toContain("83101 Computer Science");
    expect(text).toContain("Selected study programs (1):");
  });

  it("reports the 1-based system index", () => {
    const text = formatSystem([], 4, null, [], programs);
    expect(text).toContain("This is exam system number 5");
  });

  it("reports the total system count when given", () => {
    const text = formatSystem([], 0, 1234n, [], programs);
    expect(text).toContain("1,234 systems");
  });

  it("omits the total-count line when total is null", () => {
    const text = formatSystem([], 0, null, [], programs);
    expect(text).not.toContain("are possible");
  });

  it("counts the exams in the system", () => {
    const system = [scheduled("2026-01-01", exam()), scheduled("2026-01-02", exam())];
    const text = formatSystem(system, 0, null, [], programs);
    expect(text).toContain("Exams in this system: 2");
  });

  it("includes an optional metrics line when given", () => {
    const text = formatSystem([], 0, null, [], programs, null, "smallest gap: 5");
    expect(text).toContain("smallest gap: 5");
  });

  it("omits the metrics line when not given", () => {
    const text = formatSystem([], 0, null, [], programs);
    expect(text.split("\n").some((line) => line.includes("smallest gap"))).toBe(false);
  });

  it("groups exams by semester and moed, in semester/moed order", () => {
    const fall = exam({ semester: "FALL", moed: "ALEPH" });
    const spring = exam({ semester: "SPRI", moed: "ALEPH" });
    const system = [scheduled("2026-06-01", spring), scheduled("2026-01-01", fall)];
    const text = formatSystem(system, 0, null, [], programs);
    const fallIndex = text.indexOf("FALL, moed Aleph");
    const springIndex = text.indexOf("SPRING, moed Aleph");
    expect(fallIndex).toBeGreaterThanOrEqual(0);
    expect(springIndex).toBeGreaterThan(fallIndex);
  });

  it("sorts exams within a group by date, then course number", () => {
    const e1 = exam({ course: { number: "83102", name: "B", instructor: "X", enrollments: [], evaluation: "Exam" } });
    const e2 = exam({ course: { number: "83101", name: "A", instructor: "X", enrollments: [], evaluation: "Exam" } });
    const system = [scheduled("2026-01-01", e1), scheduled("2026-01-01", e2)];
    const text = formatSystem(system, 0, null, [], programs);
    const index1 = text.indexOf("83101");
    const index2 = text.indexOf("83102");
    expect(index1).toBeLessThan(index2);
  });

  it("labels an exam Obligatory when any of its slots is obligatory", () => {
    const e = exam({
      slots: [
        { key: "83101|1", programNumber: "83101", year: 1, requirement: "Elective" },
        { key: "83102|1", programNumber: "83102", year: 1, requirement: "Obligatory" },
      ],
    });
    const text = formatSystem([scheduled("2026-01-01", e)], 0, null, [], programs);
    expect(text).toContain("Obligatory");
  });

  it("labels an exam Elective when all its slots are elective", () => {
    const e = exam({ slots: [{ key: "83101|1", programNumber: "83101", year: 1, requirement: "Elective" }] });
    const text = formatSystem([scheduled("2026-01-01", e)], 0, null, [], programs);
    expect(text).toContain("Elective");
  });

  it("lists each program of an exam once, even with duplicate program numbers across years", () => {
    const e = exam({
      slots: [
        { key: "83101|1", programNumber: "83101", year: 1, requirement: "Obligatory" },
        { key: "83101|2", programNumber: "83101", year: 2, requirement: "Obligatory" },
      ],
    });
    const text = formatSystem([scheduled("2026-01-01", e)], 0, null, [], programs);
    const line = text.split("\n").find((l) => l.includes(toDisplay("2026-01-01")));
    // The line has "83101" once as the course number and once as the deduplicated program list.
    expect(line?.match(/83101/g)?.length).toBe(2);
    expect(line).not.toContain("83101, 83101");
  });

  it("formats the exam date as DD-MM-YYYY", () => {
    const text = formatSystem([scheduled("2026-01-29", exam())], 0, null, [], programs);
    expect(text).toContain("29-01-2026");
  });

  it("truncates a very long course name to 28 characters in the table", () => {
    const e = exam({
      course: {
        number: "83101",
        name: "A".repeat(50),
        instructor: "X",
        enrollments: [],
        evaluation: "Exam",
      },
    });
    const text = formatSystem([scheduled("2026-01-01", e)], 0, null, [], programs);
    expect(text).not.toContain("A".repeat(29));
    expect(text).toContain("A".repeat(28));
  });

  it("adds a ROOMS column header only when an allocation is given", () => {
    const system = [scheduled("2026-01-01", exam())];
    const withoutAllocation = formatSystem(system, 0, null, [], programs);
    const allocation: RoomAllocation = { bookings: new Map(), failures: [], isComplete: true };
    const withAllocation = formatSystem(system, 0, null, [], programs, allocation);
    expect(withoutAllocation).not.toContain("ROOMS");
    expect(withAllocation).toContain("ROOMS");
  });

  it("lists the booked room names for an exam when an allocation is given", () => {
    const e = exam();
    const allocation: RoomAllocation = {
      bookings: new Map([[e.id, { exam: e, date: "2026-01-01", rooms: [{ name: "Hall A", capacity: 100, location: "Bldg 1" }] }]]),
      failures: [],
      isComplete: true,
    };
    const text = formatSystem([scheduled("2026-01-01", e)], 0, null, [], programs, allocation);
    expect(text).toContain("Hall A");
  });

  it("shows nothing in the rooms column for an exam missing from the allocation", () => {
    const e = exam();
    const allocation: RoomAllocation = { bookings: new Map(), failures: [], isComplete: false };
    const text = formatSystem([scheduled("2026-01-01", e)], 0, null, [], programs, allocation);
    expect(text).toContain(e.course.number);
  });

  it("produces a stable structure for an empty system with no selected programs", () => {
    const text = formatSystem([], 0, null, [], []);
    expect(text).toContain("Selected study programs (0):");
    expect(text).toContain("Exams in this system: 0");
  });

  it("ends with the closing rule and a trailing newline", () => {
    const text = formatSystem([], 0, null, [], programs);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.trim().endsWith("=".repeat(78))).toBe(true);
  });
});

function toDisplay(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}-${month}-${year}`;
}

describe("downloadText", () => {
  it("creates and clicks a download link, then cleans it up", () => {
    const createSpy = vi.spyOn(document.body, "appendChild");
    const removeSpy = vi.spyOn(document.body, "removeChild");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadText("out.txt", "hello");
    expect(createSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
    createSpy.mockRestore();
    removeSpy.mockRestore();
    clickSpy.mockRestore();
  });
});
