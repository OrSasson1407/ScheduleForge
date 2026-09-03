/**
 * The changes the input screen makes to the data it holds.
 *
 * Loading a file either replaces the data or adds to it (requirements 2.1.2 and
 * 2.1.3), and the exam periods can be edited day by day and at their ends
 * (requirements 2.4.2 and 2.4.3).
 */

import { Course, EnrollmentRoster, ExamPeriod, ExcludedDates, FacultyRules, Room, addDays, isExcluded, periodKey } from "./model";
import { translate as t } from "../i18n/translate";

/** Requirement 2.1.3 - add records without erasing the ones already loaded. */
export function mergeCourses(existing: Course[], incoming: Course[]): Course[] {
  const merged = new Map(existing.map((course) => [course.number, course]));
  for (const course of incoming) merged.set(course.number, course);
  return [...merged.values()];
}

export function mergeRooms(existing: Room[], incoming: Room[]): Room[] {
  const merged = new Map(existing.map((room) => [room.name, room]));
  for (const room of incoming) merged.set(room.name, room);
  return [...merged.values()];
}

export function mergeFaculty(existing: FacultyRules, incoming: FacultyRules): FacultyRules {
  return { ...existing, ...incoming };
}

export function mergeGlobalExcluded(existing: ExcludedDates[], incoming: ExcludedDates[]): ExcludedDates[] {
  return [...existing, ...incoming];
}

export function mergeEnrollment(existing: EnrollmentRoster, incoming: EnrollmentRoster): EnrollmentRoster {
  const merged: EnrollmentRoster = { ...existing };
  for (const [course, students] of Object.entries(incoming)) {
    const combined = [...(merged[course] ?? [])];
    for (const student of students) if (!combined.includes(student)) combined.push(student);
    merged[course] = combined;
  }
  return merged;
}

export function mergePeriods(existing: ExamPeriod[], incoming: ExamPeriod[]): ExamPeriod[] {
  const merged = new Map(
    existing.map((period) => [periodKey(period.semester, period.moed), period])
  );
  for (const period of incoming) merged.set(periodKey(period.semester, period.moed), period);
  return [...merged.values()];
}

/**
 * Requirement 2.4.2 - take a day out of the exam calendar, or put it back.
 *
 * Putting back a day that a whole excluded range covers splits that range, so
 * the rest of the range stays excluded.
 */
export function toggleExcludedDay(period: ExamPeriod, iso: string): ExamPeriod {
  if (!isExcluded(period, iso)) {
    return {
      ...period,
      excluded: [...period.excluded, { start: iso, end: iso, comment: t("periods.excludedByUser") }],
    };
  }
  const excluded = period.excluded.flatMap((rule) => {
    if (iso < rule.start || iso > rule.end) return [rule];
    const parts = [];
    if (rule.start < iso) parts.push({ ...rule, end: addDays(iso, -1) });
    if (iso < rule.end) parts.push({ ...rule, start: addDays(iso, 1) });
    return parts;
  });
  return { ...period, excluded };
}

/**
 * Requirement 2.4.3 - move the start or the end of an exam period.
 *
 * An excluded range only means something inside the period it belongs to, so
 * moving the ends clips every excluded range to the new dates along with
 * them: a range now entirely outside the period is dropped, one that is only
 * partly outside is trimmed to the part that is still inside. Without this, a
 * range shrunk past an old exclusion would leave that exclusion behind,
 * invisible on the calendar (which only ever shows a period's own current
 * dates) but still sitting in the data - free to land inside a *different*
 * period later, and exclude a date there nobody meant to touch.
 */
export function setPeriodDates(
  period: ExamPeriod,
  startDate: string,
  endDate: string
): ExamPeriod {
  const excluded = period.excluded.flatMap((rule) => {
    const start = rule.start < startDate ? startDate : rule.start;
    const end = rule.end > endDate ? endDate : rule.end;
    return start > end ? [] : [{ ...rule, start, end }];
  });
  return { ...period, startDate, endDate, excluded };
}

export function replacePeriod(periods: ExamPeriod[], updated: ExamPeriod): ExamPeriod[] {
  const key = periodKey(updated.semester, updated.moed);
  return periods.map((period) =>
    periodKey(period.semester, period.moed) === key ? updated : period
  );
}
