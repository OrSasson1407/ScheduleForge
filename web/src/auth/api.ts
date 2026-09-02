/**
 * The HTTP calls to `server/index.js`'s account and publishing API - the one
 * part of ScheduleForge's state that has to be visible to *other* browsers,
 * not just the one that made a change. Every function here can fail simply
 * because the server is not running (this is an optional piece of
 * infrastructure a class has to start on its own, see `server/index.js`), so
 * every result says so explicitly instead of throwing into a component that
 * does not expect it.
 */

import { Account, Place } from "./users";
import { PublishedSchedule } from "../state/storage";

/**
 * `VITE_API_URL` is a build-time value (Vite bakes it into the bundle when
 * it is present at `npm run build` time - see `render.yaml` and
 * `DEPLOYMENT.md`), needed because a production deployment does not run the
 * web app and the server on the same host with only the port differing the
 * way local development does - they are two separate services with two
 * separate URLs.
 */
function baseUrl(): string {
  return import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8787`;
}

/**
 * `X-Requested-With` is this API's CSRF defense (see `server/index.js`'s
 * header comment): a plain cross-site form cannot set it, and a cross-site
 * `fetch` trying to would first have to pass the CORS preflight the server
 * only approves for `ALLOWED_ORIGIN`. Sent on every mutating request; GET
 * requests do not need it, but sending it there too is harmless.
 */
async function request<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Requested-With": "ScheduleForge", ...(init?.headers ?? {}) },
    });
  } catch {
    return { ok: false, status: 0, error: "offline" };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    /* An empty or non-JSON body is fine for a plain success. */
  }
  if (!response.ok) {
    const error = (body as { error?: string; reason?: string } | null)?.reason ?? (body as { error?: string } | null)?.error ?? "failed";
    return { ok: false, status: response.status, error };
  }
  return { ok: true, data: body as T };
}

export type LoginResult =
  | { outcome: "ok"; account: Account }
  | { outcome: "invalid" | "pending" | "offline" };

export async function login(username: string, password: string): Promise<LoginResult> {
  const result = await request<{ account: Account }>("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (result.ok) return { outcome: "ok", account: result.data.account };
  if (result.status === 0) return { outcome: "offline" };
  if (result.status === 403) return { outcome: "pending" };
  return { outcome: "invalid" };
}

export async function logout(): Promise<void> {
  await request("/api/logout", { method: "POST" });
}

export type RegisterResult = "ok" | "taken" | "offline" | "failed";

export interface RegisterInput {
  username: string;
  password: string;
  email: string;
  displayName: string;
  role: "editor" | "teacher" | "student";
  placeId: string;
  /** Teacher only. */
  instructorNames?: string[];
  /** Student only. */
  program?: string;
  year?: number;
}

export async function register(input: RegisterInput): Promise<RegisterResult> {
  const result = await request("/api/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (result.ok) return "ok";
  if (result.status === 0) return "offline";
  if (result.status === 409) return "taken";
  return "failed";
}

/** Resolves "ok" whenever the server was reachable - the response never says whether the email actually matched an account, to avoid confirming who has one. */
export async function forgotPassword(email: string): Promise<"ok" | "offline"> {
  const result = await request("/api/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  return result.ok || result.status !== 0 ? "ok" : "offline";
}

export type ConfirmResetResult = "ok" | "invalid" | "tooWeak" | "offline";

export async function confirmPasswordReset(token: string, newPassword: string): Promise<ConfirmResetResult> {
  const result = await request("/api/reset-password/confirm", {
    method: "POST",
    body: JSON.stringify({ token, newPassword }),
  });
  if (result.ok) return "ok";
  if (result.status === 0) return "offline";
  if (result.error.toLowerCase().includes("password")) return "tooWeak";
  return "invalid";
}

export type ChangePasswordResult = "ok" | "wrongCurrent" | "tooShort" | "offline";

export async function changePassword(currentPassword: string, newPassword: string): Promise<ChangePasswordResult> {
  const result = await request("/api/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (result.ok) return "ok";
  if (result.status === 0) return "offline";
  if (result.status === 401) return "wrongCurrent";
  return "tooShort";
}

export interface SessionInfo {
  id: string;
  userAgent: string;
  createdAt: string;
}

export async function fetchSessions(): Promise<{ sessions: SessionInfo[]; currentId: string } | null> {
  const result = await request<{ sessions: SessionInfo[]; currentId: string }>("/api/sessions");
  return result.ok ? result.data : null;
}

export async function revokeSession(id: string): Promise<boolean> {
  const result = await request(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
  return result.ok;
}

export async function fetchMe(): Promise<Account | null> {
  const result = await request<{ account: Account }>("/api/me");
  return result.ok ? result.data.account : null;
}

export async function fetchPlaces(): Promise<Place[] | null> {
  const result = await request<{ places: Place[] }>("/api/places");
  return result.ok ? result.data.places : null;
}

export async function createPlace(name: string, kind: string): Promise<Place | null> {
  const result = await request<{ place: Place }>("/api/places", {
    method: "POST",
    body: JSON.stringify({ name, kind }),
  });
  return result.ok ? result.data.place : null;
}

export async function createPlaceAdmin(
  placeId: string,
  username: string,
  password: string,
  displayName: string
): Promise<"ok" | "taken" | "failed"> {
  const result = await request(`/api/places/${encodeURIComponent(placeId)}/admins`, {
    method: "POST",
    body: JSON.stringify({ username, password, displayName }),
  });
  if (result.ok) return "ok";
  if (result.status === 409) return "taken";
  return "failed";
}

export async function fetchAccounts(): Promise<Account[] | null> {
  const result = await request<{ accounts: Account[] }>("/api/accounts");
  return result.ok ? result.data.accounts : null;
}

export async function resetPassword(username: string): Promise<string | null> {
  const result = await request<{ temporaryPassword: string }>(`/api/accounts/${encodeURIComponent(username)}/reset-password`, {
    method: "POST",
  });
  return result.ok ? result.data.temporaryPassword : null;
}

export async function approveEditor(username: string): Promise<boolean> {
  const result = await request(`/api/editors/${encodeURIComponent(username)}/approve`, { method: "POST" });
  return result.ok;
}

export async function rejectEditor(username: string): Promise<boolean> {
  const result = await request(`/api/editors/${encodeURIComponent(username)}/reject`, { method: "POST" });
  return result.ok;
}

export async function fetchPublished(): Promise<PublishedSchedule | null | undefined> {
  const result = await request<{ published: PublishedSchedule | null }>("/api/published");
  return result.ok ? result.data.published : undefined; // undefined marks "could not reach the server"
}

export async function publish(schedule: PublishedSchedule): Promise<boolean> {
  const result = await request("/api/published", {
    method: "POST",
    body: JSON.stringify(schedule),
  });
  return result.ok;
}
