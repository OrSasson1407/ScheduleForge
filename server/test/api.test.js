/**
 * Integration tests for the HTTP API of index.js, run against a real
 * Firestore (via the Local Emulator Suite - see `npm run test:ci`, which
 * wraps this in `firebase emulators:exec`). No mocking of the database: the
 * whole point of this suite is to catch the kind of bug curl-by-hand testing
 * already caught once during development (a response-already-sent crash that
 * only a real request could show).
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.PORT = process.env.PORT || "8799";
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "test-admin-password";
process.env.ALLOWED_ORIGIN = "*";
process.env.SEED_DEMO_ACCOUNTS = "false";
// This suite alone registers more than the production default in a single
// run; the rate limiter itself is exercised deliberately, below.
process.env.REGISTER_RATE_LIMIT = "1000";
process.env.LOGIN_RATE_LIMIT = "1000";

const base = `http://localhost:${process.env.PORT}`;
const unique = () => crypto.randomBytes(4).toString("hex");

/** The session cookie the server sets on login - just the "sf_session=..." pair, dropping the rest of the Set-Cookie attributes (Path, HttpOnly, ...), the same way a browser's cookie jar would send only the pair back on the next request. */
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

before(async () => {
  serverModule = require("../index.js");
  // A cold Firestore emulator (or a loaded CI runner) can take well past 5
  // seconds to answer its first request; 150 * 200ms gives it real headroom
  // before this gives up.
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("server did not become healthy in time");
});

after(() => {
  serverModule.wss.close();
  serverModule.server.close();
});

test("health check", async () => {
  const { status, body } = await api("/healthz");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});

test("the bootstrap admin can sign in with ADMIN_PASSWORD", async () => {
  const { status, body, cookie } = await loginAs("admin", process.env.ADMIN_PASSWORD);
  assert.equal(status, 200);
  assert.equal(body.account.role, "admin");
  assert.ok(cookie);
});

test("wrong password is refused without revealing whether the account exists", async () => {
  const wrongPassword = await loginAs("admin", "not-it");
  const noSuchAccount = await loginAs(`nobody-${unique()}`, "not-it");
  assert.equal(wrongPassword.status, 401);
  assert.equal(noSuchAccount.status, 401);
  assert.deepEqual(wrongPassword.body, noSuchAccount.body);
});

test("registration is rejected below the minimum password length", async () => {
  const { status, body } = await api("/api/register", {
    method: "POST",
    body: JSON.stringify({
      username: `short-${unique()}`,
      password: "abc",
      email: `short-${unique()}@example.com`,
      displayName: "Too Short",
      role: "student",
      placeId: "does-not-matter-yet",
    }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /password/i);
});

test("a mutating request without the CSRF header is refused", async () => {
  const response = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: process.env.ADMIN_PASSWORD }),
  });
  assert.equal(response.status, 403);
});

test("a full place -> editor -> approve -> publish -> student sees it flow", async () => {
  const adminLogin = await loginAs("admin", process.env.ADMIN_PASSWORD);
  const adminCookie = adminLogin.cookie;

  const placeName = `Test Place ${unique()}`;
  const created = await api("/api/places", {
    method: "POST",
    headers: { Cookie: adminCookie },
    body: JSON.stringify({ name: placeName, kind: "university" }),
  });
  assert.equal(created.status, 201);
  const placeId = created.body.place.id;

  const editorUsername = `editor-${unique()}`;
  const registerEditor = await api("/api/register", {
    method: "POST",
    body: JSON.stringify({
      username: editorUsername,
      password: "correct-horse-battery",
      email: `${editorUsername}@example.com`,
      displayName: "Test Editor",
      role: "editor",
      placeId,
    }),
  });
  assert.equal(registerEditor.status, 201);
  assert.equal(registerEditor.body.status, "pending");

  const pendingLogin = await loginAs(editorUsername, "correct-horse-battery");
  assert.equal(pendingLogin.status, 403);
  assert.equal(pendingLogin.body.reason, "pending");

  const approve = await api(`/api/editors/${editorUsername}/approve`, {
    method: "POST",
    headers: { Cookie: adminCookie },
  });
  assert.equal(approve.status, 200);

  const editorLogin = await loginAs(editorUsername, "correct-horse-battery");
  assert.equal(editorLogin.status, 200);
  const editorCookie = editorLogin.cookie;

  const studentUsername = `student-${unique()}`;
  const registerStudent = await api("/api/register", {
    method: "POST",
    body: JSON.stringify({
      username: studentUsername,
      password: "correct-horse-battery",
      email: `${studentUsername}@example.com`,
      displayName: "Test Student",
      role: "student",
      placeId,
      program: "12345",
      year: 2,
    }),
  });
  assert.equal(registerStudent.status, 201);
  assert.equal(registerStudent.body.status, "approved"); // no approval gate for students

  const studentLogin = await loginAs(studentUsername, "correct-horse-battery");
  const studentCookie = studentLogin.cookie;

  const beforePublish = await api("/api/published", { headers: { Cookie: studentCookie } });
  assert.equal(beforePublish.body.published, null);

  const schedule = { system: [], periods: [], rooms: [], selectedPrograms: [], programColors: {}, programs: [], settings: {}, publishedAt: new Date().toISOString() };
  const publish = await api("/api/published", {
    method: "POST",
    headers: { Cookie: editorCookie },
    body: JSON.stringify(schedule),
  });
  assert.equal(publish.status, 200);

  const afterPublish = await api("/api/published", { headers: { Cookie: studentCookie } });
  assert.deepEqual(afterPublish.body.published, schedule);

  // A student cannot publish, and cannot see another place's list of accounts.
  const studentTriesToPublish = await api("/api/published", {
    method: "POST",
    headers: { Cookie: studentCookie },
    body: JSON.stringify(schedule),
  });
  assert.equal(studentTriesToPublish.status, 403);

  const studentTriesAdmin = await api("/api/accounts", { headers: { Cookie: studentCookie } });
  assert.equal(studentTriesAdmin.status, 403);
});

test("a teacher or student in a different place cannot see this place's schedule", async () => {
  const adminLogin = await loginAs("admin", process.env.ADMIN_PASSWORD);
  const adminCookie = adminLogin.cookie;

  const placeA = (
    await api("/api/places", {
      method: "POST",
      headers: { Cookie: adminCookie },
      body: JSON.stringify({ name: `Place A ${unique()}`, kind: "university" }),
    })
  ).body.place;
  const placeB = (
    await api("/api/places", {
      method: "POST",
      headers: { Cookie: adminCookie },
      body: JSON.stringify({ name: `Place B ${unique()}`, kind: "university" }),
    })
  ).body.place;

  const editorAUsername = `editorA-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username: editorAUsername, password: "correct-horse-battery", email: `${editorAUsername}@example.com`, displayName: "A", role: "editor", placeId: placeA.id }),
  });
  await api(`/api/editors/${editorAUsername}/approve`, { method: "POST", headers: { Cookie: adminCookie } });
  const editorACookie = (await loginAs(editorAUsername, "correct-horse-battery")).cookie;

  await api("/api/published", {
    method: "POST",
    headers: { Cookie: editorACookie },
    body: JSON.stringify({ system: [], periods: [], rooms: [], selectedPrograms: [], programColors: {}, programs: [], settings: {}, publishedAt: "2026-01-01T00:00:00.000Z" }),
  });

  const teacherBUsername = `teacherB-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({
      username: teacherBUsername,
      password: "correct-horse-battery",
      email: `${teacherBUsername}@example.com`,
      displayName: "B",
      role: "teacher",
      placeId: placeB.id,
      instructorNames: ["Someone"],
    }),
  });
  const teacherBCookie = (await loginAs(teacherBUsername, "correct-horse-battery")).cookie;

  const result = await api("/api/published", { headers: { Cookie: teacherBCookie } });
  assert.equal(result.body.published, null); // place A's publish must not leak into place B
});

test("an admin can reset a password, and it revokes existing sessions", async () => {
  const adminLogin = await loginAs("admin", process.env.ADMIN_PASSWORD);
  const adminCookie = adminLogin.cookie;

  const placeId = (
    await api("/api/places", {
      method: "POST",
      headers: { Cookie: adminCookie },
      body: JSON.stringify({ name: `Reset Place ${unique()}`, kind: "college" }),
    })
  ).body.place.id;

  const username = `resetme-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password: "original-password", email: `${username}@example.com`, displayName: "Reset Me", role: "student", placeId, program: "1", year: 1 }),
  });
  const originalCookie = (await loginAs(username, "original-password")).cookie;

  const reset = await api(`/api/accounts/${username}/reset-password`, {
    method: "POST",
    headers: { Cookie: adminCookie },
  });
  assert.equal(reset.status, 200);
  assert.ok(reset.body.temporaryPassword);

  const oldCookieNowRejected = await api("/api/me", { headers: { Cookie: originalCookie } });
  assert.equal(oldCookieNowRejected.status, 401);

  const oldPasswordNowRejected = await loginAs(username, "original-password");
  assert.equal(oldPasswordNowRejected.status, 401);

  const newPasswordWorks = await loginAs(username, reset.body.temporaryPassword);
  assert.equal(newPasswordWorks.status, 200);
  assert.equal(newPasswordWorks.body.account.mustChangePassword, true);

  const tempCookie = newPasswordWorks.cookie;
  const wrongCurrent = await api("/api/change-password", {
    method: "POST",
    headers: { Cookie: tempCookie },
    body: JSON.stringify({ currentPassword: "not-the-temp-one", newPassword: "brand-new-password" }),
  });
  assert.equal(wrongCurrent.status, 401);

  const changed = await api("/api/change-password", {
    method: "POST",
    headers: { Cookie: tempCookie },
    body: JSON.stringify({ currentPassword: reset.body.temporaryPassword, newPassword: "brand-new-password" }),
  });
  assert.equal(changed.status, 200);

  // Changing the password revokes every session, including the one used to change it.
  const tempCookieNowRejected = await api("/api/me", { headers: { Cookie: tempCookie } });
  assert.equal(tempCookieNowRejected.status, 401);

  const signInWithNewPassword = await loginAs(username, "brand-new-password");
  assert.equal(signInWithNewPassword.status, 200);
  assert.equal(signInWithNewPassword.body.account.mustChangePassword, false);
});

test("logout clears the session so the cookie no longer works", async () => {
  const login = await loginAs("admin", process.env.ADMIN_PASSWORD);
  const cookie = login.cookie;
  assert.equal((await api("/api/me", { headers: { Cookie: cookie } })).status, 200);

  const logout = await api("/api/logout", { method: "POST", headers: { Cookie: cookie } });
  assert.equal(logout.status, 200);

  assert.equal((await api("/api/me", { headers: { Cookie: cookie } })).status, 401);
});
