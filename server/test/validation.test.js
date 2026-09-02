/**
 * Integration tests for request validation and authorization branches of the
 * HTTP API in index.js that api.test.js's end-to-end flow does not exercise:
 * bad input on register/login, admin-only gating, and 404s for unknown
 * accounts. Runs its own server instance on its own port so it stays
 * independent of the other test files (node's test runner gives each test
 * file its own process, so a separate PORT avoids EADDRINUSE).
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.PORT = "8798";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.ALLOWED_ORIGIN = "*";
process.env.SEED_DEMO_ACCOUNTS = "false";
process.env.REGISTER_RATE_LIMIT = "1000";
process.env.LOGIN_RATE_LIMIT = "1000";

const base = `http://localhost:${process.env.PORT}`;
const unique = () => crypto.randomBytes(4).toString("hex");

function sessionCookieFrom(response) {
  const setCookie = response.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : null;
}

async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", "X-Requested-With": "ScheduleForge", ...(options.headers ?? {}) },
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    /* some responses (OPTIONS, 204) have no body */
  }
  return { status: response.status, body, cookie: sessionCookieFrom(response) };
}

async function loginAs(username, password) {
  return api("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
}

let serverModule;
let adminCookie;
let placeId;

before(async () => {
  serverModule = require("../index.js");
  // A cold Firestore emulator (or a loaded CI runner) can take well past 5
  // seconds to answer its first request; 150 * 200ms gives it real headroom
  // before this gives up.
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const login = await loginAs("admin", process.env.ADMIN_PASSWORD);
  adminCookie = login.cookie;
  const place = await api("/api/places", {
    method: "POST",
    headers: { Cookie: adminCookie },
    body: JSON.stringify({ name: `Validation Place ${unique()}`, kind: "university" }),
  });
  placeId = place.body.place.id;
});

after(() => {
  serverModule.wss.close();
  serverModule.server.close();
});

test("OPTIONS preflight returns 204 with CORS headers, no body", async () => {
  const response = await fetch(`${base}/api/login`, { method: "OPTIONS" });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.ok(response.headers.get("access-control-allow-methods").includes("POST"));
});

test("a mutating request without the CSRF header is refused", async () => {
  const response = await fetch(`${base}/api/places`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ name: "X", kind: "university" }),
  });
  assert.equal(response.status, 403);
});

test("a GET request needs no CSRF header", async () => {
  const response = await fetch(`${base}/api/places`);
  assert.equal(response.status, 200);
});

test("an unknown route returns 404", async () => {
  const { status } = await api("/api/does-not-exist");
  assert.equal(status, 404);
});

test("a non-API path returns a bare 404", async () => {
  const response = await fetch(`${base}/some-random-page`);
  assert.equal(response.status, 404);
});

test("GET /api/places is public and lists at least the place created in setup", async () => {
  const { status, body } = await api("/api/places");
  assert.equal(status, 200);
  assert.ok(body.places.some((p) => p.id === placeId));
});

test("POST /api/places is refused for a non-admin", async () => {
  const { status } = await api("/api/places", {
    method: "POST",
    body: JSON.stringify({ name: "X", kind: "university" }),
  });
  assert.equal(status, 403);
});

test("POST /api/places requires both name and kind", async () => {
  const missingKind = await api("/api/places", {
    method: "POST",
    headers: { Cookie: adminCookie },
    body: JSON.stringify({ name: "X" }),
  });
  assert.equal(missingKind.status, 400);
});

test("register rejects an invalid role", async () => {
  const { status, body } = await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username: `u-${unique()}`, password: "goodpassword", role: "superadmin", placeId }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /role/i);
});

test("register rejects a username that is too short", async () => {
  const { status } = await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username: "ab", password: "goodpassword", role: "student", placeId, program: "1", year: 1 }),
  });
  assert.equal(status, 400);
});

test("register rejects a username with illegal characters", async () => {
  const { status } = await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username: "bad user!", password: "goodpassword", role: "student", placeId, program: "1", year: 1 }),
  });
  assert.equal(status, 400);
});

test("register rejects an unknown place", async () => {
  const { status, body } = await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username: `u-${unique()}`, password: "goodpassword", email: `u-${unique()}@example.com`, role: "student", placeId: "does-not-exist" }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /place/i);
});

test("register rejects a username already taken", async () => {
  const username = `dupe-${unique()}`;
  const first = await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password: "goodpassword", email: `${username}@example.com`, role: "student", placeId, program: "1", year: 1 }),
  });
  assert.equal(first.status, 201);
  const second = await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password: "goodpassword", email: `${username}@example.com`, role: "student", placeId, program: "1", year: 1 }),
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, "taken");
});

test("a teacher registers with instructorNames and is approved immediately", async () => {
  const { status, body } = await api("/api/register", {
    method: "POST",
    body: JSON.stringify({
      username: `teacher-${unique()}`,
      password: "goodpassword",
      email: `teacher-${unique()}@example.com`,
      role: "teacher",
      placeId,
      instructorNames: ["Dr. Smith", "Dr. Jones"],
    }),
  });
  assert.equal(status, 201);
  assert.equal(body.status, "approved");
});

test("register falls back to the username as displayName when none is given", async () => {
  const username = `nodisplay-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password: "goodpassword", email: `${username}@example.com`, role: "student", placeId, program: "1", year: 1 }),
  });
  const login = await loginAs(username, "goodpassword");
  assert.equal(login.body.account.displayName, username);
});

test("login for an unknown username returns 401", async () => {
  const { status } = await loginAs(`ghost-${unique()}`, "whatever123");
  assert.equal(status, 401);
});

test("GET /api/me without a session returns 401", async () => {
  const { status } = await api("/api/me");
  assert.equal(status, 401);
});

test("GET /api/me with a garbage cookie returns 401", async () => {
  const { status } = await api("/api/me", { headers: { Cookie: "sf_session=not-a-real-token" } });
  assert.equal(status, 401);
});

test("GET /api/me with a valid session returns the account", async () => {
  const { status, body } = await api("/api/me", { headers: { Cookie: adminCookie } });
  assert.equal(status, 200);
  assert.equal(body.account.role, "admin");
});

test("change-password without a session returns 401", async () => {
  const { status } = await api("/api/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword: "x", newPassword: "goodpassword2" }),
  });
  assert.equal(status, 401);
});

test("change-password rejects a new password below the minimum length", async () => {
  const username = `shortnew-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password: "goodpassword", email: `${username}@example.com`, role: "student", placeId, program: "1", year: 1 }),
  });
  const login = await loginAs(username, "goodpassword");
  const { status, body } = await api("/api/change-password", {
    method: "POST",
    headers: { Cookie: login.cookie },
    body: JSON.stringify({ currentPassword: "goodpassword", newPassword: "abc" }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /password/i);
});

test("GET /api/accounts is refused for a non-admin", async () => {
  const username = `notadmin-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password: "goodpassword", email: `${username}@example.com`, role: "student", placeId, program: "1", year: 1 }),
  });
  const login = await loginAs(username, "goodpassword");
  const { status } = await api("/api/accounts", { headers: { Cookie: login.cookie } });
  assert.equal(status, 403);
});

test("GET /api/accounts lists at least the admin account", async () => {
  const { status, body } = await api("/api/accounts", { headers: { Cookie: adminCookie } });
  assert.equal(status, 200);
  assert.ok(body.accounts.some((a) => a.username === "admin"));
});

test("approving an unknown editor returns 404", async () => {
  const { status } = await api(`/api/editors/${unique()}/approve`, {
    method: "POST",
    headers: { Cookie: adminCookie },
  });
  assert.equal(status, 404);
});

test("rejecting an unknown editor returns 404", async () => {
  const { status } = await api(`/api/editors/${unique()}/reject`, {
    method: "POST",
    headers: { Cookie: adminCookie },
  });
  assert.equal(status, 404);
});

test("approve is refused for a non-admin", async () => {
  const { status } = await api(`/api/editors/${unique()}/approve`, { method: "POST" });
  assert.equal(status, 403);
});

test("rejecting a pending editor removes the account entirely", async () => {
  const username = `rejectme-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password: "goodpassword", email: `${username}@example.com`, role: "editor", placeId }),
  });
  const reject = await api(`/api/editors/${username}/reject`, {
    method: "POST",
    headers: { Cookie: adminCookie },
  });
  assert.equal(reject.status, 200);
  const login = await loginAs(username, "goodpassword");
  assert.equal(login.status, 401); // the account is gone, not merely still pending
});

test("reset-password for an unknown username returns 404", async () => {
  const { status } = await api(`/api/accounts/${unique()}/reset-password`, {
    method: "POST",
    headers: { Cookie: adminCookie },
  });
  assert.equal(status, 404);
});

test("reset-password is refused for a non-admin", async () => {
  const { status } = await api("/api/accounts/admin/reset-password", { method: "POST" });
  assert.equal(status, 403);
});

test("GET /api/published without a session returns 401", async () => {
  const { status } = await api("/api/published");
  assert.equal(status, 401);
});

test("POST /api/published is refused for a student", async () => {
  const username = `pubstudent-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password: "goodpassword", email: `${username}@example.com`, role: "student", placeId, program: "1", year: 1 }),
  });
  const login = await loginAs(username, "goodpassword");
  const { status } = await api("/api/published", {
    method: "POST",
    headers: { Cookie: login.cookie },
    body: JSON.stringify({ system: [] }),
  });
  assert.equal(status, 403);
});

test("an admin account itself has no place and gets 401 from GET /api/published", async () => {
  const { status } = await api("/api/published", { headers: { Cookie: adminCookie } });
  assert.equal(status, 401);
});

test("a malformed JSON body is rejected with 400", async () => {
  const response = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "ScheduleForge" },
    body: "{not valid json",
  });
  assert.equal(response.status, 400);
});
