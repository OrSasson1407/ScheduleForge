/**
 * Integration tests for institution-scoped sub-admins: a `placeAdmin`
 * account can administer only its own place, never another one, and only
 * the global `admin` can create a place or a place admin to begin with.
 * Runs its own server instance on its own port, independent of the other
 * test files.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.PORT = "8793";
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
    /* no body */
  }
  return { status: response.status, body, cookie: sessionCookieFrom(response) };
}

async function loginAs(username, password) {
  return api("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
}

async function createPlace(adminCookie, name) {
  const result = await api("/api/places", {
    method: "POST",
    headers: { Cookie: adminCookie },
    body: JSON.stringify({ name, kind: "university" }),
  });
  return result.body.place.id;
}

async function createPlaceAdminAccount(adminCookie, placeId, username, password) {
  return api(`/api/places/${placeId}/admins`, {
    method: "POST",
    headers: { Cookie: adminCookie },
    body: JSON.stringify({ username, password, displayName: `Admin of ${placeId}` }),
  });
}

let serverModule;
let adminCookie;

before(async () => {
  serverModule = require("../index.js");
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  adminCookie = (await loginAs("admin", process.env.ADMIN_PASSWORD)).cookie;
});

after(() => {
  serverModule.wss.close();
  serverModule.server.close();
});

test("the global admin can create a place admin for a place", async () => {
  const placeId = await createPlace(adminCookie, `Place ${unique()}`);
  const username = `placeadmin-${unique()}`;
  const created = await createPlaceAdminAccount(adminCookie, placeId, username, "goodpassword");
  assert.equal(created.status, 201);

  const login = await loginAs(username, "goodpassword");
  assert.equal(login.status, 200);
  assert.equal(login.body.account.role, "placeAdmin");
  assert.equal(login.body.account.placeId, placeId);
});

test("creating a place admin is refused for an unauthenticated caller", async () => {
  const placeId = await createPlace(adminCookie, `Place ${unique()}`);
  const result = await createPlaceAdminAccount("", placeId, `nope-${unique()}`, "goodpassword");
  assert.equal(result.status, 403);
});

test("creating a place admin is refused for a signed-in but non-admin account", async () => {
  const placeId = await createPlace(adminCookie, `Place ${unique()}`);
  const studentUsername = `student-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username: studentUsername, password: "goodpassword", email: `${studentUsername}@example.com`, role: "student", placeId, program: "1", year: 1 }),
  });
  const studentCookie = (await loginAs(studentUsername, "goodpassword")).cookie;
  const result = await createPlaceAdminAccount(studentCookie, placeId, `nope-${unique()}`, "goodpassword");
  assert.equal(result.status, 403);
});

test("a place admin cannot create another place admin", async () => {
  const placeId = await createPlace(adminCookie, `Place ${unique()}`);
  const placeAdminUsername = `placeadmin-${unique()}`;
  await createPlaceAdminAccount(adminCookie, placeId, placeAdminUsername, "goodpassword");
  const placeAdminCookie = (await loginAs(placeAdminUsername, "goodpassword")).cookie;

  const attempt = await createPlaceAdminAccount(placeAdminCookie, placeId, `another-${unique()}`, "goodpassword");
  assert.equal(attempt.status, 403);
});

test("creating a place admin for an unknown place returns 400", async () => {
  const result = await createPlaceAdminAccount(adminCookie, "does-not-exist", `x-${unique()}`, "goodpassword");
  assert.equal(result.status, 400);
});

test("creating a place admin with a taken username returns 409", async () => {
  const placeId = await createPlace(adminCookie, `Place ${unique()}`);
  const username = `dupe-${unique()}`;
  await createPlaceAdminAccount(adminCookie, placeId, username, "goodpassword");
  const second = await createPlaceAdminAccount(adminCookie, placeId, username, "goodpassword");
  assert.equal(second.status, 409);
});

test("a place admin cannot create a place", async () => {
  const placeId = await createPlace(adminCookie, `Place ${unique()}`);
  const placeAdminUsername = `placeadmin-${unique()}`;
  await createPlaceAdminAccount(adminCookie, placeId, placeAdminUsername, "goodpassword");
  const placeAdminCookie = (await loginAs(placeAdminUsername, "goodpassword")).cookie;

  const attempt = await api("/api/places", {
    method: "POST",
    headers: { Cookie: placeAdminCookie },
    body: JSON.stringify({ name: "Should not work", kind: "university" }),
  });
  assert.equal(attempt.status, 403);
});

test("a place admin's accounts list is scoped to their own place only", async () => {
  const placeA = await createPlace(adminCookie, `Place A ${unique()}`);
  const placeB = await createPlace(adminCookie, `Place B ${unique()}`);
  const placeAdminUsername = `placeadmin-${unique()}`;
  await createPlaceAdminAccount(adminCookie, placeA, placeAdminUsername, "goodpassword");
  const placeAdminCookie = (await loginAs(placeAdminUsername, "goodpassword")).cookie;

  const studentAUsername = `studentA-${unique()}`;
  const studentBUsername = `studentB-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username: studentAUsername, password: "goodpassword", email: `${studentAUsername}@example.com`, role: "student", placeId: placeA, program: "1", year: 1 }),
  });
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username: studentBUsername, password: "goodpassword", email: `${studentBUsername}@example.com`, role: "student", placeId: placeB, program: "1", year: 1 }),
  });

  const { status, body } = await api("/api/accounts", { headers: { Cookie: placeAdminCookie } });
  assert.equal(status, 200);
  const usernames = body.accounts.map((a) => a.username);
  assert.ok(usernames.includes(studentAUsername));
  assert.ok(!usernames.includes(studentBUsername));
});

test("the global admin's accounts list still includes every place", async () => {
  const placeId = await createPlace(adminCookie, `Place ${unique()}`);
  const username = `student-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password: "goodpassword", email: `${username}@example.com`, role: "student", placeId, program: "1", year: 1 }),
  });
  const { body } = await api("/api/accounts", { headers: { Cookie: adminCookie } });
  assert.ok(body.accounts.map((a) => a.username).includes(username));
  assert.ok(body.accounts.map((a) => a.username).includes("admin"));
});

test("a place admin can approve an editor of their own place", async () => {
  const placeId = await createPlace(adminCookie, `Place ${unique()}`);
  const placeAdminUsername = `placeadmin-${unique()}`;
  await createPlaceAdminAccount(adminCookie, placeId, placeAdminUsername, "goodpassword");
  const placeAdminCookie = (await loginAs(placeAdminUsername, "goodpassword")).cookie;

  const editorUsername = `editor-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username: editorUsername, password: "goodpassword", email: `${editorUsername}@example.com`, role: "editor", placeId }),
  });

  const approve = await api(`/api/editors/${editorUsername}/approve`, {
    method: "POST",
    headers: { Cookie: placeAdminCookie },
  });
  assert.equal(approve.status, 200);

  const editorLogin = await loginAs(editorUsername, "goodpassword");
  assert.equal(editorLogin.status, 200);
});

test("a place admin cannot approve an editor of a different place", async () => {
  const placeA = await createPlace(adminCookie, `Place A ${unique()}`);
  const placeB = await createPlace(adminCookie, `Place B ${unique()}`);
  const placeAdminUsername = `placeadmin-${unique()}`;
  await createPlaceAdminAccount(adminCookie, placeA, placeAdminUsername, "goodpassword");
  const placeAdminCookie = (await loginAs(placeAdminUsername, "goodpassword")).cookie;

  const editorUsername = `editorB-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username: editorUsername, password: "goodpassword", email: `${editorUsername}@example.com`, role: "editor", placeId: placeB }),
  });

  const approve = await api(`/api/editors/${editorUsername}/approve`, {
    method: "POST",
    headers: { Cookie: placeAdminCookie },
  });
  assert.equal(approve.status, 403);

  // Confirm it is genuinely still pending, not approved.
  const stillPending = await loginAs(editorUsername, "goodpassword");
  assert.equal(stillPending.status, 403);
  assert.equal(stillPending.body.reason, "pending");
});

test("a place admin cannot reject an editor of a different place", async () => {
  const placeA = await createPlace(adminCookie, `Place A ${unique()}`);
  const placeB = await createPlace(adminCookie, `Place B ${unique()}`);
  const placeAdminUsername = `placeadmin-${unique()}`;
  await createPlaceAdminAccount(adminCookie, placeA, placeAdminUsername, "goodpassword");
  const placeAdminCookie = (await loginAs(placeAdminUsername, "goodpassword")).cookie;

  const editorUsername = `editorB-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username: editorUsername, password: "goodpassword", email: `${editorUsername}@example.com`, role: "editor", placeId: placeB }),
  });

  const reject = await api(`/api/editors/${editorUsername}/reject`, {
    method: "POST",
    headers: { Cookie: placeAdminCookie },
  });
  assert.equal(reject.status, 403);
});

test("a place admin can reset a password for an account in their own place", async () => {
  const placeId = await createPlace(adminCookie, `Place ${unique()}`);
  const placeAdminUsername = `placeadmin-${unique()}`;
  await createPlaceAdminAccount(adminCookie, placeId, placeAdminUsername, "goodpassword");
  const placeAdminCookie = (await loginAs(placeAdminUsername, "goodpassword")).cookie;

  const studentUsername = `student-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username: studentUsername, password: "goodpassword", email: `${studentUsername}@example.com`, role: "student", placeId, program: "1", year: 1 }),
  });

  const reset = await api(`/api/accounts/${studentUsername}/reset-password`, {
    method: "POST",
    headers: { Cookie: placeAdminCookie },
  });
  assert.equal(reset.status, 200);
  assert.ok(reset.body.temporaryPassword);
});

test("a place admin cannot reset a password for an account in a different place", async () => {
  const placeA = await createPlace(adminCookie, `Place A ${unique()}`);
  const placeB = await createPlace(adminCookie, `Place B ${unique()}`);
  const placeAdminUsername = `placeadmin-${unique()}`;
  await createPlaceAdminAccount(adminCookie, placeA, placeAdminUsername, "goodpassword");
  const placeAdminCookie = (await loginAs(placeAdminUsername, "goodpassword")).cookie;

  const studentUsername = `studentB-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username: studentUsername, password: "goodpassword", email: `${studentUsername}@example.com`, role: "student", placeId: placeB, program: "1", year: 1 }),
  });

  const reset = await api(`/api/accounts/${studentUsername}/reset-password`, {
    method: "POST",
    headers: { Cookie: placeAdminCookie },
  });
  assert.equal(reset.status, 403);
});

test("resetting the password of an unknown username returns 404 for a place admin too", async () => {
  const placeId = await createPlace(adminCookie, `Place ${unique()}`);
  const placeAdminUsername = `placeadmin-${unique()}`;
  await createPlaceAdminAccount(adminCookie, placeId, placeAdminUsername, "goodpassword");
  const placeAdminCookie = (await loginAs(placeAdminUsername, "goodpassword")).cookie;

  const reset = await api(`/api/accounts/${unique()}/reset-password`, {
    method: "POST",
    headers: { Cookie: placeAdminCookie },
  });
  assert.equal(reset.status, 404);
});
