/**
 * Throwing an exam system away while it is still half built (version 3.0).
 *
 * The thresholds 2.3, 2.4, 2.5, 2.7 and the room capacity are counts over a
 * whole exam system, so they cannot become rules between two exams and cannot
 * enter the decomposition. Checking them only on a finished system does not
 * work: the generator walks the components like an odometer, so the first
 * exams stay where they are for a very long time, and a bad placement of an
 * early component would be carried by every one of the millions of systems
 * below it.
 *
 * The counts are therefore checked as the walk goes, on the exams placed so far.
 * `apply` and `unapply` are exact opposites, so the counters follow the walk up
 * and down without being rebuilt.
 *
 * Item 2 (opt-in time-of-day enforcement, `enforceTimeSlots`) lives here too,
 * on the same footing: a date's exams only ever grow during the walk, so the
 * greedy colouring in `timeSlots.ts` is re-run on the accumulated exams of a
 * touched date on every `apply`, and a date that cannot be coloured is
 * rejected the same way a broken count is.
 */

import { addDays, EnrollmentRoster, Exam, fromIso } from "./model";
import { Settings } from "./settings";
import { colorDay } from "./timeSlots";

/** Leftmost index a sorted-ascending `value` could be inserted at. */
function bisectLeft(dates: string[], value: string): number {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Rightmost index a sorted-ascending `value` could be inserted at. */
function bisectRight(dates: string[], value: string): number {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function daysBetween(from: string, to: string): number {
  return Math.round((fromIso(to).getTime() - fromIso(from).getTime()) / 86400000);
}

export class PartialThresholdChecker {
  private readonly students: number[];
  private readonly electivePrograms: string[][];
  /**
   * Every (program, year) an exam belongs to, for the window check below -
   * unlike `electivePrograms`, this holds obligatory and elective slots
   * alike, since a student's exam load is not lighter just because a course
   * happens to be elective for them.
   */
  private readonly windowSlots: string[][];
  private readonly groupsByDepth = new Map<number, number[][]>();

  private dateCount = new Map<string, number>();
  private dateStudents = new Map<string, number>();
  private electiveCount = new Map<string, number>();
  private collisions = new Map<string, number>();
  private windowDates = new Map<string, string[]>();
  private examsOnDate = new Map<string, Exam[]>();
  private currentDate = new Map<number, string>();
  private applied = new Map<number, [number, string][]>();
  private readonly colorEnforced: boolean;

  constructor(
    private readonly exams: Exam[],
    depthOfPosition: number[],
    private readonly settings: Settings,
    private readonly totalCapacity: number | null,
    private readonly roster?: EnrollmentRoster
  ) {
    this.colorEnforced = Boolean(settings.enforceTimeSlots && settings.timeSlots.length);
    this.students = exams.map((exam) => exam.course.students ?? settings.defaultStudents);
    this.electivePrograms = exams.map((exam) => [
      ...new Set(
        exam.slots.filter((slot) => slot.requirement === "Elective").map((slot) => slot.programNumber)
      ),
    ]);
    this.windowSlots = exams.map((exam) => exam.slots.map((slot) => slot.key));

    // The obligatory exams of a study year, by the component that ends it.
    const groups = new Map<string, number[]>();
    exams.forEach((exam, position) => {
      for (const slot of exam.slots) {
        if (slot.requirement !== "Obligatory") continue;
        const key = `${slot.key}|${exam.semester}|${exam.moed}`;
        groups.set(key, (groups.get(key) ?? []).concat(position));
      }
    });
    for (const positions of groups.values()) {
      if (positions.length < 2) continue; // a single exam has no span to speak of
      const lastDepth = Math.max(...positions.map((position) => depthOfPosition[position]));
      this.groupsByDepth.set(lastDepth, (this.groupsByDepth.get(lastDepth) ?? []).concat([positions]));
    }
  }

  /** False when nothing here has to be checked, so the walk stays plain. */
  get isNeeded(): boolean {
    return Boolean(
      this.settings.maxExamsPerDay ||
        this.settings.maxElectiveCollisions !== null ||
        this.settings.minObligatorySpan ||
        this.settings.maxExamsPerWindow ||
        this.colorEnforced ||
        this.totalCapacity !== null
    );
  }

  reset(): void {
    this.dateCount = new Map();
    this.dateStudents = new Map();
    this.electiveCount = new Map();
    this.collisions = new Map();
    this.windowDates = new Map();
    this.examsOnDate = new Map();
    this.currentDate = new Map();
    this.applied = new Map();
  }

  /** Add the exams of one component; false when a count is now broken. */
  apply(depth: number, pairs: [number, string][]): boolean {
    this.applied.set(depth, pairs);
    let ok = true;
    for (const [position, date] of pairs) {
      this.currentDate.set(position, date);
      const count = (this.dateCount.get(date) ?? 0) + 1;
      this.dateCount.set(date, count);
      if (this.settings.maxExamsPerDay && count > this.settings.maxExamsPerDay) ok = false;

      if (this.totalCapacity !== null) {
        const seats = (this.dateStudents.get(date) ?? 0) + this.students[position];
        this.dateStudents.set(date, seats);
        if (seats > this.totalCapacity) ok = false;
      }
      if (this.settings.maxElectiveCollisions !== null) {
        for (const program of this.electivePrograms[position]) {
          const key = `${program}|${date}`;
          const already = this.electiveCount.get(key) ?? 0;
          this.electiveCount.set(key, already + 1);
          const total = (this.collisions.get(program) ?? 0) + already;
          this.collisions.set(program, total);
          if (total > this.settings.maxElectiveCollisions) ok = false;
        }
      }
      if (this.settings.maxExamsPerWindow && this.settings.windowDays) {
        for (const key of this.windowSlots[position]) {
          const dates = this.windowDates.get(key) ?? [];
          dates.splice(bisectRight(dates, date), 0, date);
          this.windowDates.set(key, dates);
          if (this.windowViolates(dates, date)) ok = false;
        }
      }
      if (this.colorEnforced) {
        const exams = this.examsOnDate.get(date) ?? [];
        exams.push(this.exams[position]);
        this.examsOnDate.set(date, exams);
        if (colorDay(exams, this.settings.timeSlots.length, this.roster) === null) ok = false;
      }
    }
    if (ok && this.settings.minObligatorySpan) ok = this.spansAreWideEnough(depth);
    return ok;
  }

  /** Take the exams of one component back out of the counts. */
  unapply(depth: number): void {
    const pairs = this.applied.get(depth);
    if (!pairs) return;
    this.applied.delete(depth);
    for (let index = pairs.length - 1; index >= 0; index -= 1) {
      const [position, date] = pairs[index];
      this.dateCount.set(date, (this.dateCount.get(date) ?? 1) - 1);
      if (this.totalCapacity !== null) {
        this.dateStudents.set(date, (this.dateStudents.get(date) ?? 0) - this.students[position]);
      }
      if (this.settings.maxElectiveCollisions !== null) {
        const programs = this.electivePrograms[position];
        for (let other = programs.length - 1; other >= 0; other -= 1) {
          const key = `${programs[other]}|${date}`;
          const left = (this.electiveCount.get(key) ?? 1) - 1;
          this.electiveCount.set(key, left);
          this.collisions.set(programs[other], (this.collisions.get(programs[other]) ?? 0) - left);
        }
      }
      if (this.settings.maxExamsPerWindow && this.settings.windowDays) {
        const keys = this.windowSlots[position];
        for (let other = keys.length - 1; other >= 0; other -= 1) {
          const dates = this.windowDates.get(keys[other]);
          if (dates) dates.splice(bisectLeft(dates, date), 1);
        }
      }
      if (this.colorEnforced) {
        const exams = this.examsOnDate.get(date);
        if (exams) {
          const at = exams.indexOf(this.exams[position]);
          if (at !== -1) exams.splice(at, 1);
        }
      }
      this.currentDate.delete(position);
    }
  }

  /**
   * Requirement 2.7 - does any window that now holds `newDate` overflow?
   *
   * Every window that could contain `newDate` starts at one of the dates
   * already at or before it (in the same sorted list) and within
   * `windowDays - 1` of it - counts only ever grow during the walk, so a
   * window that does not contain the exam just placed could not have broken
   * here; it would already have been caught on an earlier `apply`.
   */
  private windowViolates(dates: string[], newDate: string): boolean {
    const windowDays = this.settings.windowDays!;
    const maxPerWindow = this.settings.maxExamsPerWindow!;
    let index = bisectLeft(dates, newDate);
    while (index >= 0 && daysBetween(dates[index], newDate) <= windowDays - 1) {
      const start = dates[index];
      const end = addDays(start, windowDays - 1);
      const first = bisectLeft(dates, start);
      const last = bisectRight(dates, end);
      if (last - first > maxPerWindow) return true;
      index -= 1;
    }
    return false;
  }

  /** Requirement 2.4, for the study years this component completes. */
  private spansAreWideEnough(depth: number): boolean {
    const groups = this.groupsByDepth.get(depth);
    if (!groups) return true;
    for (const positions of groups) {
      const dates = positions.map((position) => this.currentDate.get(position)!).sort();
      const span = Math.round(
        (fromIso(dates[dates.length - 1]).getTime() - fromIso(dates[0]).getTime()) / 86400000
      );
      if (span < this.settings.minObligatorySpan!) return false;
    }
    return true;
  }
}
