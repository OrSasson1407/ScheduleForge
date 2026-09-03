/**
 * The settings of a run (version 3.0, requirement sections 2 and 3).
 *
 * A threshold of section 2 disqualifies an exam system: a system that does not
 * meet an active threshold is not produced at all. Every threshold is off -
 * null - until the user turns it on and gives it its own k.
 *
 * A criterion of section 3 sorts the systems that passed the thresholds. The
 * user names several of them, and the order they are named in is the order of
 * preference: the first decides, the second breaks its ties, and so on.
 */

import { translate } from "../i18n/translate";

export const SORT_CRITERIA = [
  "min_days_between_obligatory", // 3.1
  "average_days_between_exams", // 3.2
  "elective_collisions", // 3.3
  "obligatory_span", // 3.4
  "max_exams_per_day", // 3.5
  "min_gap_between_moeds", // 3.6
  "worst_window_count", // 3.7
] as const;

export type SortCriterion = (typeof SORT_CRITERIA)[number];

export const SORT_CRITERION_TITLES: Record<SortCriterion, string> = {
  min_days_between_obligatory: "3.1 maximise the gap between two obligatory exams of a year",
  average_days_between_exams: "3.2 maximise the average gap between two exams of a year",
  elective_collisions: "3.3 minimise collisions between two elective courses of a program",
  obligatory_span: "3.4 maximise the span from the first to the last obligatory exam of a year",
  max_exams_per_day: "3.5 minimise the largest number of exams on one day",
  min_gap_between_moeds: "3.6 maximise the gap between moed Aleph and moed Bet of the same course",
  worst_window_count: "3.7 minimise the most exams of a program and year in any date window",
};

/**
 * Which direction of a criterion counts as "better" (section 3).
 *
 * +1 - a larger value is better (a wider gap, a wider span);
 * -1 - a smaller value is better (fewer collisions, a lighter day).
 *
 * Every criterion sorts by this, most important criterion first, so that the
 * exam system genuinely most preferred by the criteria the user picked is the
 * one shown first - not merely the first one the search happened to find that
 * passed the threshold requirements.
 */
export const CRITERION_DIRECTION: Record<SortCriterion, 1 | -1> = {
  min_days_between_obligatory: 1,
  average_days_between_exams: 1,
  elective_collisions: -1,
  obligatory_span: 1,
  max_exams_per_day: -1,
  min_gap_between_moeds: 1,
  worst_window_count: -1,
};

/**
 * The five criteria of version 3.0, best gap first - the default when nothing
 * was chosen by hand. `min_gap_between_moeds` (3.6) and `worst_window_count`
 * (3.7) are deliberately left out: both are new, off-by-default features, and
 * adding either to every run's sort order by default would change
 * tie-breaking for runs that never asked for it.
 */
const NEW_OPT_IN_CRITERIA: SortCriterion[] = ["min_gap_between_moeds", "worst_window_count"];
export const DEFAULT_SORT_CRITERIA: SortCriterion[] = SORT_CRITERIA.filter(
  (criterion) => !NEW_OPT_IN_CRITERIA.includes(criterion)
);

export interface Settings {
  /** 2.1 days between two obligatory exams of the same program and year. */
  minDaysBetweenObligatory: number | null;
  /** 2.2 days between two exams of the same program and year. */
  minDaysBetweenAny: number | null;
  /** 2.3 collisions between two elective courses, per program. */
  maxElectiveCollisions: number | null;
  /** 2.4 days from the first to the last obligatory exam of a year. */
  minObligatorySpan: number | null;
  /** 2.5 exams on one day. */
  maxExamsPerDay: number | null;
  /** 2.6 days between moed Aleph and moed Bet of the same course. */
  minGapBetweenMoeds: number | null;
  /**
   * 2.7 exams of one program and year inside any `windowDays`-day span.
   * Both null, or both set - see `describeThresholds` and the settings screen.
   */
  maxExamsPerWindow: number | null;
  windowDays: number | null;
  /** A system whose exams cannot all be seated is disqualified. */
  requireRooms: boolean;
  /** Section 3, most important criterion first. */
  sortCriteria: SortCriterion[];
  maxCandidates: number;
  maxExamined: number;
  timeLimitSeconds: number;
  defaultStudents: number;
  /**
   * The times of day an exam may start, "HH:MM", earliest first. Dates are
   * what the engine actually schedules (requirement 1.2 checks conflicts by
   * date alone); a time is assigned afterwards, for display and export only,
   * from whichever of these slots keeps two exams that share a room from
   * overlapping (`engine/timeAssignment.ts`). Empty turns time assignment off.
   */
  timeSlots: string[];
  /**
   * Item 2 - turns `timeSlots` from the cosmetic, post-hoc use above into a
   * real constraint the search itself enforces: two exams that need
   * different times (same program/year, or - with a roster loaded - a real
   * shared student) may never land on the same date at all if `timeSlots`
   * cannot fit them apart. A **separate** flag from `timeSlots` on purpose -
   * `timeSlots` already ships non-empty by default for the cosmetic pass
   * every existing user already gets; gating hard enforcement on "timeSlots
   * is non-empty" would have silently turned on a brand-new hard constraint,
   * and its performance cost, for everyone the moment this shipped. Off by
   * default, so nothing changes until a user opts in.
   */
  enforceTimeSlots: boolean;
  /** How long an exam takes when its own course does not say (minutes). */
  defaultExamMinutes: number;
}

export const DEFAULT_SETTINGS: Settings = {
  minDaysBetweenObligatory: null,
  minDaysBetweenAny: null,
  maxElectiveCollisions: null,
  minObligatorySpan: null,
  maxExamsPerDay: null,
  minGapBetweenMoeds: null,
  maxExamsPerWindow: null,
  windowDays: null,
  requireRooms: false,
  sortCriteria: DEFAULT_SORT_CRITERIA,
  maxCandidates: 1000,
  maxExamined: 200000,
  timeLimitSeconds: 10,
  defaultStudents: 30,
  timeSlots: ["09:00", "13:00", "16:00"],
  enforceTimeSlots: false,
  defaultExamMinutes: 120,
};

export function describeThresholds(settings: Settings): string[] {
  const lines: string[] = [];
  if (settings.minDaysBetweenObligatory) {
    lines.push(translate("thresholds.minObligatory", { k: settings.minDaysBetweenObligatory }));
  }
  if (settings.minDaysBetweenAny) {
    lines.push(translate("thresholds.minAny", { k: settings.minDaysBetweenAny }));
  }
  if (settings.maxElectiveCollisions !== null) {
    lines.push(translate("thresholds.maxCollisions", { k: settings.maxElectiveCollisions }));
  }
  if (settings.minObligatorySpan) {
    lines.push(translate("thresholds.minSpan", { k: settings.minObligatorySpan }));
  }
  if (settings.maxExamsPerDay) {
    lines.push(translate("thresholds.maxPerDay", { k: settings.maxExamsPerDay }));
  }
  if (settings.minGapBetweenMoeds) {
    lines.push(translate("thresholds.minGapBetweenMoeds", { k: settings.minGapBetweenMoeds }));
  }
  if (settings.maxExamsPerWindow && settings.windowDays) {
    lines.push(
      translate("thresholds.maxPerWindow", { k: settings.maxExamsPerWindow, days: settings.windowDays })
    );
  }
  if (settings.enforceTimeSlots && settings.timeSlots.length) {
    lines.push(translate("thresholds.enforceTimeSlots", { k: settings.timeSlots.length }));
  }
  if (settings.requireRooms) {
    lines.push(translate("thresholds.requireRooms"));
  }
  return lines;
}

/** True when nothing has to be counted over a whole system. */
export function hasAggregateThresholds(settings: Settings): boolean {
  return (
    settings.maxElectiveCollisions !== null ||
    Boolean(settings.minObligatorySpan) ||
    Boolean(settings.maxExamsPerDay) ||
    Boolean(settings.maxExamsPerWindow) ||
    (settings.enforceTimeSlots && Boolean(settings.timeSlots.length)) ||
    settings.requireRooms
  );
}
