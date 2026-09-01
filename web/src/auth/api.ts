/**
 * The HTTP calls to `server/index.js`'s account and publishing API - the one
 * part of ScheduleForge's state that has to be visible to *other* browsers,
 * not just the one that made a change. Every function here can fail simply
 * because the server is not running (this is an optional piece of
 * infrastructure a class has to start on its own, see `server/index.js`), so
 * every result says so explicitly instead of throwing into a component that
 * does not expect it.
 */

import { Account } from "./users";
import { PublishedSchedule } from "../state/storage";

function baseUrl(): string {
  return `http://${window.location.hostname}:8787`;
}

async function request<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
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

function authHeader(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export type LoginResult =
  | { outcome: "ok"; token: string; account: Account }
  | { outcome: "invalid" | "pending" | "offline" };

export async function login(username: string, password: string): Promise<LoginResult> {
  const result = await request<{ token: string; account: Account }>("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (result.ok) return { outcome: "ok", token: result.data.token, account: result.data.account };
  if (result.status === 0) return { outcome: "offline" };
  if (result.status === 403) return { outcome: "pending" };
  return { outcome: "invalid" };
}

export type RegisterResult = "ok" | "taken" | "offline" | "failed";

export async function register(username: string, password: string, displayName: string): Promise<RegisterResult> {
  const result = await request("/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password, displayName }),
  });
  if (result.ok) return "ok";
  if (result.status === 0) return "offline";
  if (result.status === 409) return "taken";
  return "failed";
}

export async function fetchMe(token: string): Promise<Account | null> {
  const result = await request<{ account: Account }>("/api/me", { headers: authHeader(token) });
  return result.ok ? result.data.account : null;
}

export async function fetchEditors(token: string): Promise<Account[] | null> {
  const result = await request<{ editors: Account[] }>("/api/editors", { headers: authHeader(token) });
  return result.ok ? result.data.editors : null;
}

export async function approveEditor(token: string, username: string): Promise<boolean> {
  const result = await request(`/api/editors/${encodeURIComponent(username)}/approve`, {
    method: "POST",
    headers: authHeader(token),
  });
  return result.ok;
}

export async function rejectEditor(token: string, username: string): Promise<boolean> {
  const result = await request(`/api/editors/${encodeURIComponent(username)}/reject`, {
    method: "POST",
    headers: authHeader(token),
  });
  return result.ok;
}

export async function fetchPublished(token: string): Promise<PublishedSchedule | null | undefined> {
  const result = await request<{ published: PublishedSchedule | null }>("/api/published", { headers: authHeader(token) });
  return result.ok ? result.data.published : undefined; // undefined marks "could not reach the server"
}

export async function publish(token: string, schedule: PublishedSchedule): Promise<boolean> {
  const result = await request("/api/published", {
    method: "POST",
    headers: authHeader(token),
    body: JSON.stringify(schedule),
  });
  return result.ok;
}
