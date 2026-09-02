import { describe, expect, it } from "vitest";
import { Candidate, describeSearch, runSearch, sortCandidates } from "./generator";
import { decompose } from "./decomposition";
import { Exam, ExamPeriod, ExamSystem, Requirement } from "./model";
import { DEFAULT_SETTINGS, Settings } from "./settings";
import { measure } from "./quality";

function exam(
  id: string,
  instructor: string,
  slots: { programNumber: string; year: number; requirement: Requirement }[]
): Exam {
  return {
    id,
    course: { number: id, name: "Course", instructor, enrollments: [], evaluation: "Exam" },
    semester: "FALL",
    moed: "ALEPH",
    slots: slots.map((s) => ({ key: `${s.programNumber}|${s.year}`, ...s })),
  };
}

function period(overrides: Partial<ExamPeriod> = {}): ExamPeriod {
  return {
    semester: "FALL",
    moed: "ALEPH",
    startDate: "2026-01-01",
    endDate: "2026-01-05",
    excluded: [],
    ...overrides,
  };
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("runSearch", () => {
  it("returns no candidates for an empty exam list", () => {
    const decomposition = decompose([], [], DEFAULT_SETTINGS);
    const result = runSearch({ exams: [], decomposition, settings: DEFAULT_SETTINGS });
    expect(result.candidates).toEqual([]);
    expect(result.report.examined).toBe(0);
    expect(result.report.accepted).toBe(0);
    expect(result.report.status).toBe("complete");
  });

  it("finds every legal system when the space is small and unconstrained", () => {
    // Three independent exams (different instructors, different programs), a
    // 5-day period each -> 3 components of size 1 -> 5*5*5 = 125 systems.
    const exams = [
      exam("83101", "Dr. A", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam("83102", "Dr. B", [{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
      exam("83103", "Dr. C", [{ programNumber: "83103", year: 1, requirement: "Obligatory" }]),
    ];
    const decomposition = decompose(exams, [period()], settings());
    expect(decomposition.total).toBe(125n);
    const result = runSearch({ exams, decomposition, settings: settings() });
    expect(result.report.status).toBe("complete");
    expect(result.report.examined).toBe(125);
    expect(result.report.accepted).toBe(125);
    expect(result.candidates).toHaveLength(125);
  });

  it("never returns the same system twice, even when several walk paths could reach it", () => {
    const exams = [
      exam("83101", "Dr. A", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam("83102", "Dr. B", [{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
    ];
    const decomposition = decompose(exams, [period()], settings());
    const result = runSearch({ exams, decomposition, settings: settings() });
    const keys = result.candidates.map((c) => c.system.map((s) => s.date).join("|"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("stops early with status 'enough' once maxCandidates is reached and nothing is ranked", () => {
    const exams = [
      exam("83101", "Dr. A", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam("83102", "Dr. B", [{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
    ];
    const decomposition = decompose(exams, [period()], settings());
    const result = runSearch({
      exams,
      decomposition,
      settings: settings({ sortCriteria: [], maxCandidates: 5 }),
    });
    expect(result.report.status).toBe("enough");
    expect(result.candidates).toHaveLength(5);
    expect(result.report.examined).toBe(5);
  });

  it("keeps searching past maxCandidates when ranked, to find the best systems", () => {
    const exams = [
      exam("83101", "Dr. A", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam("83102", "Dr. B", [{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
    ];
    const decomposition = decompose(exams, [period()], settings());
    const result = runSearch({
      exams,
      decomposition,
      settings: settings({ maxCandidates: 5 }),
    });
    expect(result.report.status).toBe("complete");
    expect(result.report.examined).toBe(25); // the whole 5*5 space was examined
    expect(result.candidates).toHaveLength(5); // but only the best 5 were kept
  });

  it("stops with status 'examined limit' once maxExamined is reached", () => {
    const exams = [
      exam("83101", "Dr. A", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam("83102", "Dr. B", [{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
    ];
    const decomposition = decompose(exams, [period()], settings());
    const result = runSearch({
      exams,
      decomposition,
      settings: settings({ maxExamined: 5 }),
    });
    expect(result.report.status).toBe("examined limit");
    expect(result.report.examined).toBe(5);
  });

  it("rejects a system that cannot seat every exam when requireRooms is on", () => {
    const exams = [
      exam("83101", "Dr. A", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam("83102", "Dr. B", [{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
    ];
    const decomposition = decompose(exams, [period()], settings());
    const result = runSearch({
      exams,
      decomposition,
      settings: settings({ requireRooms: true, defaultStudents: 30 }),
      rooms: [{ name: "Only", capacity: 30, location: "" }],
    });
    // Both exams need 30 seats; only one 30-seat room exists, so a same-day
    // placement is pruned by the partial room-capacity check before it is even
    // walked to completion - it never reaches "examined" at all.
    expect(result.report.examined).toBeLessThan(Number(decomposition.total));
    expect(result.report.accepted).toBe(result.report.examined);
    for (const candidate of result.candidates) {
      const dates = candidate.system.map((s) => s.date);
      expect(dates[0]).not.toBe(dates[1]);
    }
  });

  it("gives every accepted candidate a complete room allocation when rooms are provided and requireRooms is on", () => {
    const exams = [exam("83101", "Dr. A", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }])];
    const decomposition = decompose(exams, [period()], settings());
    const result = runSearch({
      exams,
      decomposition,
      settings: settings({ requireRooms: true }),
      rooms: [{ name: "Hall", capacity: 100, location: "" }],
    });
    for (const candidate of result.candidates) {
      expect(candidate.allocation?.isComplete).toBe(true);
    }
  });

  it("does not allocate rooms when no rooms file is given", () => {
    const exams = [exam("83101", "Dr. A", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }])];
    const decomposition = decompose(exams, [period()], settings());
    const result = runSearch({ exams, decomposition, settings: settings() });
    expect(result.candidates[0].allocation).toBeNull();
  });

  it("applies an aggregate threshold (maxExamsPerDay) during the walk", () => {
    const exams = [
      exam("83101", "Dr. A", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam("83102", "Dr. B", [{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
    ];
    const decomposition = decompose(exams, [period()], settings({ maxExamsPerDay: 1 }));
    const result = runSearch({ exams, decomposition, settings: settings({ maxExamsPerDay: 1 }) });
    for (const candidate of result.candidates) {
      const dates = candidate.system.map((s) => s.date);
      expect(dates[0]).not.toBe(dates[1]);
    }
  });

  it("reports the correct totalSystems even when accepted is smaller due to thresholds", () => {
    const exams = [
      exam("83101", "Dr. A", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam("83102", "Dr. B", [{ programNumber: "83102", year: 1, requirement: "Obligatory" }]),
    ];
    const decomposition = decompose(exams, [period()], settings({ maxExamsPerDay: 1 }));
    const result = runSearch({ exams, decomposition, settings: settings({ maxExamsPerDay: 1 }) });
    expect(result.report.totalSystems).toBe(decomposition.total);
    expect(result.report.accepted).toBeLessThan(Number(decomposition.total));
  });
});

describe("sortCandidates", () => {
  function candidateWithGap(gapDays: number): Candidate {
    const exams: Exam[] = [
      exam("83101", "Dr. A", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
      exam("83102", "Dr. B", [{ programNumber: "83101", year: 1, requirement: "Obligatory" }]),
    ];
    const system: ExamSystem = [
      { exam: exams[0], date: "2026-01-01" },
      { exam: exams[1], date: `2026-01-${String(1 + gapDays).padStart(2, "0")}` },
    ];
    return { system, metrics: measure(system), allocation: null };
  }

  it("returns the same array reference it was given", () => {
    const candidates = [candidateWithGap(1)];
    expect(sortCandidates(candidates, ["min_days_between_obligatory"])).toBe(candidates);
  });

  it("orders candidates by min_days_between_obligatory, widest gap first", () => {
    const narrow = candidateWithGap(2);
    const wide = candidateWithGap(10);
    const sorted = sortCandidates([narrow, wide], ["min_days_between_obligatory"]);
    expect(sorted[0]).toBe(wide);
  });

  it("does not reorder anything when no criteria are given", () => {
    const a = candidateWithGap(2);
    const b = candidateWithGap(10);
    const sorted = sortCandidates([a, b], []);
    expect(sorted).toEqual([a, b]);
  });
});

describe("describeSearch", () => {
  it("mentions the total when the search completed", () => {
    const report = { examined: 10, accepted: 10, status: "complete" as const, seconds: 0.5, totalSystems: 10n };
    expect(describeSearch(report, 10)).toContain("10");
  });

  it("shows an unknown-count placeholder when totalSystems is null", () => {
    const report = { examined: 10, accepted: 10, status: "complete" as const, seconds: 0.5, totalSystems: null };
    const text = describeSearch(report, 10);
    expect(text).not.toContain("null");
  });

  it("mentions that fewer were kept than accepted when kept is smaller", () => {
    const report = { examined: 100, accepted: 50, status: "enough" as const, seconds: 1, totalSystems: 1000n };
    const text = describeSearch(report, 10);
    expect(text).toContain("50");
    expect(text).toContain("10");
  });

  it("does not mention a kept-vs-accepted split when everything accepted was kept", () => {
    const report = { examined: 50, accepted: 50, status: "complete" as const, seconds: 1, totalSystems: 50n };
    const text = describeSearch(report, 50);
    expect(text).toContain("50");
  });

  it.each(["complete", "enough", "examined limit", "timed out"] as const)(
    "produces a non-empty description for status %s",
    (status) => {
      const report = { examined: 5, accepted: 5, status, seconds: 0.1, totalSystems: 100n };
      expect(describeSearch(report, 5).length).toBeGreaterThan(0);
    }
  );

  it("includes the elapsed seconds formatted to two decimal places", () => {
    const report = { examined: 1, accepted: 1, status: "complete" as const, seconds: 1.23456, totalSystems: 1n };
    expect(describeSearch(report, 1)).toContain("1.23");
  });
});
