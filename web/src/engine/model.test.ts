import { describe, expect, it } from "vitest";
import {
  EnrollmentRoster,
  ExamPeriod,
  FacultyRules,
  addDays,
  applyGlobalExcluded,
  availableDates,
  datesBetween,
  fromDisplayDate,
  fromIso,
  isExcluded,
  isInstructorAvailable,
  periodKey,
  sharesStudents,
  slotKey,
  toDisplayDate,
  toIso,
} from "./model";

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

describe("periodKey", () => {
  it("joins semester and moed with a pipe", () => {
    expect(periodKey("FALL", "ALEPH")).toBe("FALL|ALEPH");
  });
  it("distinguishes every semester/moed combination", () => {
    const keys = new Set<string>();
    for (const semester of ["FALL", "SPRI", "SUMM"] as const) {
      for (const moed of ["ALEPH", "BET", "GIMEL"] as const) {
        keys.add(periodKey(semester, moed));
      }
    }
    expect(keys.size).toBe(9);
  });
});

describe("slotKey", () => {
  it("joins program and year with a pipe", () => {
    expect(slotKey("83101", 1)).toBe("83101|1");
  });
  it("distinguishes different years of the same program", () => {
    expect(slotKey("83101", 1)).not.toBe(slotKey("83101", 2));
  });
  it("distinguishes different programs of the same year", () => {
    expect(slotKey("83101", 1)).not.toBe(slotKey("83102", 1));
  });
});

describe("toIso / fromIso round trip", () => {
  const cases: [number, number, number][] = [
    [2026, 1, 1],
    [2026, 1, 29],
    [2026, 12, 31],
    [2024, 2, 29], // leap day
    [2026, 2, 28],
    [2000, 2, 29], // leap century
    [2026, 9, 5],
  ];

  it.each(cases)("round-trips %i-%i-%i", (year, month, day) => {
    const date = new Date(year, month - 1, day);
    const iso = toIso(date);
    expect(iso).toBe(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    const back = fromIso(iso);
    expect(back.getFullYear()).toBe(year);
    expect(back.getMonth()).toBe(month - 1);
    expect(back.getDate()).toBe(day);
  });

  it("pads single-digit months and days with a leading zero", () => {
    expect(toIso(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("toDisplayDate", () => {
  it("reformats an ISO date to DD-MM-YYYY", () => {
    expect(toDisplayDate("2026-01-29")).toBe("29-01-2026");
  });
  it("handles the last day of the year", () => {
    expect(toDisplayDate("2026-12-31")).toBe("31-12-2026");
  });
});

describe("fromDisplayDate", () => {
  it("parses a valid DD-MM-YYYY date", () => {
    expect(fromDisplayDate("29-01-2026")).toBe("2026-01-29");
  });
  it("trims surrounding whitespace", () => {
    expect(fromDisplayDate("  29-01-2026  ")).toBe("2026-01-29");
  });
  it("accepts a real leap day", () => {
    expect(fromDisplayDate("29-02-2024")).toBe("2024-02-29");
  });
  it("rejects a fake leap day on a non-leap year", () => {
    expect(fromDisplayDate("29-02-2026")).toBeNull();
  });
  it("rejects day 32", () => {
    expect(fromDisplayDate("32-01-2026")).toBeNull();
  });
  it("rejects day 00", () => {
    expect(fromDisplayDate("00-01-2026")).toBeNull();
  });
  it("rejects month 13", () => {
    expect(fromDisplayDate("15-13-2026")).toBeNull();
  });
  it("rejects month 00", () => {
    expect(fromDisplayDate("15-00-2026")).toBeNull();
  });
  it("rejects April 31st (a real month with no 31st day)", () => {
    expect(fromDisplayDate("31-04-2026")).toBeNull();
  });
  it("rejects garbage text", () => {
    expect(fromDisplayDate("not a date")).toBeNull();
  });
  it("rejects an ISO-formatted string (wrong order)", () => {
    expect(fromDisplayDate("2026-01-29")).toBeNull();
  });
  it("rejects an empty string", () => {
    expect(fromDisplayDate("")).toBeNull();
  });
  it("rejects a partial date", () => {
    expect(fromDisplayDate("29-01")).toBeNull();
  });
  it("rejects single-digit day/month even if the value is valid", () => {
    expect(fromDisplayDate("9-1-2026")).toBeNull();
  });
});

describe("addDays", () => {
  it("adds a positive number of days within a month", () => {
    expect(addDays("2026-01-01", 5)).toBe("2026-01-06");
  });
  it("subtracts with a negative number of days", () => {
    expect(addDays("2026-01-06", -5)).toBe("2026-01-01");
  });
  it("rolls over a month boundary", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });
  it("rolls over a year boundary", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("rolls backward over a year boundary", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("adds zero days as a no-op", () => {
    expect(addDays("2026-06-15", 0)).toBe("2026-06-15");
  });
  it("rolls forward over a leap day", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
  });
  it("skips the leap day entirely on a non-leap year", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("datesBetween", () => {
  it("includes both endpoints", () => {
    expect(datesBetween("2026-01-01", "2026-01-03")).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
  });
  it("returns a single date when start equals end", () => {
    expect(datesBetween("2026-01-01", "2026-01-01")).toEqual(["2026-01-01"]);
  });
  it("returns an empty list when start is after end", () => {
    expect(datesBetween("2026-01-05", "2026-01-01")).toEqual([]);
  });
  it("spans a month boundary correctly", () => {
    const dates = datesBetween("2026-01-30", "2026-02-02");
    expect(dates).toEqual(["2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02"]);
  });
  it("spans a leap day", () => {
    const dates = datesBetween("2024-02-27", "2024-03-01");
    expect(dates).toContain("2024-02-29");
    expect(dates).toHaveLength(4);
  });
});

describe("isExcluded", () => {
  it("is false when there are no excluded ranges", () => {
    expect(isExcluded(period(), "2026-01-05")).toBe(false);
  });
  it("is true for a date inside a single-day exclusion", () => {
    const p = period({ excluded: [{ start: "2026-01-05", end: "2026-01-05", comment: "" }] });
    expect(isExcluded(p, "2026-01-05")).toBe(true);
  });
  it("is true for a date inside a multi-day exclusion range", () => {
    const p = period({ excluded: [{ start: "2026-01-05", end: "2026-01-07", comment: "" }] });
    expect(isExcluded(p, "2026-01-06")).toBe(true);
  });
  it("is true exactly on the boundary dates of an exclusion", () => {
    const p = period({ excluded: [{ start: "2026-01-05", end: "2026-01-07", comment: "" }] });
    expect(isExcluded(p, "2026-01-05")).toBe(true);
    expect(isExcluded(p, "2026-01-07")).toBe(true);
  });
  it("is false just outside an exclusion range", () => {
    const p = period({ excluded: [{ start: "2026-01-05", end: "2026-01-07", comment: "" }] });
    expect(isExcluded(p, "2026-01-04")).toBe(false);
    expect(isExcluded(p, "2026-01-08")).toBe(false);
  });
  it("checks every exclusion range, not just the first", () => {
    const p = period({
      excluded: [
        { start: "2026-01-01", end: "2026-01-01", comment: "" },
        { start: "2026-01-10", end: "2026-01-10", comment: "" },
      ],
    });
    expect(isExcluded(p, "2026-01-10")).toBe(true);
  });
});

describe("availableDates", () => {
  it("returns every date of a period with no exclusions", () => {
    const p = period({ startDate: "2026-01-01", endDate: "2026-01-03" });
    expect(availableDates(p)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });
  it("omits an excluded date in the middle", () => {
    const p = period({
      startDate: "2026-01-01",
      endDate: "2026-01-03",
      excluded: [{ start: "2026-01-02", end: "2026-01-02", comment: "" }],
    });
    expect(availableDates(p)).toEqual(["2026-01-01", "2026-01-03"]);
  });
  it("returns an empty list when the whole period is excluded", () => {
    const p = period({
      startDate: "2026-01-01",
      endDate: "2026-01-03",
      excluded: [{ start: "2026-01-01", end: "2026-01-03", comment: "" }],
    });
    expect(availableDates(p)).toEqual([]);
  });
});

describe("applyGlobalExcluded", () => {
  it("adds the given dates to every period's own excluded list", () => {
    const periods = [
      period({ semester: "FALL", moed: "ALEPH" }),
      period({ semester: "SPRI", moed: "BET" }),
    ];
    const excluded = [{ start: "2026-01-02", end: "2026-01-02", comment: "closure" }];

    const result = applyGlobalExcluded(periods, excluded);

    expect(result[0].excluded).toEqual(excluded);
    expect(result[1].excluded).toEqual(excluded);
    expect(availableDates(result[0])).not.toContain("2026-01-02");
  });

  it("does not mutate the periods that were passed in", () => {
    const original = period();
    applyGlobalExcluded([original], [{ start: "2026-01-02", end: "2026-01-02", comment: "" }]);
    expect(original.excluded).toEqual([]);
  });

  it("returns the same array reference when there is nothing to add", () => {
    const periods = [period()];
    expect(applyGlobalExcluded(periods, [])).toBe(periods);
  });
});

describe("isInstructorAvailable", () => {
  it("is available when the instructor has no rules at all", () => {
    expect(isInstructorAvailable({}, "Dr. A", "2026-01-05")).toBe(true);
  });
  it("is available on a date outside that instructor's excluded range", () => {
    const rules: FacultyRules = { "Dr. A": [{ start: "2026-01-01", end: "2026-01-03", comment: "" }] };
    expect(isInstructorAvailable(rules, "Dr. A", "2026-01-05")).toBe(true);
  });
  it("is unavailable on a date inside that instructor's excluded range", () => {
    const rules: FacultyRules = { "Dr. A": [{ start: "2026-01-01", end: "2026-01-03", comment: "" }] };
    expect(isInstructorAvailable(rules, "Dr. A", "2026-01-02")).toBe(false);
  });
  it("does not apply one instructor's exclusion to a different instructor", () => {
    const rules: FacultyRules = { "Dr. A": [{ start: "2026-01-01", end: "2026-01-03", comment: "" }] };
    expect(isInstructorAvailable(rules, "Dr. B", "2026-01-02")).toBe(true);
  });
  it("is unavailable exactly on the boundary dates", () => {
    const rules: FacultyRules = { "Dr. A": [{ start: "2026-01-01", end: "2026-01-03", comment: "" }] };
    expect(isInstructorAvailable(rules, "Dr. A", "2026-01-01")).toBe(false);
    expect(isInstructorAvailable(rules, "Dr. A", "2026-01-03")).toBe(false);
  });
});

describe("sharesStudents", () => {
  it("is true when a real student is enrolled in both courses", () => {
    const roster: EnrollmentRoster = { "83112": ["a", "b"], "83113": ["b", "c"] };
    expect(sharesStudents(roster, "83112", "83113")).toBe(true);
  });

  it("is false with no overlap between the two rosters", () => {
    const roster: EnrollmentRoster = { "83112": ["a"], "83113": ["b"] };
    expect(sharesStudents(roster, "83112", "83113")).toBe(false);
  });

  it("is false when one of the courses has no roster at all", () => {
    const roster: EnrollmentRoster = { "83112": ["a"] };
    expect(sharesStudents(roster, "83112", "99999")).toBe(false);
  });

  it("is true for a course shared with itself when it has students", () => {
    const roster: EnrollmentRoster = { "83112": ["a"] };
    expect(sharesStudents(roster, "83112", "83112")).toBe(true);
  });

  it("is false for an unknown course shared with itself", () => {
    expect(sharesStudents({}, "83112", "83112")).toBe(false);
  });
});
