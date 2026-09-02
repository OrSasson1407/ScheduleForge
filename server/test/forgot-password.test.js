/**
 * Integration tests for POST /api/forgot-password and
 * POST /api/reset-password/confirm. RESEND_API_KEY is unset here (as in
 * every CI run), so `sendPasswordResetEmail` only ever logs its link - these
 * tests exercise the token/database logic directly (via `store.js` and
 * `db.js`, the same modules the HTTP handlers use) rather than real email
 * delivery, which nothing in this project can assert on anyway.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.PORT = "8792";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.ALLOWED_ORIGIN = "*";
process.env.SEED_DEMO_ACCOUNTS = "false";
process.env.REGISTER_RATE_LIMIT = "1000";
process.env.LOGIN_RATE_LIMIT = "1000";
process.env.FORGOT_PASSWORD_RATE_LIMIT = "3";

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

let serverModule;
let store;
let db;
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
  store = require("../store");
  db = require("../db").db;

  const adminLogin = await loginAs("admin", process.env.ADMIN_PASSWORD);
  const place = await api("/api/places", {
    method: "POST",
    headers: { Cookie: adminLogin.cookie },
    body: JSON.stringify({ name: `Forgot Password Place ${unique()}`, kind: "university" }),
  });
  placeId = place.body.place.id;
});

after(() => {
  serverModule.wss.close();
  serverModule.server.close();
});

async function freshAccount(email) {
  const username = `forgot-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({
      username,
      password: "original-unusual-pw-1",
      email,
      role: "student",
      placeId,
      program: "1",
      year: 1,
    }),
  });
  return username;
}

test("forgot-password always returns 200, whether or not the email matches an account", async () => {
  const noMatch = await api("/api/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email: `nobody-${unique()}@example.com` }),
  });
  assert.equal(noMatch.status, 200);
  assert.equal(noMatch.body.ok, true);

  const email = `match-${unique()}@example.com`;
  await freshAccount(email);
  const match = await api("/api/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
  assert.equal(match.status, 200);
  assert.deepEqual(match.body, noMatch.body); // identical response shape either way
});

test("forgot-password tolerates a missing email without crashing", async () => {
  const { status, body } = await api("/api/forgot-password", { method: "POST", body: JSON.stringify({}) });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});

test("forgot-password is rate limited per IP", async () => {
  for (let i = 0; i < 3; i++) {
    const { status } = await api("/api/forgot-password", {
      method: "POST",
      headers: { "X-Forwarded-For": "10.1.0.1" },
      body: JSON.stringify({ email: `x-${unique()}@example.com` }),
    });
    assert.notEqual(status, 429, `attempt ${i} should not be rate limited yet`);
  }
  const { status } = await api("/api/forgot-password", {
    method: "POST",
    headers: { "X-Forwarded-For": "10.1.0.1" },
    body: JSON.stringify({ email: `x-${unique()}@example.com` }),
  });
  assert.equal(status, 429);
});

test("a valid reset token actually resets the password and can be used to sign in", async () => {
  const username = await freshAccount(`reset-${unique()}@example.com`);
  const token = await store.createPasswordReset(username);

  const confirm = await api("/api/reset-password/confirm", {
    method: "POST",
    body: JSON.stringify({ token, newPassword: "brand-new-unusual-pw-2" }),
  });
  assert.equal(confirm.status, 200);

  const login = await loginAs(username, "brand-new-unusual-pw-2");
  assert.equal(login.status, 200);
});

test("a reset token can only be used once", async () => {
  const username = await freshAccount(`onceonly-${unique()}@example.com`);
  const token = await store.createPasswordReset(username);

  const first = await api("/api/reset-password/confirm", {
    method: "POST",
    body: JSON.stringify({ token, newPassword: "first-unusual-pw-2" }),
  });
  assert.equal(first.status, 200);

  const second = await api("/api/reset-password/confirm", {
    method: "POST",
    body: JSON.stringify({ token, newPassword: "second-unusual-pw-3" }),
  });
  assert.equal(second.status, 400);
});

test("an unknown reset token is rejected", async () => {
  const { status, body } = await api("/api/reset-password/confirm", {
    method: "POST",
    body: JSON.stringify({ token: crypto.randomUUID(), newPassword: "whatever-unusual-pw-1" }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /invalid|expired/i);
});

test("an expired reset token is rejected", async () => {
  const username = await freshAccount(`expired-${unique()}@example.com`);
  const token = crypto.randomUUID();
  await db.collection("passwordResets").doc(token).set({
    username,
    used: false,
    expiresAt: new Date(Date.now() - 60_000).toISOString(), // a minute in the past
  });

  const { status } = await api("/api/reset-password/confirm", {
    method: "POST",
    body: JSON.stringify({ token, newPassword: "whatever-unusual-pw-1" }),
  });
  assert.equal(status, 400);
});

test("reset-password/confirm still enforces password strength", async () => {
  const username = await freshAccount(`weak-${unique()}@example.com`);
  const token = await store.createPasswordReset(username);
  const { status, body } = await api("/api/reset-password/confirm", {
    method: "POST",
    body: JSON.stringify({ token, newPassword: "password123" }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /common/i);
});

test("reset-password/confirm still enforces password history", async () => {
  const username = await freshAccount(`history-${unique()}@example.com`);
  const token = await store.createPasswordReset(username);
  const { status, body } = await api("/api/reset-password/confirm", {
    method: "POST",
    body: JSON.stringify({ token, newPassword: "original-unusual-pw-1" }), // same as at registration
  });
  assert.equal(status, 400);
  assert.match(body.error, /recent/i);
});

test("a successful reset revokes every existing session", async () => {
  const username = await freshAccount(`revoke-${unique()}@example.com`);
  const oldSession = (await loginAs(username, "original-unusual-pw-1")).cookie;

  const token = await store.createPasswordReset(username);
  await api("/api/reset-password/confirm", {
    method: "POST",
    body: JSON.stringify({ token, newPassword: "after-reset-unusual-pw-2" }),
  });

  const stillSignedIn = await api("/api/me", { headers: { Cookie: oldSession } });
  assert.equal(stillSignedIn.status, 401);
});
