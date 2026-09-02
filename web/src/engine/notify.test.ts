import { describe, expect, it } from "vitest";
import { ScheduleChange, diffSystems, draftsFor } from "./notify";
import { Exam, ExamSystem, Requirement } from "./model";
import { StudyProgram } from "./catalog";

function exam(
  id: string,
  slots: { programNumber: string; year: number; requirement: Requirement }[],
  courseNumber = "83101"
): Exam {
  return {
    id,
    course: { number: courseNumber, name: "Course", instructor: "Dr. A", enrollments: [], evaluation: "Exam" },
    semester: "FALL",
    moed: "ALEPH",
    slots: slots.map((s) => ({ key: `${s.programNumber}|${s.year}`, ...s })),
  };
}

function scheduled(date: string, e: Exam): ExamSystem[number] {
  return { exam: e, date };
}

describe("diffSystems", () => {
  it("reports a change when a scheduled date differs between the two systems", () => {
    const e = exam("e1", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const before = [scheduled("2026-01-01", e)];
    const after = [scheduled("2026-01-05", e)];
    const changes = diffSystems(before, after, ["83101"]);
    expect(changes).toEqual([
      { programNumber: "83101", year: 1, courseNumber: "83101", courseName: "Course", before: "2026-01-01", after: "2026-01-05" },
    ]);
  });

  it("reports no change when the date is the same in both systems", () => {
    const e = exam("e1", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const before = [scheduled("2026-01-01", e)];
    const after = [scheduled("2026-01-01", e)];
    expect(diffSystems(before, after, ["83101"])).toEqual([]);
  });

  it("reports a change with before: null when the exam is new (no prior system)", () => {
    const e = exam("e1", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const after = [scheduled("2026-01-01", e)];
    const changes = diffSystems(null, after, ["83101"]);
    expect(changes[0].before).toBeNull();
  });

  it("reports a change with before: null when the exam did not exist in the prior system", () => {
    const e1 = exam("e1", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const e2 = exam("e2", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]);
    const before = [scheduled("2026-01-01", e1)];
    const after = [scheduled("2026-01-01", e1), scheduled("2026-01-02", e2)];
    const changes = diffSystems(before, after, ["83101"]);
    expect(changes).toHaveLength(1);
    expect(changes[0].before).toBeNull();
  });

  it("only reports changes for the given program numbers", () => {
    const e = exam("e1", [
      { programNumber: "83101", year: 1, requirement: "Obligatory" },
      { programNumber: "83102", year: 1, requirement: "Obligatory" },
    ]);
    const before = [scheduled("2026-01-01", e)];
    const after = [scheduled("2026-01-05", e)];
    const changes = diffSystems(before, after, ["83101"]);
    expect(changes.map((c) => c.programNumber)).toEqual(["83101"]);
  });

  it("reports one change per program/year slot of a changed exam", () => {
    const e = exam("e1", [
      { programNumber: "83101", year: 1, requirement: "Obligatory" },
      { programNumber: "83101", year: 2, requirement: "Obligatory" },
    ]);
    const before = [scheduled("2026-01-01", e)];
    const after = [scheduled("2026-01-05", e)];
    const changes = diffSystems(before, after, ["83101"]);
    expect(changes).toHaveLength(2);
    expect(changes.map((c) => c.year).sort()).toEqual([1, 2]);
  });

  it("deduplicates a slot that appears twice on the same exam", () => {
    const e = exam("e1", [
      { programNumber: "83101", year: 1, requirement: "Obligatory" },
      { programNumber: "83101", year: 1, requirement: "Obligatory" },
    ]);
    const before = [scheduled("2026-01-01", e)];
    const after = [scheduled("2026-01-05", e)];
    expect(diffSystems(before, after, ["83101"])).toHaveLength(1);
  });

  it("sorts changes by program, then year, then course number", () => {
    const e1 = exam("e1", [{ programNumber: "83102", year: 1, requirement: "Obligatory" }], "83201");
    const e2 = exam("e2", [{ programNumber: "83101", year: 2, requirement: "Obligatory" }], "83101");
    const e3 = exam("e3", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }], "83102");
    const before: ExamSystem = [];
    const after = [scheduled("2026-01-01", e1), scheduled("2026-01-01", e2), scheduled("2026-01-01", e3)];
    const changes = diffSystems(before, after, ["83101", "83102"]);
    expect(changes.map((c) => `${c.programNumber}|${c.year}|${c.courseNumber}`)).toEqual([
      "83101|1|83102",
      "83101|2|83101",
      "83102|1|83201",
    ]);
  });

  it("returns an empty list for an empty after system", () => {
    expect(diffSystems(null, [], ["83101"])).toEqual([]);
  });
});

const programs: StudyProgram[] = [{ number: "83101", name: "Computer Science" }];

function change(overrides: Partial<ScheduleChange> = {}): ScheduleChange {
  return {
    programNumber: "83101",
    year: 1,
    courseNumber: "83101",
    courseName: "Intro to Testing",
    before: "2026-01-01",
    after: "2026-01-05",
    ...overrides,
  };
}

describe("draftsFor", () => {
  it("returns no drafts for no changes", () => {
    expect(draftsFor([], programs)).toEqual([]);
  });

  it("returns one draft per distinct program/year", () => {
    const drafts = draftsFor(
      [change({ programNumber: "83101", year: 1 }), change({ programNumber: "83101", year: 2 })],
      programs
    );
    expect(drafts).toHaveLength(2);
  });

  it("groups changes of the same program/year into a single draft", () => {
    const drafts = draftsFor(
      [change({ courseNumber: "83101" }), change({ courseNumber: "83102" })],
      programs
    );
    expect(drafts).toHaveLength(1);
  });

  it("includes the resolved program name in the subject", () => {
    const [draft] = draftsFor([change()], programs);
    expect(draft.subject).toContain("Computer Science");
  });

  it("falls back to the raw program number when the program has no name", () => {
    const [draft] = draftsFor([change({ programNumber: "99999" })], programs);
    expect(draft.subject).toContain("99999");
  });

  it("mentions a moved exam's old and new dates in the body", () => {
    const [draft] = draftsFor([change({ before: "2026-01-01", after: "2026-01-05" })], programs);
    expect(draft.body).toContain("01-01-2026");
    expect(draft.body).toContain("05-01-2026");
  });

  it("mentions only the new date for a brand-new exam (before is null)", () => {
    const [draft] = draftsFor([change({ before: null, after: "2026-01-05" })], programs);
    expect(draft.body).toContain("05-01-2026");
    expect(draft.body).not.toContain("01-01-2026");
  });

  it("builds a mailto URL with URL-encoded subject and body", () => {
    const [draft] = draftsFor([change()], programs);
    expect(draft.mailtoUrl).toMatch(/^mailto:\?subject=.+&body=.+$/);
    expect(draft.mailtoUrl).not.toContain(" ");
  });

  it("carries the programNumber and year through onto the draft", () => {
    const [draft] = draftsFor([change({ programNumber: "83101", year: 3 })], programs);
    expect(draft.programNumber).toBe("83101");
    expect(draft.year).toBe(3);
  });
});
