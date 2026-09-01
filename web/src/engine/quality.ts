/**
 * What an exam system is worth (requirement sections 2 and 3 of version 3.0).
 *
 * The five threshold requirements of section 2 and the five sorting criteria of
 * section 3 are two readings of the same five numbers, so both are taken from
 * one measurement of a system.
 *
 * A gap is counted in calendar days and includes Saturdays and holidays, as the
 * requirement says. Gaps are counted inside one study program, one study year
 * and one exam period, because that is the group of exams one student sits.
 */

import { ExamSystem, fromIso } from "./model";
import { CRITERION_DIRECTION, SortCriterion } from "./settings";

/** Stands for "there is no such pair", which is better than any real value. */
export const NO_PAIR = 1_000_000;

export interface SystemMetrics {
  min_days_between_obligatory: number;
  min_days_between_exams: number;
  average_days_between_exams: number;
  elective_collisions: number;
  worst_program_collisions: number;
  obligatory_span: number;
  max_exams_per_day: number;
}

function days(from: string, to: string): number {
  return Math.abs(Math.round((fromIso(to).getTime() - fromIso(from).getTime()) / 86400000));
}

export function measure(system: ExamSystem): SystemMetrics {
  const groups = new Map<string, { date: string; obligatory: boolean }[]>();
  const byDate = new Map<string, number>();
  const electives = new Map<string, Map<string, number>>();

  for (const scheduled of system) {
    const exam = scheduled.exam;
    byDate.set(scheduled.date, (byDate.get(scheduled.date) ?? 0) + 1);
    for (const slot of exam.slots) {
      const key = `${slot.key}|${exam.semester}|${exam.moed}`;
      const list = groups.get(key) ?? [];
      list.push({ date: scheduled.date, obligatory: slot.requirement === "Obligatory" });
      groups.set(key, list);
      if (slot.requirement === "Elective") {
        const dates = electives.get(slot.programNumber) ?? new Map<string, number>();
        dates.set(scheduled.date, (dates.get(scheduled.date) ?? 0) + 1);
        electives.set(slot.programNumber, dates);
      }
    }
  }

  let minObligatory = NO_PAIR;
  let minAny = NO_PAIR;
  let totalGap = 0;
  let pairs = 0;
  let span = NO_PAIR;

  for (const entries of groups.values()) {
    for (let first = 0; first < entries.length; first += 1) {
      for (let second = first + 1; second < entries.length; second += 1) {
        const gap = days(entries[first].date, entries[second].date);
        totalGap += gap;
        pairs += 1;
        if (gap < minAny) minAny = gap;
        if (entries[first].obligatory && entries[second].obligatory && gap < minObligatory) {
          minObligatory = gap;
        }
      }
    }
    const obligatory = entries.filter((entry) => entry.obligatory).map((entry) => entry.date);
    if (obligatory.length >= 2) {
      obligatory.sort();
      const groupSpan = days(obligatory[0], obligatory[obligatory.length - 1]);
      if (groupSpan < span) span = groupSpan;
    }
  }

  let collisions = 0;
  let worst = 0;
  for (const dates of electives.values()) {
    let inProgram = 0;
    for (const count of dates.values()) inProgram += (count * (count - 1)) / 2;
    collisions += inProgram;
    worst = Math.max(worst, inProgram);
  }

  return {
    min_days_between_obligatory: minObligatory,
    min_days_between_exams: minAny,
    average_days_between_exams: pairs ? totalGap / pairs : 0,
    elective_collisions: collisions,
    worst_program_collisions: worst,
    obligatory_span: span,
    max_exams_per_day: Math.max(0, ...byDate.values()),
  };
}

/** Do the counts over the whole system meet the active thresholds? */
export function passesThresholds(
  metrics: SystemMetrics,
  settings: {
    maxElectiveCollisions: number | null;
    minObligatorySpan: number | null;
    maxExamsPerDay: number | null;
  }
): boolean {
  if (
    settings.maxElectiveCollisions !== null &&
    metrics.worst_program_collisions > settings.maxElectiveCollisions
  ) {
    return false;
  }
  if (
    settings.minObligatorySpan &&
    metrics.obligatory_span < NO_PAIR &&
    metrics.obligatory_span < settings.minObligatorySpan
  ) {
    return false;
  }
  if (settings.maxExamsPerDay && metrics.max_exams_per_day > settings.maxExamsPerDay) {
    return false;
  }
  return true;
}

/**
 * Compare two systems by the criteria of section 3, first criterion first.
 *
 * Negative means `first` is the better system - a wider gap, fewer collisions,
 * a lighter day, depending on what each criterion in `CRITERION_DIRECTION`
 * actually calls "better" - so this is a genuine best-to-worst ordering, not
 * merely "largest raw number first" for every criterion alike.
 */
export function compareByCriteria(
  first: SystemMetrics,
  second: SystemMetrics,
  criteria: SortCriterion[]
): number {
  for (const criterion of criteria) {
    const difference = (second[criterion] - first[criterion]) * CRITERION_DIRECTION[criterion];
    if (difference !== 0) return difference;
  }
  return 0;
}

export function describeMetrics(metrics: SystemMetrics): string {
  const dash = (value: number) => (value >= NO_PAIR ? "-" : String(value));
  return (
    `smallest gap between obligatory exams: ${dash(metrics.min_days_between_obligatory)}, ` +
    `average gap: ${metrics.average_days_between_exams.toFixed(2)}, ` +
    `elective collisions: ${metrics.elective_collisions}, ` +
    `tightest span of obligatory exams: ${dash(metrics.obligatory_span)}, ` +
    `most exams on one day: ${metrics.max_exams_per_day}`
  );
}
