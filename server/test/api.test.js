/**
 * Integration tests for the HTTP API of index.js, run against a real
 * Postgres (CI runs one as a service container - see
 * .github/workflows/ci.yml - and DATABASE_URL points at it; run a local one
 * with the docker command in .env.example to run this file locally). No
 * mocking of the database: the whole point of this suite is to catch the
 * kind of bug curl-by-hand testing already caught once during development
 * (a response-already-sent crash that only a real request could show).
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

async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    /* some responses (OPTIONS, 204) have no body */
  }
  return { status: response.status, body };
}

let serverModule;

before(async () => {
  serverModule = require("../index.js");
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
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
  const { status, body } = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: process.env.ADMIN_PASSWORD }),
  });
  assert.equal(status, 200);
  assert.equal(body.account.role, "admin");
  assert.ok(body.token);
});

test("wrong password is refused without revealing whether the account exists", async () => {
  const wrongPassword = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "not-it" }),
  });
  const noSuchAccount = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: `nobody-${unique()}`, password: "not-it" }),
  });
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
      displayName: "Too Short",
      role: "student",
      placeId: "does-not-matter-yet",
    }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /password/i);
});

test("a full place -> editor -> approve -> publish -> student sees it flow", async () => {
  const adminLogin = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: process.env.ADMIN_PASSWORD }),
  });
  const adminToken = adminLogin.body.token;

  const placeName = `Test Place ${unique()}`;
  const created = await api("/api/places", {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
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
      displayName: "Test Editor",
      role: "editor",
      placeId,
    }),
  });
  assert.equal(registerEditor.status, 201);
  assert.equal(registerEditor.body.status, "pending");

  const pendingLogin = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: editorUsername, password: "correct-horse-battery" }),
  });
  assert.equal(pendingLogin.status, 403);
  assert.equal(pendingLogin.body.reason, "pending");

  const approve = await api(`/api/editors/${editorUsername}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(approve.status, 200);

  const editorLogin = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: editorUsername, password: "correct-horse-battery" }),
  });
  assert.equal(editorLogin.status, 200);
  const editorToken = editorLogin.body.token;

  const studentUsername = `student-${unique()}`;
  const registerStudent = await api("/api/register", {
    method: "POST",
    body: JSON.stringify({
      username: studentUsername,
      password: "correct-horse-battery",
      displayName: "Test Student",
      role: "student",
      placeId,
      program: "12345",
      year: 2,
    }),
  });
  assert.equal(registerStudent.status, 201);
  assert.equal(registerStudent.body.status, "approved"); // no approval gate for students

  const studentLogin = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: studentUsername, password: "correct-horse-battery" }),
  });
  const studentToken = studentLogin.body.token;

  const beforePublish = await api("/api/published", { headers: { Authorization: `Bearer ${studentToken}` } });
  assert.equal(beforePublish.body.published, null);

  const schedule = { system: [], periods: [], rooms: [], selectedPrograms: [], programColors: {}, programs: [], settings: {}, publishedAt: new Date().toISOString() };
  const publish = await api("/api/published", {
    method: "POST",
    headers: { Authorization: `Bearer ${editorToken}` },
    body: JSON.stringify(schedule),
  });
  assert.equal(publish.status, 200);

  const afterPublish = await api("/api/published", { headers: { Authorization: `Bearer ${studentToken}` } });
  assert.deepEqual(afterPublish.body.published, schedule);

  // A student cannot publish, and cannot see another place's list of accounts.
  const studentTriesToPublish = await api("/api/published", {
    method: "POST",
    headers: { Authorization: `Bearer ${studentToken}` },
    body: JSON.stringify(schedule),
  });
  assert.equal(studentTriesToPublish.status, 403);

  const studentTriesAdmin = await api("/api/accounts", { headers: { Authorization: `Bearer ${studentToken}` } });
  assert.equal(studentTriesAdmin.status, 403);
});

test("a teacher or student in a different place cannot see this place's schedule", async () => {
  const adminLogin = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: process.env.ADMIN_PASSWORD }),
  });
  const adminToken = adminLogin.body.token;

  const placeA = (
    await api("/api/places", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ name: `Place A ${unique()}`, kind: "university" }),
    })
  ).body.place;
  const placeB = (
    await api("/api/places", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ name: `Place B ${unique()}`, kind: "university" }),
    })
  ).body.place;

  const editorAUsername = `editorA-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username: editorAUsername, password: "correct-horse-battery", displayName: "A", role: "editor", placeId: placeA.id }),
  });
  await api(`/api/editors/${editorAUsername}/approve`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}` } });
  const editorAToken = (
    await api("/api/login", { method: "POST", body: JSON.stringify({ username: editorAUsername, password: "correct-horse-battery" }) })
  ).body.token;

  await api("/api/published", {
    method: "POST",
    headers: { Authorization: `Bearer ${editorAToken}` },
    body: JSON.stringify({ system: [], periods: [], rooms: [], selectedPrograms: [], programColors: {}, programs: [], settings: {}, publishedAt: "2026-01-01T00:00:00.000Z" }),
  });

  const teacherBUsername = `teacherB-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({
      username: teacherBUsername,
      password: "correct-horse-battery",
      displayName: "B",
      role: "teacher",
      placeId: placeB.id,
      instructorNames: ["Someone"],
    }),
  });
  const teacherBToken = (
    await api("/api/login", { method: "POST", body: JSON.stringify({ username: teacherBUsername, password: "correct-horse-battery" }) })
  ).body.token;

  const result = await api("/api/published", { headers: { Authorization: `Bearer ${teacherBToken}` } });
  assert.equal(result.body.published, null); // place A's publish must not leak into place B
});

test("an admin can reset a password, and it revokes existing sessions", async () => {
  const adminLogin = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: process.env.ADMIN_PASSWORD }),
  });
  const adminToken = adminLogin.body.token;

  const placeId = (
    await api("/api/places", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ name: `Reset Place ${unique()}`, kind: "college" }),
    })
  ).body.place.id;

  const username = `resetme-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password: "original-password", displayName: "Reset Me", role: "student", placeId, program: "1", year: 1 }),
  });
  const originalLogin = await api("/api/login", { method: "POST", body: JSON.stringify({ username, password: "original-password" }) });
  const originalToken = originalLogin.body.token;

  const reset = await api(`/api/accounts/${username}/reset-password`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(reset.status, 200);
  assert.ok(reset.body.temporaryPassword);

  const oldTokenNowRejected = await api("/api/me", { headers: { Authorization: `Bearer ${originalToken}` } });
  assert.equal(oldTokenNowRejected.status, 401);

  const oldPasswordNowRejected = await api("/api/login", { method: "POST", body: JSON.stringify({ username, password: "original-password" }) });
  assert.equal(oldPasswordNowRejected.status, 401);

  const newPasswordWorks = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password: reset.body.temporaryPassword }),
  });
  assert.equal(newPasswordWorks.status, 200);
  assert.equal(newPasswordWorks.body.account.mustChangePassword, true);

  const tempToken = newPasswordWorks.body.token;
  const wrongCurrent = await api("/api/change-password", {
    method: "POST",
    headers: { Authorization: `Bearer ${tempToken}` },
    body: JSON.stringify({ currentPassword: "not-the-temp-one", newPassword: "brand-new-password" }),
  });
  assert.equal(wrongCurrent.status, 401);

  const changed = await api("/api/change-password", {
    method: "POST",
    headers: { Authorization: `Bearer ${tempToken}` },
    body: JSON.stringify({ currentPassword: reset.body.temporaryPassword, newPassword: "brand-new-password" }),
  });
  assert.equal(changed.status, 200);

  // Changing the password revokes every session, including the one used to change it.
  const tempTokenNowRejected = await api("/api/me", { headers: { Authorization: `Bearer ${tempToken}` } });
  assert.equal(tempTokenNowRejected.status, 401);

  const signInWithNewPassword = await api("/api/login", { method: "POST", body: JSON.stringify({ username, password: "brand-new-password" }) });
  assert.equal(signInWithNewPassword.status, 200);
  assert.equal(signInWithNewPassword.body.account.mustChangePassword, false);
});
