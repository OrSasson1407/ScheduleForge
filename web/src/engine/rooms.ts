/**
 * Allocating rooms to the exams of a system (the module of version 3.0).
 *
 * Every exam of a date is seated in rooms of its own: a room holds one exam on
 * a given date, so two exams never overlap in a room, exactly the way two exams
 * of one study year never overlap on a date. An exam that needs more seats than
 * the largest free room has is spread over several rooms.
 */

import { Exam, ExamSystem, Room } from "./model";

export interface RoomBooking {
  exam: Exam;
  date: string;
  rooms: Room[];
}

export interface RoomAllocation {
  bookings: Map<string, RoomBooking>;
  failures: string[];
  isComplete: boolean;
}

export class RoomAllocator {
  /** Smallest room first: an exam takes the smallest room it fits in. */
  private readonly rooms: Room[];

  constructor(rooms: Room[], private readonly defaultStudents = 30) {
    this.rooms = [...rooms].sort(
      (a, b) => a.capacity - b.capacity || a.name.localeCompare(b.name)
    );
  }

  get totalCapacity(): number {
    return this.rooms.reduce((sum, room) => sum + room.capacity, 0);
  }

  studentsOf(exam: Exam): number {
    return exam.course.students ?? this.defaultStudents;
  }

  allocate(system: ExamSystem): RoomAllocation {
    const byDate = new Map<string, ExamSystem>();
    for (const scheduled of system) {
      const list = byDate.get(scheduled.date) ?? [];
      list.push(scheduled);
      byDate.set(scheduled.date, list);
    }

    const bookings = new Map<string, RoomBooking>();
    const failures: string[] = [];
    for (const date of [...byDate.keys()].sort()) {
      this.allocateDay(date, byDate.get(date)!, bookings, failures);
    }
    return { bookings, failures, isComplete: failures.length === 0 };
  }

  private allocateDay(
    date: string,
    scheduledExams: ExamSystem,
    bookings: Map<string, RoomBooking>,
    failures: string[]
  ): void {
    // The exam with the most students picks first: it is the one a late pick
    // would leave without a room large enough.
    const ordered = [...scheduledExams].sort(
      (a, b) =>
        this.studentsOf(b.exam) - this.studentsOf(a.exam) ||
        a.exam.course.number.localeCompare(b.exam.course.number)
    );
    const free = [...this.rooms];
    for (const scheduled of ordered) {
      const needed = this.studentsOf(scheduled.exam);
      const taken = takeRooms(free, needed);
      if (!taken) {
        const seats = free.reduce((sum, room) => sum + room.capacity, 0);
        failures.push(
          `${scheduled.exam.course.number} ${scheduled.exam.course.name} on ` +
            `${date} needs ${needed} seats, only ${seats} are free that day`
        );
        continue;
      }
      for (const room of taken) free.splice(free.indexOf(room), 1);
      bookings.set(scheduled.exam.id, { exam: scheduled.exam, date, rooms: taken });
    }
  }
}

function takeRooms(free: Room[], needed: number): Room[] | null {
  for (const room of free) {
    if (room.capacity >= needed) return [room]; // the smallest room that holds it
  }
  // No single room is large enough, so fill it with the largest ones.
  const taken: Room[] = [];
  let seats = 0;
  for (let index = free.length - 1; index >= 0; index -= 1) {
    taken.push(free[index]);
    seats += free[index].capacity;
    if (seats >= needed) return taken;
  }
  return null;
}
