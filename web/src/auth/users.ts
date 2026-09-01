/**
 * The three kinds of account ScheduleForge knows about. The accounts
 * themselves no longer live here - they live on the small server in
 * `server/` (`auth/api.ts` talks to it), because an admin approving an
 * editor's registration only means anything if that approval is visible on
 * someone else's computer, not just the browser that clicked it. See
 * `server/index.js`'s header for what that server does and does not secure.
 */

export type Role = "admin" | "editor" | "viewer";

export interface Account {
  username: string;
  /** Shown in the header once signed in - not used to look the account up. */
  displayName: string;
  role: Role;
  status: "approved" | "pending";
}
