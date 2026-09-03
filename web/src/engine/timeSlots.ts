/**
 * Assigning each exam of a date a time slot, so that no two exams that need
 * different times ever get the same one (item 2 - opt-in, off unless the
 * user turns on `enforceTimeSlots`; see `timeAssignment.ts` for why that flag
 * is separate from `timeSlots` itself).
 *
 * Two exams on the same date need different times when their (program, year)
 * groups intersect (the same grouping requirement 1.2's same-day rule already
 * reads, so no new dependency) or, when a real enrollment roster is loaded,
 * when they share a real student (defense in depth beyond the aggregate
 * grouping). A small per-day greedy graph colouring answers that, reused by
 * both `PartialThresholdChecker` during the search (a day that cannot be
 * coloured is rejected, a real backtrack) and the stateless finishing pass in
 * `timeAssignment.ts` (recomputed on demand, never cached, so a hand-edited
 * system is always coloured fresh rather than trusted from a stale cache).
 */

import { EnrollmentRoster, Exam, sharesStudents } from "./model";

/** Do `first` and `second` need different time slots on the same date? */
export function conflicts(first: Exam, second: Exam, roster?: EnrollmentRoster): boolean {
  if (first.slots.some((slot) => second.slots.some((other) => other.key === slot.key))) {
    return true;
  }
  if (roster) return sharesStudents(roster, first.course.number, second.course.number);
  return false;
}

/**
 * Exam id -> slot index for one date's exams, or null if `slotCount` is not
 * enough. Greedy, highest-degree-first, first-fit: not guaranteed optimal in
 * general graph colouring, but fast, deterministic, and exact for the small,
 * usually sparse conflict graphs one date's worth of exams forms.
 */
export function colorDay(
  exams: Exam[],
  slotCount: number,
  roster?: EnrollmentRoster
): Map<string, number> | null {
  if (exams.length <= 1) {
    return new Map(exams.map((exam) => [exam.id, 0]));
  }

  const adjacency: number[][] = exams.map(() => []);
  for (let i = 0; i < exams.length; i += 1) {
    for (let j = i + 1; j < exams.length; j += 1) {
      if (conflicts(exams[i], exams[j], roster)) {
        adjacency[i].push(j);
        adjacency[j].push(i);
      }
    }
  }

  const order = exams.map((_, i) => i).sort((a, b) => adjacency[b].length - adjacency[a].length);
  const colorOf = new Array<number>(exams.length).fill(-1);
  for (const i of order) {
    const used = new Set(adjacency[i].map((j) => colorOf[j]).filter((color) => color !== -1));
    let chosen = -1;
    for (let candidate = 0; candidate < slotCount; candidate += 1) {
      if (!used.has(candidate)) {
        chosen = candidate;
        break;
      }
    }
    if (chosen === -1) return null;
    colorOf[i] = chosen;
  }
  return new Map(exams.map((exam, i) => [exam.id, colorOf[i]]));
}
