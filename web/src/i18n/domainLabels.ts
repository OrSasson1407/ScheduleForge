/**
 * Translation keys for the two closed value sets of Appendix A - semester and
 * moed - kept apart from `engine/model.ts`'s own `SEMESTER_LABEL`/`MOED_LABEL`
 * on purpose: those English labels are still what the exported `.ics` files
 * and the saved `.txt` system (`engine/format.ts`, `engine/ics.ts`) print, and
 * a downloaded file is not part of the screens this pass covers - only what
 * is shown live, in the language the user picked, needs a translated label.
 */

import { Evaluation, Moed, Requirement, Semester } from "../engine/model";
import { TranslationKey } from "./types";

export const SEMESTER_KEY: Record<Semester, TranslationKey> = {
  FALL: "domain.semesterFall",
  SPRI: "domain.semesterSpring",
  SUMM: "domain.semesterSummer",
};

export const MOED_KEY: Record<Moed, TranslationKey> = {
  ALEPH: "domain.moedAleph",
  BET: "domain.moedBet",
  GIMEL: "domain.moedGimel",
};

export const REQUIREMENT_KEY: Record<Requirement, TranslationKey> = {
  Obligatory: "programs.requirementObligatory",
  Elective: "programs.requirementElective",
};

export const EVALUATION_KEY: Record<Evaluation, TranslationKey> = {
  Exam: "programs.evaluationExam",
  Project: "programs.evaluationProject",
  Attendance: "programs.evaluationAttendance",
};

/** January first, matching `Date#getMonth()` - used wherever a month abbreviation is shown. */
export const MONTH_KEYS: TranslationKey[] = [
  "calendar.months.jan",
  "calendar.months.feb",
  "calendar.months.mar",
  "calendar.months.apr",
  "calendar.months.may",
  "calendar.months.jun",
  "calendar.months.jul",
  "calendar.months.aug",
  "calendar.months.sep",
  "calendar.months.oct",
  "calendar.months.nov",
  "calendar.months.dec",
];

/** Sunday first, matching `Date#getDay()` - used wherever a weekday abbreviation is shown. */
export const WEEKDAY_KEYS: TranslationKey[] = [
  "calendar.weekdays.sun",
  "calendar.weekdays.mon",
  "calendar.weekdays.tue",
  "calendar.weekdays.wed",
  "calendar.weekdays.thu",
  "calendar.weekdays.fri",
  "calendar.weekdays.sat",
];
