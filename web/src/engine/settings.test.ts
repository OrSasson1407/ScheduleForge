import { describe, expect, it } from "vitest";
import {
  CRITERION_DIRECTION,
  DEFAULT_SETTINGS,
  DEFAULT_SORT_CRITERIA,
  SORT_CRITERIA,
  SORT_CRITERION_TITLES,
  Settings,
  SortCriterion,
  describeThresholds,
  hasAggregateThresholds,
} from "./settings";

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/** New, off-by-default criteria (3.6, 3.7) that must not join the default sort order. */
const OPT_IN_CRITERIA: SortCriterion[] = ["min_gap_between_moeds", "worst_window_count"];

describe("DEFAULT_SETTINGS", () => {
  it("has every threshold off by default", () => {
    expect(DEFAULT_SETTINGS.minDaysBetweenObligatory).toBeNull();
    expect(DEFAULT_SETTINGS.minDaysBetweenAny).toBeNull();
    expect(DEFAULT_SETTINGS.maxElectiveCollisions).toBeNull();
    expect(DEFAULT_SETTINGS.minObligatorySpan).toBeNull();
    expect(DEFAULT_SETTINGS.maxExamsPerDay).toBeNull();
    expect(DEFAULT_SETTINGS.minGapBetweenMoeds).toBeNull();
    expect(DEFAULT_SETTINGS.maxExamsPerWindow).toBeNull();
    expect(DEFAULT_SETTINGS.windowDays).toBeNull();
    expect(DEFAULT_SETTINGS.enforceTimeSlots).toBe(false);
    expect(DEFAULT_SETTINGS.requireRooms).toBe(false);
  });

  it("defaults sortCriteria to every criterion of version 3.0, in the declared order", () => {
    // The two newest, off-by-default features are deliberately excluded: a
    // new feature should not change tie-breaking for runs that never asked
    // for it.
    expect(DEFAULT_SETTINGS.sortCriteria).toEqual(
      SORT_CRITERIA.filter((criterion) => !OPT_IN_CRITERIA.includes(criterion))
    );
    for (const criterion of OPT_IN_CRITERIA) {
      expect(DEFAULT_SETTINGS.sortCriteria).not.toContain(criterion);
    }
  });
});

describe("SORT_CRITERIA / SORT_CRITERION_TITLES / CRITERION_DIRECTION", () => {
  it("gives every sort criterion a title", () => {
    for (const criterion of SORT_CRITERIA) {
      expect(SORT_CRITERION_TITLES[criterion]).toBeTruthy();
    }
  });

  it("gives every sort criterion a direction of +1 or -1", () => {
    for (const criterion of SORT_CRITERIA) {
      expect([1, -1]).toContain(CRITERION_DIRECTION[criterion]);
    }
  });

  it("DEFAULT_SORT_CRITERIA holds every criterion except the off-by-default ones", () => {
    expect(DEFAULT_SORT_CRITERIA).not.toBe(SORT_CRITERIA);
    expect(DEFAULT_SORT_CRITERIA).toEqual(
      SORT_CRITERIA.filter((criterion) => !OPT_IN_CRITERIA.includes(criterion))
    );
  });

  it("min_gap_between_moeds is still a selectable criterion, just not a default one", () => {
    expect(SORT_CRITERIA).toContain("min_gap_between_moeds");
    expect(SORT_CRITERION_TITLES.min_gap_between_moeds).toBeTruthy();
    expect([1, -1]).toContain(CRITERION_DIRECTION.min_gap_between_moeds);
  });
});

describe("describeThresholds", () => {
  it("returns an empty list when nothing is active", () => {
    expect(describeThresholds(settings())).toEqual([]);
  });

  it("describes an active minDaysBetweenObligatory threshold", () => {
    const lines = describeThresholds(settings({ minDaysBetweenObligatory: 3 }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("3");
  });

  it("describes an active minDaysBetweenAny threshold", () => {
    const lines = describeThresholds(settings({ minDaysBetweenAny: 2 }));
    expect(lines[0]).toContain("2");
  });

  it("describes maxElectiveCollisions even when it is 0", () => {
    const lines = describeThresholds(settings({ maxElectiveCollisions: 0 }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("0");
  });

  it("describes an active minObligatorySpan threshold", () => {
    const lines = describeThresholds(settings({ minObligatorySpan: 5 }));
    expect(lines[0]).toContain("5");
  });

  it("does not describe minObligatorySpan when it is 0", () => {
    expect(describeThresholds(settings({ minObligatorySpan: 0 }))).toEqual([]);
  });

  it("describes an active maxExamsPerDay threshold", () => {
    const lines = describeThresholds(settings({ maxExamsPerDay: 4 }));
    expect(lines[0]).toContain("4");
  });

  it("does not describe maxExamsPerDay when it is 0", () => {
    expect(describeThresholds(settings({ maxExamsPerDay: 0 }))).toEqual([]);
  });

  it("describes an active minGapBetweenMoeds threshold", () => {
    const lines = describeThresholds(settings({ minGapBetweenMoeds: 7 }));
    expect(lines[0]).toContain("7");
  });

  it("describes an active maxExamsPerWindow threshold with its window size", () => {
    const lines = describeThresholds(settings({ maxExamsPerWindow: 2, windowDays: 5 }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("2");
    expect(lines[0]).toContain("5");
  });

  it("does not describe maxExamsPerWindow when windowDays is missing", () => {
    expect(describeThresholds(settings({ maxExamsPerWindow: 2, windowDays: null }))).toEqual([]);
  });

  it("describes enforceTimeSlots with the slot count, when both are set", () => {
    const lines = describeThresholds(settings({ enforceTimeSlots: true, timeSlots: ["09:00", "13:00"] }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("2");
  });

  it("does not describe enforceTimeSlots when it is off, even though timeSlots defaults non-empty", () => {
    // The load-bearing backward-compat guarantee: DEFAULT_SETTINGS.timeSlots
    // already ships non-empty for the cosmetic pass, so this must stay silent
    // unless the user explicitly opted in to enforcement.
    expect(describeThresholds(settings({ enforceTimeSlots: false }))).toEqual([]);
  });

  it("does not describe enforceTimeSlots when timeSlots is empty, even if enforceTimeSlots is on", () => {
    expect(describeThresholds(settings({ enforceTimeSlots: true, timeSlots: [] }))).toEqual([]);
  });

  it("describes requireRooms when true", () => {
    const lines = describeThresholds(settings({ requireRooms: true }));
    expect(lines).toHaveLength(1);
  });

  it("describes every active threshold together, in a fixed order", () => {
    const lines = describeThresholds(
      settings({
        minDaysBetweenObligatory: 3,
        maxElectiveCollisions: 1,
        requireRooms: true,
      })
    );
    expect(lines).toHaveLength(3);
  });
});

describe("hasAggregateThresholds", () => {
  it("is false when nothing aggregate is active", () => {
    expect(hasAggregateThresholds(settings())).toBe(false);
  });

  it("is true when maxElectiveCollisions is 0 (an active, if strict, threshold)", () => {
    expect(hasAggregateThresholds(settings({ maxElectiveCollisions: 0 }))).toBe(true);
  });

  it("is true when minObligatorySpan is set", () => {
    expect(hasAggregateThresholds(settings({ minObligatorySpan: 5 }))).toBe(true);
  });

  it("is true when maxExamsPerDay is set", () => {
    expect(hasAggregateThresholds(settings({ maxExamsPerDay: 2 }))).toBe(true);
  });

  it("is true when requireRooms is set", () => {
    expect(hasAggregateThresholds(settings({ requireRooms: true }))).toBe(true);
  });

  it("is true when maxExamsPerWindow is set", () => {
    expect(hasAggregateThresholds(settings({ maxExamsPerWindow: 2, windowDays: 3 }))).toBe(true);
  });

  it("is true when enforceTimeSlots is on with slots configured", () => {
    expect(hasAggregateThresholds(settings({ enforceTimeSlots: true, timeSlots: ["09:00"] }))).toBe(true);
  });

  it("is false when timeSlots is set but enforceTimeSlots is off (the plain default)", () => {
    expect(hasAggregateThresholds(settings())).toBe(false);
  });

  it("is false for a per-pair-only threshold like minDaysBetweenObligatory", () => {
    expect(hasAggregateThresholds(settings({ minDaysBetweenObligatory: 10 }))).toBe(false);
  });

  it("is false for a per-pair-only threshold like minGapBetweenMoeds", () => {
    expect(hasAggregateThresholds(settings({ minGapBetweenMoeds: 5 }))).toBe(false);
  });
});
