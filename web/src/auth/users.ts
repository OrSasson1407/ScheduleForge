/**
 * The four kinds of account ScheduleForge knows about, and the places
 * (institutions) every account but `admin` belongs to. None of this lives
 * here - it all lives on the small server in `server/` (`auth/api.ts` talks
 * to it), because an admin approving an editor, or a teacher reading a
 * schedule someone else's browser published, only means anything if it is
 * visible on someone else's computer, not just the browser that made it. See
 * `server/index.js`'s header for what that server does and does not secure.
 */

export type Role = "admin" | "editor" | "teacher" | "student";

export interface Place {
  id: string;
  name: string;
  /** A free-text label the admin chose when creating the place - "university", "high school", "college", or anything else. */
  kind: string;
}

export interface Account {
  username: string;
  /** Shown in the header once signed in - not used to look the account up. */
  displayName: string;
  role: Role;
  status: "approved" | "pending";
  /** The place this account belongs to. Only `admin` has none. */
  placeId: string | null;
  /** True right after an admin resets this account's password - the server refuses nothing because of it, but the client should ask for a new one before going further. */
  mustChangePassword: boolean;
  /** Teacher only: the instructor name(s) in their place's course data that are them. */
  instructorNames?: string[];
  /** Student only: which study program and year their exams are filtered to. */
  program?: string;
  year?: number;
}
