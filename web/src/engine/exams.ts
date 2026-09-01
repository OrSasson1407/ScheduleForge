/**
 * Collecting the exams that have to be scheduled (requirement 1.2 of v1.0).
 *
 * Only courses whose evaluation is Exam are scheduled. A course produces one
 * exam per moed that the exam periods hold for the semester it is taught in,
 * because every moed is scheduled on its own.
 */

import {
  Course,
  Exam,
  ExamPeriod,
  MOED_ORDER,
  SEMESTER_ORDER,
  Semester,
  periodKey,
  slotKey,
} from "./model";
import { translate as t } from "../i18n/translate";

export class SchedulingDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchedulingDataError";
  }
}

export function periodsByKey(periods: ExamPeriod[]): Map<string, ExamPeriod> {
  return new Map(periods.map((period) => [periodKey(period.semester, period.moed), period]));
}

export function buildExams(
  courses: Course[],
  periods: ExamPeriod[],
  selectedPrograms: string[]
): Exam[] {
  const selected = new Set(selectedPrograms);
  const moadimBySemester = new Map<Semester, ExamPeriod[]>();
  for (const period of periods) {
    const list = moadimBySemester.get(period.semester) ?? [];
    list.push(period);
    moadimBySemester.set(period.semester, list);
  }
  for (const list of moadimBySemester.values()) {
    list.sort((a, b) => MOED_ORDER[a.moed] - MOED_ORDER[b.moed]);
  }

  const exams: Exam[] = [];
  const missing = new Set<string>();

  for (const course of courses) {
    if (course.evaluation !== "Exam") continue;
    const enrollments = course.enrollments.filter((e) => selected.has(e.programNumber));
    if (!enrollments.length) continue;

    const semesters: Semester[] = [];
    for (const enrollment of enrollments) {
      if (!semesters.includes(enrollment.semester)) semesters.push(enrollment.semester);
    }

    for (const semester of semesters) {
      const slots = enrollments
        .filter((enrollment) => enrollment.semester === semester)
        .map((enrollment) => ({
          key: slotKey(enrollment.programNumber, enrollment.year),
          programNumber: enrollment.programNumber,
          year: enrollment.year,
          requirement: enrollment.requirement,
        }));
      const inSemester = moadimBySemester.get(semester);
      if (!inSemester || !inSemester.length) {
        missing.add(semester);
        continue;
      }
      for (const period of inSemester) {
        exams.push({
          id: `${course.number}|${semester}|${period.moed}`,
          course,
          semester,
          moed: period.moed,
          slots,
        });
      }
    }
  }

  if (missing.size) {
    throw new SchedulingDataError(
      t("errors.noPeriodForSemester", { semesters: [...missing].sort().join(", ") })
    );
  }

  exams.sort(
    (a, b) =>
      SEMESTER_ORDER[a.semester] - SEMESTER_ORDER[b.semester] ||
      MOED_ORDER[a.moed] - MOED_ORDER[b.moed] ||
      a.course.number.localeCompare(b.course.number)
  );
  return exams;
}
