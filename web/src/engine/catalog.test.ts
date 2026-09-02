import { describe, expect, it } from "vitest";
import { programName, programsOf } from "./catalog";
import { Course } from "./model";

function course(programNumbers: string[]): Course {
  return {
    number: "83101",
    name: "Course",
    instructor: "Dr. A",
    evaluation: "Exam",
    enrollments: programNumbers.map((programNumber) => ({
      programNumber,
      year: 1,
      semester: "FALL" as const,
      requirement: "Obligatory" as const,
    })),
  };
}

describe("programsOf", () => {
  it("returns an empty list for no courses", () => {
    expect(programsOf([])).toEqual([]);
  });

  it("returns every distinct program number found across courses' enrollments", () => {
    const result = programsOf([course(["83101"]), course(["83102"])]);
    expect(result.map((p) => p.number)).toEqual(["83101", "83102"]);
  });

  it("deduplicates a program number shared by several courses", () => {
    const result = programsOf([course(["83101"]), course(["83101"])]);
    expect(result).toHaveLength(1);
  });

  it("deduplicates a program number that appears twice on the same course (different years)", () => {
    const result = programsOf([course(["83101", "83101"])]);
    expect(result).toHaveLength(1);
  });

  it("sorts program numbers lexicographically", () => {
    const result = programsOf([course(["83102"]), course(["83101"])]);
    expect(result.map((p) => p.number)).toEqual(["83101", "83102"]);
  });

  it("gives every returned program an empty name", () => {
    const result = programsOf([course(["83101"])]);
    expect(result[0].name).toBe("");
  });

  it("ignores a course with no enrollments", () => {
    const empty = course([]);
    expect(programsOf([empty])).toEqual([]);
  });
});

describe("programName", () => {
  it("returns the program's name when it has one", () => {
    const programs = [{ number: "83101", name: "Computer Science" }];
    expect(programName(programs, "83101")).toBe("Computer Science");
  });

  it("falls back to the raw number when the program is not found", () => {
    expect(programName([], "83101")).toBe("83101");
  });

  it("falls back to the raw number when the program's name is empty", () => {
    const programs = [{ number: "83101", name: "" }];
    expect(programName(programs, "83101")).toBe("83101");
  });
});
