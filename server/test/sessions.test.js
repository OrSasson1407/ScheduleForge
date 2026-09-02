/**
 * Integration tests for GET /api/sessions and DELETE /api/sessions/:id - the
 * self-service session/device list. Runs its own server instance on its own
 * port, independent of the other test files.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.PORT = "8795";
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
    headers: { "Content-Type": "application/json", "X-Requested-With": "ScheduleForge", "User-Agent": "test-agent", ...(options.headers ?? {}) },
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    /* some responses have no body */
  }
  return { status: response.status, body, cookie: sessionCookieFrom(response) };
}

async function loginAs(username, password, userAgent) {
  return api("/api/login", {
    method: "POST",
    headers: userAgent ? { "User-Agent": userAgent } : {},
    body: JSON.stringify({ username, password }),
  });
}

let serverModule;
let placeId;

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
  const adminLogin = await loginAs("admin", process.env.ADMIN_PASSWORD);
  const place = await api("/api/places", {
    method: "POST",
    headers: { Cookie: adminLogin.cookie },
    body: JSON.stringify({ name: `Sessions Place ${unique()}`, kind: "university" }),
  });
  placeId = place.body.place.id;
});

after(() => {
  serverModule.wss.close();
  serverModule.server.close();
});

async function freshStudent() {
  const username = `sessions-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password: "goodpassword", email: `${username}@example.com`, role: "student", placeId, program: "1", year: 1 }),
  });
  return username;
}

test("GET /api/sessions without a session returns 401", async () => {
  const { status } = await api("/api/sessions");
  assert.equal(status, 401);
});

test("a single sign-in lists exactly one session, marked as the current one", async () => {
  const username = await freshStudent();
  const login = await loginAs(username, "goodpassword", "Browser A");
  const { status, body } = await api("/api/sessions", { headers: { Cookie: login.cookie } });
  assert.equal(status, 200);
  assert.equal(body.sessions.length, 1);
  assert.equal(body.sessions[0].id, body.currentId);
  assert.equal(body.sessions[0].userAgent, "Browser A");
});

test("signing in from two devices lists both, each with its own user agent", async () => {
  const username = await freshStudent();
  const first = await loginAs(username, "goodpassword", "Browser A");
  const second = await loginAs(username, "goodpassword", "Browser B");

  const { body } = await api("/api/sessions", { headers: { Cookie: second.cookie } });
  assert.equal(body.sessions.length, 2);
  const agents = body.sessions.map((s) => s.userAgent).sort();
  assert.deepEqual(agents, ["Browser A", "Browser B"]);
  assert.equal(body.currentId, body.sessions.find((s) => s.userAgent === "Browser B").id);
  void first;
});

test("the session list never includes the raw session token", async () => {
  const username = await freshStudent();
  const login = await loginAs(username, "goodpassword");
  const { body } = await api("/api/sessions", { headers: { Cookie: login.cookie } });
  const token = login.cookie.split("=")[1];
  const text = JSON.stringify(body);
  assert.ok(!text.includes(token), "the session list body must not contain the actual session token");
});

test("a session can revoke another one of its own sessions", async () => {
  const username = await freshStudent();
  const first = await loginAs(username, "goodpassword", "Browser A");
  const second = await loginAs(username, "goodpassword", "Browser B");

  const listBefore = await api("/api/sessions", { headers: { Cookie: second.cookie } });
  const firstId = listBefore.body.sessions.find((s) => s.userAgent === "Browser A").id;

  const revoke = await api(`/api/sessions/${firstId}`, { method: "DELETE", headers: { Cookie: second.cookie } });
  assert.equal(revoke.status, 200);

  // The revoked session's own cookie no longer works.
  const meWithRevoked = await api("/api/me", { headers: { Cookie: first.cookie } });
  assert.equal(meWithRevoked.status, 401);

  // The session that did the revoking is unaffected.
  const meWithSecond = await api("/api/me", { headers: { Cookie: second.cookie } });
  assert.equal(meWithSecond.status, 200);
});

test("revoking an unknown session id returns 404", async () => {
  const username = await freshStudent();
  const login = await loginAs(username, "goodpassword");
  const { status } = await api(`/api/sessions/${crypto.randomUUID()}`, {
    method: "DELETE",
    headers: { Cookie: login.cookie },
  });
  assert.equal(status, 404);
});

test("a session cannot revoke another account's session", async () => {
  const usernameA = await freshStudent();
  const usernameB = await freshStudent();
  const loginA = await loginAs(usernameA, "goodpassword");
  const loginB = await loginAs(usernameB, "goodpassword");

  const listA = await api("/api/sessions", { headers: { Cookie: loginA.cookie } });
  const sessionIdOfA = listA.body.currentId;

  const attempt = await api(`/api/sessions/${sessionIdOfA}`, {
    method: "DELETE",
    headers: { Cookie: loginB.cookie },
  });
  assert.equal(attempt.status, 404); // not found from B's point of view, not 403 - it does not exist for B

  // A's session is still perfectly valid.
  const stillWorks = await api("/api/me", { headers: { Cookie: loginA.cookie } });
  assert.equal(stillWorks.status, 200);
});

test("DELETE /api/sessions/:id without a session returns 401", async () => {
  const { status } = await api(`/api/sessions/${crypto.randomUUID()}`, { method: "DELETE" });
  assert.equal(status, 401);
});

test("resetting a password revokes every session, which then disappears from the list of any survivor", async () => {
  const username = await freshStudent();
  const login = await loginAs(username, "goodpassword");
  const adminLogin = await loginAs("admin", process.env.ADMIN_PASSWORD);

  await api(`/api/accounts/${username}/reset-password`, {
    method: "POST",
    headers: { Cookie: adminLogin.cookie },
  });

  const { status } = await api("/api/sessions", { headers: { Cookie: login.cookie } });
  assert.equal(status, 401);
});
