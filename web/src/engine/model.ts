/**
 * The objects of the problem domain, and the value sets of Appendix A.
 *
 * Dates are held as ISO strings ("2026-01-29") so that they compare, sort and
 * survive the internal storage as they are; they are shown as DD-MM-YYYY.
 */

export const SEMESTERS = ["FALL", "SPRI", "SUMM"] as const;
export type Semester = (typeof SEMESTERS)[number];

export const MOADIM = ["ALEPH", "BET", "GIMEL"] as const;
export type Moed = (typeof MOADIM)[number];

export type Requirement = "Obligatory" | "Elective";
export type Evaluation = "Exam" | "Project" | "Attendance";

export const SEMESTER_LABEL: Record<Semester, string> = {
  FALL: "FALL",
  SPRI: "SPRING",
  SUMM: "SUMMER",
};

export const MOED_LABEL: Record<Moed, string> = {
  ALEPH: "Aleph",
  BET: "Bet",
  GIMEL: "Gimel",
};

export const SEMESTER_ORDER: Record<Semester, number> = { FALL: 0, SPRI: 1, SUMM: 2 };
export const MOED_ORDER: Record<Moed, number> = { ALEPH: 0, BET: 1, GIMEL: 2 };

export interface ProgramEnrollment {
  programNumber: string;
  year: number;
  semester: Semester;
  requirement: Requirement;
}

export interface Course {
  number: string;
  name: string;
  instructor: string;
  enrollments: ProgramEnrollment[];
  evaluation: Evaluation;
  /** How many students the exam has to seat (version 3.0, optional). */
  students?: number;
}

/** One room an exam can be held in: how many seats it has, and where. */
export interface Room {
  name: string;
  capacity: number;
  location: string;
}

/** The dates every instructor is not available on (version 3.0). */
export type FacultyRules = Record<string, ExcludedDates[]>;

export function isInstructorAvailable(
  rules: FacultyRules,
  instructor: string,
  iso: string
): boolean {
  const blocked = rules[instructor];
  if (!blocked) return true;
  return !blocked.some((rule) => rule.start <= iso && iso <= rule.end);
}

/** A single date, or a range of dates, on which no exam may take place. */
export interface ExcludedDates {
  start: string;
  end: string;
  comment: string;
}

/** The dates available for the exams of one (semester, moed) pair. */
export interface ExamPeriod {
  semester: Semester;
  moed: Moed;
  startDate: string;
  endDate: string;
  excluded: ExcludedDates[];
}

/** One exam to schedule: a course in one semester and one moed. */
export interface Exam {
  id: string;
  course: Course;
  semester: Semester;
  moed: Moed;
  /** Every (program, year) of the selected programs, and the requirement there. */
  slots: { key: string; programNumber: string; year: number; requirement: Requirement }[];
}

export interface ScheduledExam {
  exam: Exam;
  date: string;
}

export type ExamSystem = ScheduledExam[];

export function periodKey(semester: Semester, moed: Moed): string {
  return `${semester}|${moed}`;
}

export function slotKey(programNumber: string, year: number): string {
  return `${programNumber}|${year}`;
}

// --- dates ----------------------------------------------------------------

export function toIso(day: Date): string {
  const month = `${day.getMonth() + 1}`.padStart(2, "0");
  const date = `${day.getDate()}`.padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
}

export function fromIso(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** "2026-01-29" -> "29-01-2026", the format of the data files. */
export function toDisplayDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}-${month}-${year}`;
}

/** "29-01-2026" -> "2026-01-29"; null when the text is not a legal date. */
export function fromDisplayDate(text: string): string | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const date = fromIso(iso);
  date.setDate(date.getDate() + days);
  return toIso(date);
}

/** Every date from `start` to `end`, both included. */
export function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  let day = start;
  while (day <= end) {
    dates.push(day);
    day = addDays(day, 1);
  }
  return dates;
}

export function isExcluded(period: ExamPeriod, iso: string): boolean {
  return period.excluded.some((rule) => rule.start <= iso && iso <= rule.end);
}

/** The dates of a period on which an exam may be scheduled. */
export function availableDates(period: ExamPeriod): string[] {
  return datesBetween(period.startDate, period.endDate).filter(
    (iso) => !isExcluded(period, iso)
  );
}
