/**
 * The readable text of one exam system, for requirement 3.5 (save to a file).
 */

import { StudyProgram, programName } from "./catalog";
import { RoomAllocation } from "./rooms";
import {
  ExamSystem,
  MOED_LABEL,
  MOED_ORDER,
  SEMESTER_LABEL,
  SEMESTER_ORDER,
  ScheduledExam,
  toDisplayDate,
} from "./model";

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function groupsOf(system: ExamSystem): [string, ScheduledExam[]][] {
  const groups = new Map<string, ScheduledExam[]>();
  for (const scheduled of system) {
    const key = `${scheduled.exam.semester}|${scheduled.exam.moed}`;
    const list = groups.get(key) ?? [];
    list.push(scheduled);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort((a, b) => {
      const [firstSemester, firstMoed] = a[0].split("|");
      const [secondSemester, secondMoed] = b[0].split("|");
      return (
        SEMESTER_ORDER[firstSemester as never] - SEMESTER_ORDER[secondSemester as never] ||
        MOED_ORDER[firstMoed as never] - MOED_ORDER[secondMoed as never]
      );
    })
    .map(([key, list]) => [
      key,
      list.sort(
        (a, b) => a.date.localeCompare(b.date) || a.exam.course.number.localeCompare(b.exam.course.number)
      ),
    ]);
}

export function formatSystem(
  system: ExamSystem,
  index: number,
  total: bigint | null,
  selectedPrograms: string[],
  programs: StudyProgram[],
  allocation: RoomAllocation | null = null,
  metricsLine?: string
): string {
  const rule = "=".repeat(78);
  const lines: string[] = [];
  lines.push(rule);
  lines.push("ScheduleForge - exam system - version 3.0");
  lines.push(`Produced on ${toDisplayDate(new Date().toISOString().slice(0, 10))}`);
  lines.push(rule);
  lines.push(`Selected study programs (${selectedPrograms.length}):`);
  for (const number of selectedPrograms) {
    lines.push(`    ${number} ${programName(programs, number)}`);
  }
  lines.push(`Exams in this system: ${system.length}`);
  lines.push(
    total === null
      ? `This is exam system number ${index + 1}`
      : `This is exam system number ${index + 1}; ${total.toLocaleString("en-US")} systems ` +
        "are possible before the threshold requirements"
  );
  if (metricsLine) lines.push(metricsLine);
  lines.push(rule);

  for (const [key, scheduledExams] of groupsOf(system)) {
    const [semester, moed] = key.split("|");
    lines.push("");
    lines.push(
      `  ${SEMESTER_LABEL[semester as never]}, moed ${MOED_LABEL[moed as never]}`
    );
    lines.push("  " + "-".repeat(74));
    lines.push(
      `  ${pad("DATE", 12)} ${pad("COURSE", 8)} ${pad("COURSE NAME", 28)} ${pad("TYPE", 11)} ` +
        `${pad("PROGRAMS", 20)}${allocation ? "ROOMS" : ""}`
    );
    for (const scheduled of scheduledExams) {
      const requirement = scheduled.exam.slots.some((slot) => slot.requirement === "Obligatory")
        ? "Obligatory"
        : "Elective";
      const programList = [...new Set(scheduled.exam.slots.map((slot) => slot.programNumber))].join(", ");
      const rooms = allocation?.bookings.get(scheduled.exam.id)?.rooms ?? [];
      lines.push(
        `  ${pad(toDisplayDate(scheduled.date), 12)} ${pad(scheduled.exam.course.number, 8)} ` +
          `${pad(scheduled.exam.course.name.slice(0, 28), 28)} ${pad(requirement, 11)} ` +
          `${pad(programList, 20)}${rooms.map((room) => room.name).join(", ")}`
      );
    }
  }
  lines.push("");
  lines.push(rule);
  return lines.join("\n") + "\n";
}

/** Hands the text to the browser as a file the user saves (requirement 3.5). */
export function downloadText(fileName: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
