/**
 * Checking that manually entered data is actually usable before the search
 * ever sees it.
 *
 * A file loaded through a parser (`parsers.ts`, `csvImport.ts`) can never
 * reach `data.courses` / `data.rooms` / `data.faculty` in a broken shape - the
 * parser throws first, and nothing is stored. The live tables
 * (`CoursesTable`, `RoomsTable`, `FacultyTable`) have no such gate: they write
 * every keystroke straight to that same state, on purpose, so typing stays
 * responsive - which means a row can sit there half-finished (a course
 * number that is not yet 5 digits, a capacity of zero) for as long as the
 * user is still typing it. This module is what tells the two apart: it finds
 * every row that is not merely "still being typed" but plainly wrong, so
 * `App.tsx` can point at each one and refuse to search until they are fixed,
 * the same way a file with one bad line already refuses to load at all.
 */

import { Course, ExamPeriod, FacultyRules, Room } from "./model";
import { MOED_KEY, SEMESTER_KEY } from "../i18n/domainLabels";
import { translate as t } from "../i18n/translate";

function isFiveDigits(value: string): boolean {
  return /^\d{5}$/.test(value);
}

export function courseProblems(courses: Course[]): string[] {
  const problems: string[] = [];
  courses.forEach((course, index) => {
    const position = index + 1;
    if (!isFiveDigits(course.number)) {
      problems.push(t("validation.courseNumber", { position }));
    }
    if (!course.name.trim()) {
      problems.push(t("validation.courseName", { position }));
    }
    if (!course.instructor.trim()) {
      problems.push(t("validation.courseInstructor", { position }));
    }
    if (!course.enrollments.length) {
      problems.push(t("validation.courseNoPrograms", { position }));
    }
    course.enrollments.forEach((enrollment) => {
      if (!isFiveDigits(enrollment.programNumber)) {
        problems.push(t("validation.enrollmentProgram", { position }));
      }
    });
    if (course.students !== undefined && (!Number.isInteger(course.students) || course.students < 1)) {
      problems.push(t("validation.courseStudents", { position }));
    }
  });
  return problems;
}

export function roomProblems(rooms: Room[]): string[] {
  const problems: string[] = [];
  rooms.forEach((room, index) => {
    const position = index + 1;
    if (!room.name.trim()) {
      problems.push(t("validation.roomName", { position }));
    }
    if (!Number.isInteger(room.capacity) || room.capacity < 1) {
      problems.push(t("validation.roomCapacity", { position }));
    }
  });
  return problems;
}

export function facultyProblems(faculty: FacultyRules): string[] {
  const problems: string[] = [];
  Object.entries(faculty).forEach(([instructor, excluded], index) => {
    const position = index + 1;
    if (!instructor.trim()) {
      problems.push(t("validation.facultyName", { position }));
    }
    excluded.forEach((rule) => {
      if (rule.start > rule.end) {
        problems.push(t("validation.facultyDateOrder", { position }));
      }
    });
  });
  return problems;
}

/**
 * A course whose exam needs more seats than every loaded room could ever
 * provide *combined* - the one room shortfall that is true no matter which
 * date the exam lands on, or which rooms are free that day, so it can be
 * caught here instead of waiting for a search to fail at seating it later.
 * A course that only sometimes fails to be seated, because the day it lands
 * on happens to be crowded, is a different, schedule-dependent problem, and
 * is reported where it is actually known: the room allocation of the system
 * on screen (`OutputScreen`'s Rooms tab), not here.
 */
export function roomCapacityProblems(courses: Course[], rooms: Room[], defaultStudents: number): string[] {
  if (!rooms.length) return [];
  const totalCapacity = rooms.reduce((sum, room) => sum + room.capacity, 0);
  const problems: string[] = [];
  courses.forEach((course, index) => {
    if (course.evaluation !== "Exam") return; // only an exam needs a seat
    const students = course.students ?? defaultStudents;
    if (students > totalCapacity) {
      problems.push(
        t("validation.notEnoughSeats", { position: index + 1, students, capacity: totalCapacity })
      );
    }
  });
  return problems;
}

function periodLabel(period: ExamPeriod): string {
  return `${t(SEMESTER_KEY[period.semester])} · ${t(MOED_KEY[period.moed])}`;
}

/**
 * Two periods whose dates overlap would let the same calendar date belong to
 * both at once - not something a parsed file could ever produce (each period
 * is its own record, and nothing there cross-checks another one), but the
 * live table edits each period's dates on its own too, so nothing stops two
 * of them from being dragged on top of each other by hand.
 */
export function periodProblems(periods: ExamPeriod[]): string[] {
  const problems: string[] = [];
  for (let i = 0; i < periods.length; i += 1) {
    for (let j = i + 1; j < periods.length; j += 1) {
      const a = periods[i];
      const b = periods[j];
      if (a.startDate <= b.endDate && b.startDate <= a.endDate) {
        problems.push(t("validation.periodsOverlap", { a: periodLabel(a), b: periodLabel(b) }));
      }
    }
  }
  return problems;
}

/**
 * Two periods that each exclude the same calendar date - a day the campus is
 * shut, say, marked once while editing one period and, separately, once more
 * while editing another. Their own start/end ranges can overlap too far
 * apart to be caught by `periodProblems`, and still leave this: moving a
 * period's dates (`setPeriodDates`, in `edits.ts`) never prunes exclusions
 * that no longer fall inside the new range, so a stale one can end up
 * pointing at a date that is now, or always was, a different period's.
 */
export function excludedDateProblems(periods: ExamPeriod[]): string[] {
  const problems: string[] = [];
  for (let i = 0; i < periods.length; i += 1) {
    for (let j = i + 1; j < periods.length; j += 1) {
      const a = periods[i];
      const b = periods[j];
      const collide = a.excluded.some((ruleA) =>
        b.excluded.some((ruleB) => ruleA.start <= ruleB.end && ruleB.start <= ruleA.end)
      );
      if (collide) {
        problems.push(t("validation.excludedOverlap", { a: periodLabel(a), b: periodLabel(b) }));
      }
    }
  }
  return problems;
}

/** Every reason `courses`, `periods`, `rooms` and `faculty`, as they stand, are not ready to search with. */
export function dataProblems(
  courses: Course[],
  periods: ExamPeriod[],
  rooms: Room[],
  faculty: FacultyRules,
  defaultStudents: number
): string[] {
  return [
    ...courseProblems(courses),
    ...periodProblems(periods),
    ...excludedDateProblems(periods),
    ...roomProblems(rooms),
    ...roomCapacityProblems(courses, rooms, defaultStudents),
    ...facultyProblems(faculty),
  ];
}
