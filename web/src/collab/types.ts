/**
 * The messages exchanged with the collaboration server (`server/index.js`).
 *
 * The shapes here are the client's half of the protocol documented at the top
 * of that file; keeping them in one place is what lets `useCollab` stay a
 * plain state machine instead of a pile of inline `any`.
 */

import { Settings } from "../engine/settings";

export type Role = "editor" | "viewer";

export interface User {
  clientId: string;
  name: string;
  role: Role;
}

export type ClientMessage =
  | { type: "join"; room: string; name: string; role: Role }
  | { type: "lock"; examId: string }
  | { type: "unlock"; examId: string }
  | { type: "move"; examId: string; date: string }
  | { type: "settings"; settings: Settings };

export type ServerMessage =
  | {
      type: "state";
      clientId: string;
      examDates: Record<string, string>;
      locks: Record<string, { name: string; clientId: string }>;
      settings: Settings | null;
      users: User[];
    }
  | { type: "presence"; users: User[] }
  | { type: "lock-changed"; examId: string; by: string | null; clientId: string | null }
  | { type: "lock-denied"; examId: string; heldBy: string }
  | { type: "moved"; examId: string; date: string; by: string }
  | { type: "settings"; settings: Settings; by: string };
