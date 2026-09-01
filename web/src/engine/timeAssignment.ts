/**
 * Assigning a time of day to every exam of a chosen system (hour-of-day).
 *
 * The engine itself keeps scheduling by date alone, exactly as version 1.0
 * specifies (requirement 1.2: "the conflict is checked by date, not by
 * hours") - rewriting it to reason about hours would mean redoing the exact
 * counting, the bitmask conflict search and the whole wire protocol this
 * project is built on, for a rule nothing in the requirements ever asked for.
 *
 * Instead, once a date-only system has been found, this assigns a time to
 * every exam of it, the same way `RoomAllocator` assigns rooms to a finished
 * system rather than scheduling around them: a display and export layer on
 * top of a search that stays exactly as it was, and stays exactly as fast.
 *
 * The one thing that actually has to hold physically is that a room is not
 * asked to host two exams at once. Two exams that were allocated the same
 * room on the same date are therefore always given different time slots, in
 * the order their room was freed up; the room allocation already computed for
 * that system is what settles who overlaps whom, since sharing a room is the
 * one real reason two same-day exams cannot share an hour too. Without a
 * rooms file there is no such constraint to enforce, and slots are simply
 * spread round-robin across the day's exams for a calendar that is easier to
 * read.
 */

import { Exam, ExamSystem } from "./model";
import { RoomAllocation } from "./rooms";
import { Settings } from "./settings";

export interface TimeBooking {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface TimeAssignment {
  bookings: Map<string, TimeBooking>; // exam id -> booking
  failures: string[];
  isComplete: boolean;
}

const EMPTY_ASSIGNMENT: TimeAssignment = { bookings: new Map(), failures: [], isComplete: true };

export function minutesOf(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

export function addMinutes(hhmm: string, minutes: number): string {
  const total = minutesOf(hhmm) + minutes;
  const hours = Math.floor(total / 60) % 24;
  const mins = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/** Parse "09:00, 13:00, 16:00" into a sorted, de-duplicated list of slots. */
export function parseTimeSlots(text: string): string[] {
  const slots = new Set<string>();
  for (const token of text.split(/[,\s]+/)) {
    if (!token) continue;
    if (!/^\d{2}:\d{2}$/.test(token)) continue;
    slots.add(token);
  }
  return [...slots].sort();
}

/**
 * Every exam takes `defaultExamMinutes`: the data files carry no per-course
 * duration, and inventing one from something else the file does state (its
 * number of students, say) would be a guess this software has no basis for.
 */
function durationOf(_exam: Exam, settings: Settings): number {
  return settings.defaultExamMinutes;
}

export function assignTimes(
  system: ExamSystem,
  settings: Settings,
  allocation: RoomAllocation | null
): TimeAssignment {
  const slots = settings.timeSlots;
  if (!slots.length || !system.length) return EMPTY_ASSIGNMENT;

  const byDate = new Map<string, ExamSystem>();
  for (const scheduled of system) {
    const list = byDate.get(scheduled.date) ?? [];
    list.push(scheduled);
    byDate.set(scheduled.date, list);
  }

  const bookings = new Map<string, TimeBooking>();
  const failures: string[] = [];

  for (const [date, scheduledExams] of byDate) {
    const ordered = [...scheduledExams].sort((a, b) =>
      a.exam.course.number.localeCompare(b.exam.course.number)
    );
    const slotIndex = new Map<string, number>(); // exam id -> chosen slot

    if (allocation) {
      const nextFreeForRoom = new Map<string, number>(); // room name -> earliest free slot
      for (const scheduled of ordered) {
        const rooms = allocation.bookings.get(scheduled.exam.id)?.rooms ?? [];
        if (!rooms.length) continue; // this exam could not be seated at all; leave it for round robin
        const earliest = Math.max(0, ...rooms.map((room) => nextFreeForRoom.get(room.name) ?? 0));
        if (earliest >= slots.length) {
          failures.push(
            `${scheduled.exam.course.number} ${scheduled.exam.course.name} on ${date} needs a time ` +
              `slot after ${rooms.map((room) => room.name).join(", ")} is free, but only ` +
              `${slots.length} slot(s) are configured`
          );
          continue;
        }
        for (const room of rooms) nextFreeForRoom.set(room.name, earliest + 1);
        slotIndex.set(scheduled.exam.id, earliest);
      }
    }

    // Every exam without a room-driven slot (no rooms loaded, or it could not
    // be seated) is simply spread across the day's slots in turn.
    let turn = 0;
    for (const scheduled of ordered) {
      if (slotIndex.has(scheduled.exam.id)) continue;
      slotIndex.set(scheduled.exam.id, turn % slots.length);
      turn += 1;
    }

    for (const scheduled of ordered) {
      const index = slotIndex.get(scheduled.exam.id);
      if (index === undefined) continue;
      const start = slots[index];
      bookings.set(scheduled.exam.id, { start, end: addMinutes(start, durationOf(scheduled.exam, settings)) });
    }
  }

  return { bookings, failures, isComplete: failures.length === 0 };
}
