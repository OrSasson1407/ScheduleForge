/**
 * Telling students what changed, without this software sending anything.
 *
 * There is no student email address anywhere in the data this software reads
 * - a courses file names an instructor, never a class roster - and actually
 * sending mail on someone's behalf needs their explicit say-so for every
 * message, not a standing permission a feature can grant itself. So this
 * composes what a notification would say and hands it to the browser's own
 * `mailto:` handler, which opens the user's own mail client with a draft
 * already written; sending it is a deliberate action the user takes there,
 * in their own name, the same as writing the email by hand would have been.
 */

import { StudyProgram, programName } from "./catalog";
import { ExamSystem, toDisplayDate } from "./model";
import { translate as t } from "../i18n/translate";

export interface ScheduleChange {
  programNumber: string;
  year: number;
  courseNumber: string;
  courseName: string;
  before: string | null; // ISO date, or null when the exam is new to this program/year
  after: string;
}

/** Every exam whose date differs between two systems, for the given programs. */
export function diffSystems(
  before: ExamSystem | null,
  after: ExamSystem,
  programNumbers: string[]
): ScheduleChange[] {
  const beforeDates = new Map<string, string>();
  for (const scheduled of before ?? []) beforeDates.set(scheduled.exam.id, scheduled.date);

  const changes: ScheduleChange[] = [];
  const seen = new Set<string>();
  for (const scheduled of after) {
    const priorDate = beforeDates.get(scheduled.exam.id) ?? null;
    if (priorDate === scheduled.date) continue;
    for (const slot of scheduled.exam.slots) {
      if (!programNumbers.includes(slot.programNumber)) continue;
      const key = `${scheduled.exam.id}|${slot.programNumber}|${slot.year}`;
      if (seen.has(key)) continue;
      seen.add(key);
      changes.push({
        programNumber: slot.programNumber,
        year: slot.year,
        courseNumber: scheduled.exam.course.number,
        courseName: scheduled.exam.course.name,
        before: priorDate,
        after: scheduled.date,
      });
    }
  }
  return changes.sort(
    (a, b) => a.programNumber.localeCompare(b.programNumber) || a.year - b.year || a.courseNumber.localeCompare(b.courseNumber)
  );
}

export interface NotificationDraft {
  programNumber: string;
  year: number;
  subject: string;
  body: string;
  mailtoUrl: string;
}

/** One draft per study program and year that has a change to report. */
export function draftsFor(changes: ScheduleChange[], programs: StudyProgram[]): NotificationDraft[] {
  const groups = new Map<string, ScheduleChange[]>();
  for (const change of changes) {
    const key = `${change.programNumber}|${change.year}`;
    const list = groups.get(key) ?? [];
    list.push(change);
    groups.set(key, list);
  }

  return [...groups.entries()].map(([key, groupChanges]) => {
    const [programNumber, yearText] = key.split("|");
    const year = Number(yearText);
    const name = programName(programs, programNumber);
    const subject = t("notify.subject", { name, year });
    const lines = [
      t("notify.intro", { name, year }),
      "",
      ...groupChanges.map((change) =>
        change.before
          ? t("notify.changeMoved", {
              number: change.courseNumber,
              name: change.courseName,
              before: toDisplayDate(change.before),
              after: toDisplayDate(change.after),
            })
          : t("notify.changeNew", {
              number: change.courseNumber,
              name: change.courseName,
              after: toDisplayDate(change.after),
            })
      ),
      "",
      t("notify.outro"),
    ];
    const body = lines.join("\n");
    const mailtoUrl =
      `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return { programNumber, year, subject, body, mailtoUrl };
  });
}
