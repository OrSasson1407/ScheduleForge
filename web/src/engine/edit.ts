/**
 * Manual editing of a chosen exam system: dragging one exam to another date.
 *
 * The output screen shows one exam system that the search already proved
 * conflict free and passing every threshold. Dragging an exam edits that one
 * system directly, so every candidate date is checked against the very same
 * rules the search used - the pairwise rule of version 1.0, the pairwise
 * thresholds 2.1/2.2, the aggregate thresholds 2.3/2.4/2.5, room capacity and
 * staff availability - and only the dates that keep the system legal light up.
 *
 * Nothing here touches the search: it re-evaluates one exam against a fixed
 * system, which costs one pass over the exams per candidate date - fast enough
 * to run on every drag start.
 */

import { requiredGap } from "./decomposition";
import {
  Exam,
  ExamPeriod,
  ExamSystem,
  FacultyRules,
  availableDates,
  isInstructorAvailable,
  periodKey,
} from "./model";
import { measure, passesThresholds } from "./quality";
import { RoomAllocator } from "./rooms";
import { Settings } from "./settings";

function dayDistance(a: string, b: string): number {
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
}

/** Exam `exam` moved to `date`, everything else in `system` kept as it is. */
export function withExamOn(system: ExamSystem, exam: Exam, date: string): ExamSystem {
  return system.map((scheduled) => (scheduled.exam === exam ? { ...scheduled, date } : scheduled));
}

/**
 * The same move, addressed by `Exam.id` instead of the object itself.
 *
 * A message from the collaboration server only carries the id - it never saw
 * the `Exam` object - so a remote move is applied through this instead of
 * `withExamOn`.
 */
export function withExamById(system: ExamSystem, examId: string, date: string): ExamSystem {
  return system.map((scheduled) => (scheduled.exam.id === examId ? { ...scheduled, date } : scheduled));
}

export interface LegalityInput {
  exam: Exam;
  system: ExamSystem;
  periods: ExamPeriod[];
  settings: Settings;
  faculty?: FacultyRules;
  roomAllocator?: RoomAllocator | null;
}

/** Every date `exam` may legally be moved to, and why the others are blocked. */
export function legalDatesFor(input: LegalityInput): Set<string> {
  const { exam, system, periods, settings, faculty, roomAllocator } = input;
  const period = periods.find((p) => periodKey(p.semester, p.moed) === periodKey(exam.semester, exam.moed));
  if (!period) return new Set();

  let candidates = availableDates(period);
  if (faculty) {
    candidates = candidates.filter((iso) => isInstructorAvailable(faculty, exam.course.instructor, iso));
  }

  const others = system.filter((scheduled) => scheduled.exam !== exam);
  const legal = new Set<string>();

  for (const date of candidates) {
    if (!satisfiesPairwiseRules(exam, date, others, settings)) continue;

    const hypothetical = withExamOn(system, exam, date);
    const metrics = measure(hypothetical);
    if (!passesThresholds(metrics, settings)) continue;

    if (settings.requireRooms && roomAllocator) {
      if (!roomAllocator.allocate(hypothetical).isComplete) continue;
    }

    legal.add(date);
  }
  return legal;
}

function satisfiesPairwiseRules(
  exam: Exam,
  date: string,
  others: ExamSystem,
  settings: Settings
): boolean {
  for (const other of others) {
    const gap = requiredGap(exam, other.exam, settings);
    if (gap > 0 && dayDistance(date, other.date) < gap) return false;
  }
  return true;
}
