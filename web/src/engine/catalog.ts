/**
 * The study programs the user chooses from on the input screen (req. 2.2).
 *
 * Nothing here is built in: every selectable program comes from the loaded
 * courses file - its number, and whatever the file itself says about it. A
 * courses file names a program only by its number, never a name, so that is
 * the whole of what the software knows about it until a file says otherwise.
 */

import { Course } from "./model";

export interface StudyProgram {
  number: string;
  name: string;
}

/** How many study programs may be selected at once (requirement 2.2). */
export const MAX_SELECTED_PROGRAMS = 5;

/** Every selectable program: whatever program numbers the courses file holds. */
export function programsOf(courses: Course[]): StudyProgram[] {
  const numbers = new Set<string>();
  for (const course of courses) {
    for (const enrollment of course.enrollments) numbers.add(enrollment.programNumber);
  }
  return [...numbers].sort().map((number) => ({ number, name: "" }));
}

export function programName(programs: StudyProgram[], number: string): string {
  return programs.find((program) => program.number === number)?.name || number;
}
