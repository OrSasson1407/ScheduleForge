/**
 * Manual editing of a chosen exam system: dragging one exam to another date.
 *
 * The output screen shows one exam system that the search already proved
 * conflict free and passing every threshold. Dragging an exam edits that one
 * system directly, so every candidate date is checked against the very same
 * rules the search used - the pairwise rule of version 1.0, the pairwise
 * thresholds 2.1/2.2/2.6, the aggregate thresholds 2.3/2.4/2.5/2.7, room
 * capacity, staff availability, and - when `enforceTimeSlots` is on - that
 * the exams of the target date can still be given distinct time slots - and
 * only the dates that keep the system legal light up.
 *
 * Nothing here touches the search: it re-evaluates one exam against a fixed
 * system, which costs one pass over the exams per candidate date - fast enough
 * to run on every drag start.
 */

import { requiredGap } from "./decomposition";
import {
  EnrollmentRoster,
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
import { colorDay } from "./timeSlots";

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
  roster?: EnrollmentRoster;
}

/** Every date `exam` may legally be moved to, and why the others are blocked. */
export function legalDatesFor(input: LegalityInput): Set<string> {
  const { exam, system, periods, settings, faculty, roomAllocator, roster } = input;
  const period = periods.find((p) => periodKey(p.semester, p.moed) === periodKey(exam.semester, exam.moed));
  if (!period) return new Set();

  let candidates = availableDates(period);
  if (faculty) {
    candidates = candidates.filter((iso) => isInstructorAvailable(faculty, exam.course.instructor, iso));
  }

  const others = system.filter((scheduled) => scheduled.exam !== exam);
  const legal = new Set<string>();

  for (const date of candidates) {
    if (!satisfiesPairwiseRules(exam, date, others, settings, roster)) continue;

    const hypothetical = withExamOn(system, exam, date);
    const metrics = measure(hypothetical, settings.windowDays);
    if (!passesThresholds(metrics, settings)) continue;

    if (settings.requireRooms && roomAllocator) {
      if (!roomAllocator.allocate(hypothetical).isComplete) continue;
    }

    if (settings.enforceTimeSlots && settings.timeSlots.length) {
      const sameDayExams = hypothetical.filter((scheduled) => scheduled.date === date).map((s) => s.exam);
      if (!colorDay(sameDayExams, settings.timeSlots.length, roster)) continue;
    }

    legal.add(date);
  }
  return legal;
}

function satisfiesPairwiseRules(
  exam: Exam,
  date: string,
  others: ExamSystem,
  settings: Settings,
  roster?: EnrollmentRoster
): boolean {
  for (const other of others) {
    const gap = requiredGap(exam, other.exam, settings, roster);
    if (gap > 0 && dayDistance(date, other.date) < gap) return false;
  }
  return true;
}
