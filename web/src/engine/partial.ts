/**
 * Throwing an exam system away while it is still half built (version 3.0).
 *
 * The thresholds 2.3, 2.4, 2.5 and the room capacity are counts over a whole
 * exam system, so they cannot become rules between two exams and cannot enter
 * the decomposition. Checking them only on a finished system does not work: the
 * generator walks the components like an odometer, so the first exams stay
 * where they are for a very long time, and a bad placement of an early
 * component would be carried by every one of the millions of systems below it.
 *
 * The counts are therefore checked as the walk goes, on the exams placed so far.
 * `apply` and `unapply` are exact opposites, so the counters follow the walk up
 * and down without being rebuilt.
 */

import { Exam, fromIso } from "./model";
import { Settings } from "./settings";

export class PartialThresholdChecker {
  private readonly students: number[];
  private readonly electivePrograms: string[][];
  private readonly groupsByDepth = new Map<number, number[][]>();

  private dateCount = new Map<string, number>();
  private dateStudents = new Map<string, number>();
  private electiveCount = new Map<string, number>();
  private collisions = new Map<string, number>();
  private currentDate = new Map<number, string>();
  private applied = new Map<number, [number, string][]>();

  constructor(
    exams: Exam[],
    depthOfPosition: number[],
    private readonly settings: Settings,
    private readonly totalCapacity: number | null
  ) {
    this.students = exams.map((exam) => exam.course.students ?? settings.defaultStudents);
    this.electivePrograms = exams.map((exam) => [
      ...new Set(
        exam.slots.filter((slot) => slot.requirement === "Elective").map((slot) => slot.programNumber)
      ),
    ]);

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
        this.totalCapacity !== null
    );
  }

  reset(): void {
    this.dateCount = new Map();
    this.dateStudents = new Map();
    this.electiveCount = new Map();
    this.collisions = new Map();
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
      this.currentDate.delete(position);
    }
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
