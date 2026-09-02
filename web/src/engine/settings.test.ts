import { describe, expect, it } from "vitest";
import {
  CRITERION_DIRECTION,
  DEFAULT_SETTINGS,
  DEFAULT_SORT_CRITERIA,
  SORT_CRITERIA,
  SORT_CRITERION_TITLES,
  Settings,
  describeThresholds,
  hasAggregateThresholds,
} from "./settings";

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("DEFAULT_SETTINGS", () => {
  it("has every threshold off by default", () => {
    expect(DEFAULT_SETTINGS.minDaysBetweenObligatory).toBeNull();
    expect(DEFAULT_SETTINGS.minDaysBetweenAny).toBeNull();
    expect(DEFAULT_SETTINGS.maxElectiveCollisions).toBeNull();
    expect(DEFAULT_SETTINGS.minObligatorySpan).toBeNull();
    expect(DEFAULT_SETTINGS.maxExamsPerDay).toBeNull();
    expect(DEFAULT_SETTINGS.requireRooms).toBe(false);
  });

  it("defaults sortCriteria to every criterion, in the declared order", () => {
    expect(DEFAULT_SETTINGS.sortCriteria).toEqual(SORT_CRITERIA);
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

  it("DEFAULT_SORT_CRITERIA is a copy, not the same array reference as SORT_CRITERIA", () => {
    expect(DEFAULT_SORT_CRITERIA).not.toBe(SORT_CRITERIA);
    expect(DEFAULT_SORT_CRITERIA).toEqual(SORT_CRITERIA);
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

  it("is false for a per-pair-only threshold like minDaysBetweenObligatory", () => {
    expect(hasAggregateThresholds(settings({ minDaysBetweenObligatory: 10 }))).toBe(false);
  });
});
