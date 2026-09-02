/**
 * Integration tests for the rate limiting and account lockout behavior of
 * index.js. Uses its own low REGISTER_RATE_LIMIT/LOGIN_RATE_LIMIT (unlike the
 * other test files, which raise those limits to stay out of the way) and its
 * own port, so it runs independently of them.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.PORT = "8796";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.ALLOWED_ORIGIN = "*";
process.env.SEED_DEMO_ACCOUNTS = "false";
process.env.REGISTER_RATE_LIMIT = "3";
process.env.LOGIN_RATE_LIMIT = "3";

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
    /* no body */
  }
  return { status: response.status, body };
}

let serverModule;
let placeId;

before(async () => {
  serverModule = require("../index.js");
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // A distinct X-Forwarded-For keeps this setup call from eating into the
  // login-rate-limit budget that "login is rate limited..." below needs to
  // measure from a clean slate.
  const login = await api("/api/login", {
    method: "POST",
    headers: { "X-Forwarded-For": "10.0.0.200" },
    body: JSON.stringify({ username: "admin", password: process.env.ADMIN_PASSWORD }),
  });
  const place = await api("/api/places", {
    method: "POST",
    headers: { Authorization: `Bearer ${login.body.token}` },
    body: JSON.stringify({ name: `Rate Limit Place ${unique()}`, kind: "university" }),
  });
  placeId = place.body.place.id;
});

after(() => {
  serverModule.wss.close();
  serverModule.server.close();
});

test("registration is rate limited per IP after REGISTER_RATE_LIMIT attempts", async () => {
  for (let i = 0; i < 3; i++) {
    const { status } = await api("/api/register", {
      method: "POST",
      body: JSON.stringify({
        username: `burst-${unique()}`,
        password: "goodpassword",
        role: "student",
        placeId,
        program: "1",
        year: 1,
      }),
    });
    assert.notEqual(status, 429, `attempt ${i} should not be rate limited yet`);
  }
  const { status, body } = await api("/api/register", {
    method: "POST",
    body: JSON.stringify({
      username: `burst-${unique()}`,
      password: "goodpassword",
      role: "student",
      placeId,
      program: "1",
      year: 1,
    }),
  });
  assert.equal(status, 429);
  assert.match(body.error, /too many/i);
});

test("login is rate limited per IP after LOGIN_RATE_LIMIT attempts", async () => {
  for (let i = 0; i < 3; i++) {
    const { status } = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "wrong-on-purpose" }),
    });
    assert.notEqual(status, 429, `attempt ${i} should not be rate limited yet`);
  }
  const { status } = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "wrong-on-purpose" }),
  });
  assert.equal(status, 429);
});

test("an account locks out after enough failed login attempts, even under the login rate limit", async () => {
  // Register a fresh account so this test's failures cannot affect another test's admin lockout.
  // Its own X-Forwarded-For keeps it from being silently 429'd by the register-rate-limit
  // test above, which already exhausts the default IP's register budget.
  const username = `lockout-${unique()}`;
  const registered = await api("/api/register", {
    method: "POST",
    headers: { "X-Forwarded-For": "10.0.0.201" },
    body: JSON.stringify({
      username,
      password: "correct-password",
      role: "student",
      placeId,
      program: "1",
      year: 1,
    }),
  });
  assert.equal(registered.status, 201);

  // The IP-wide login rate limit (3, from this file's own env) is below the
  // 5-attempt lockout threshold, so each attempt needs a header identifying
  // a distinct "IP" via X-Forwarded-For to isolate the two mechanisms.
  const attempt = (n) =>
    api("/api/login", {
      method: "POST",
      headers: { "X-Forwarded-For": `10.0.0.${n}` },
      body: JSON.stringify({ username, password: "not-the-password" }),
    });

  for (let i = 1; i <= 4; i++) {
    const { status } = await attempt(i);
    assert.equal(status, 401, `attempt ${i} should be a plain wrong-password rejection`);
  }
  const fifth = await attempt(5);
  assert.equal(fifth.status, 401); // the 5th failure itself still just reports "invalid"

  const sixth = await api("/api/login", {
    method: "POST",
    headers: { "X-Forwarded-For": "10.0.0.6" },
    body: JSON.stringify({ username, password: "correct-password" }), // even the right password now
  });
  assert.equal(sixth.status, 403);
  assert.equal(sixth.body.reason, "locked");
});
