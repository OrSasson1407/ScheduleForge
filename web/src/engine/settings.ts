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
] as const;

export type SortCriterion = (typeof SORT_CRITERIA)[number];

export const SORT_CRITERION_TITLES: Record<SortCriterion, string> = {
  min_days_between_obligatory: "3.1 maximise the gap between two obligatory exams of a year",
  average_days_between_exams: "3.2 maximise the average gap between two exams of a year",
  elective_collisions: "3.3 minimise collisions between two elective courses of a program",
  obligatory_span: "3.4 maximise the span from the first to the last obligatory exam of a year",
  max_exams_per_day: "3.5 minimise the largest number of exams on one day",
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
};

/** All five criteria, best gap first - the default when nothing was chosen by hand. */
export const DEFAULT_SORT_CRITERIA: SortCriterion[] = [...SORT_CRITERIA];

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
  /** How long an exam takes when its own course does not say (minutes). */
  defaultExamMinutes: number;
}

export const DEFAULT_SETTINGS: Settings = {
  minDaysBetweenObligatory: null,
  minDaysBetweenAny: null,
  maxElectiveCollisions: null,
  minObligatorySpan: null,
  maxExamsPerDay: null,
  requireRooms: false,
  sortCriteria: DEFAULT_SORT_CRITERIA,
  maxCandidates: 1000,
  maxExamined: 200000,
  timeLimitSeconds: 10,
  defaultStudents: 30,
  timeSlots: ["09:00", "13:00", "16:00"],
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
    settings.requireRooms
  );
}
