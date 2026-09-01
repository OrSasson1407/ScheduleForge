/**
 * Exporting an exam system to calendar files (the module of version 3.0).
 *
 * One .ics file is written per study program and study year, so a student of,
 * say, software engineering year 2 imports one file into Google Calendar or
 * Apple Calendar and sees exactly the exams of that year.
 *
 * The files follow RFC 5545: an all day event per exam - the software schedules
 * dates, not hours - with the course, the moed and, when rooms were allocated,
 * the room the exam is held in.
 */

import { StudyProgram, programName } from "./catalog";
import { ExamSystem, MOED_LABEL, SEMESTER_LABEL, ScheduledExam, addDays } from "./model";
import { RoomAllocation } from "./rooms";

const PRODUCT_ID = "-//ScheduleForge//Exam Schedule 3.0//EN";

function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** RFC 5545 folding: a content line is at most 75 octets. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const raw = encoder.encode(line);
  if (raw.length <= 75) return line;
  const decoder = new TextDecoder();
  const pieces: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < raw.length) {
    let end = Math.min(start + limit, raw.length);
    // Never cut a UTF-8 character in half.
    while (end > start && end < raw.length && (raw[end] & 0xc0) === 0x80) end -= 1;
    pieces.push(decoder.decode(raw.slice(start, end)));
    start = end;
    limit = 74; // the continuation lines carry a leading space
  }
  return pieces.join("\r\n ");
}

function asDay(iso: string): string {
  return iso.replace(/-/g, "");
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export interface CalendarFile {
  programNumber: string;
  year: number;
  fileName: string;
  text: string;
}

/** Every calendar of a system, one per study program and year. */
export function calendarsOf(
  system: ExamSystem,
  selectedPrograms: string[],
  programs: StudyProgram[],
  allocation: RoomAllocation | null
): CalendarFile[] {
  const groups = new Map<string, ScheduledExam[]>();
  for (const scheduled of system) {
    for (const slot of scheduled.exam.slots) {
      if (!selectedPrograms.includes(slot.programNumber)) continue;
      const key = `${slot.programNumber}|${slot.year}`;
      groups.set(key, (groups.get(key) ?? []).concat(scheduled));
    }
  }

  const now = stamp();
  return [...groups.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, scheduledExams]) => {
      const [programNumber, yearText] = key.split("|");
      const year = Number(yearText);
      const ordered = [...scheduledExams].sort(
        (a, b) => a.date.localeCompare(b.date) || a.exam.course.number.localeCompare(b.exam.course.number)
      );
      return {
        programNumber,
        year,
        fileName: `exams-${programNumber}-year-${year}.ics`,
        text: buildCalendar(programNumber, year, ordered, programs, allocation, now),
      };
    });
}

function buildCalendar(
  programNumber: string,
  year: number,
  scheduledExams: ScheduledExam[],
  programs: StudyProgram[],
  allocation: RoomAllocation | null,
  now: string
): string {
  const name = programName(programs, programNumber);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODUCT_ID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(`Exams - ${name} - year ${year}`)}`,
  ];

  for (const scheduled of scheduledExams) {
    const exam = scheduled.exam;
    const slot = exam.slots.find(
      (candidate) => candidate.programNumber === programNumber && candidate.year === year
    );
    const rooms = allocation?.bookings.get(exam.id)?.rooms ?? [];
    const description = [
      `Course: ${exam.course.number} ${exam.course.name}`,
      `Instructor: ${exam.course.instructor}`,
      `Semester: ${SEMESTER_LABEL[exam.semester]}, moed ${MOED_LABEL[exam.moed]}`,
      `Study program: ${programNumber} ${name}, year ${year}`,
    ];
    if (slot) description.push(`Type: ${slot.requirement}`);
    if (rooms.length) description.push(`Rooms: ${rooms.map((room) => room.name).join(", ")}`);

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${exam.course.number}-${exam.moed}-${programNumber}-${year}@scheduleforge`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART;VALUE=DATE:${asDay(scheduled.date)}`);
    lines.push(`DTEND;VALUE=DATE:${asDay(addDays(scheduled.date, 1))}`);
    lines.push(
      `SUMMARY:${escapeText(`${exam.course.number} ${exam.course.name} (moed ${MOED_LABEL[exam.moed]})`)}`
    );
    lines.push(`DESCRIPTION:${escapeText(description.join("\n"))}`);
    if (rooms.length) {
      const location = rooms
        .map((room) => (room.location ? `${room.name} (${room.location})` : room.name))
        .join(", ");
      lines.push(`LOCATION:${escapeText(location)}`);
    }
    lines.push("TRANSP:OPAQUE");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
