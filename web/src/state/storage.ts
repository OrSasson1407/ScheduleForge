/**
 * The internal storage of the software (requirement 6.1 of version 3.0).
 *
 * The data that was loaded, the changes the user made to it, the study programs
 * that were selected and the settings of the run are kept in the browser. A
 * later run finds them there and does not have to load the files again.
 */

import { StudyProgram } from "../engine/catalog";
import { ProgramColors } from "../engine/colors";
import { Course, ExamPeriod, ExamSystem, FacultyRules, Room } from "../engine/model";
import { DEFAULT_SETTINGS, Settings } from "../engine/settings";

const STORAGE_KEY = "scheduleforge.v3.data";

export type Theme = "light" | "dark";

/**
 * The one exam system an editor chose to show students - a self-contained
 * snapshot of everything the read-only student view needs to draw the same
 * calendar `OutputScreen` would, taken at the moment "Publish for students"
 * is pressed. Deliberately not a pointer back into `courses` / `periods` /
 * whatever the editor is currently working on: a student's view should not
 * change out from under them because someone loaded a new file or dragged an
 * exam mid-edit, only because an editor chose to publish something new.
 *
 * Sent to and read back from the server (`auth/api.ts`), not kept in this
 * browser's own storage below: a student needs to see what was published
 * from a *different* computer than the one that published it.
 */
export interface PublishedSchedule {
  system: ExamSystem;
  periods: ExamPeriod[];
  rooms: Room[];
  selectedPrograms: string[];
  programColors: ProgramColors;
  programs: StudyProgram[];
  settings: Settings;
  publishedAt: string;
}

export interface StoredData {
  courses: Course[];
  periods: ExamPeriod[];
  rooms: Room[];
  faculty: FacultyRules;
  selectedPrograms: string[];
  settings: Settings;
  /** The colour tag of every study program (tagging & theming). */
  programColors: ProgramColors;
  theme: Theme;
  coursesFileName: string | null;
  periodsFileName: string | null;
  roomsFileName: string | null;
  facultyFileName: string | null;
  savedAt: string | null;
}

export const EMPTY_DATA: StoredData = {
  courses: [],
  periods: [],
  rooms: [],
  faculty: {},
  selectedPrograms: [],
  settings: DEFAULT_SETTINGS,
  programColors: {},
  theme: "dark",
  coursesFileName: null,
  periodsFileName: null,
  roomsFileName: null,
  facultyFileName: null,
  savedAt: null,
};

export function loadStored(): StoredData | null {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    if (!text) return null;
    const data = JSON.parse(text) as StoredData;
    if (!Array.isArray(data.courses) || !Array.isArray(data.periods)) return null;
    return {
      ...EMPTY_DATA,
      ...data,
      settings: { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) },
    };
  } catch {
    return null;
  }
}

export function saveStored(data: StoredData): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...data, savedAt: new Date().toISOString() })
    );
  } catch {
    /* A browser that refuses to store simply keeps nothing between runs. */
  }
}
