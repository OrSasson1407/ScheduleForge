/**
 * Tests of server/passwordPolicy.js directly (pure functions, no HTTP), plus
 * a handful of integration tests confirming /api/register and
 * /api/change-password actually enforce it. Requiring store.js (for
 * verifyPassword/hashPassword) touches server/db.js, which needs
 * FIRESTORE_EMULATOR_HOST set - the same as every other server test file, so
 * this still only runs inside `npm run test:ci`'s emulator wrapper, even
 * though the unit tests below never read or write Firestore themselves.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.PORT = "8794";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.ALLOWED_ORIGIN = "*";
process.env.SEED_DEMO_ACCOUNTS = "false";
process.env.REGISTER_RATE_LIMIT = "1000";
process.env.LOGIN_RATE_LIMIT = "1000";

const { checkStrength, wasUsedBefore } = require("../passwordPolicy");
const { hashPassword } = require("../store");

const unique = () => crypto.randomBytes(4).toString("hex");

test("checkStrength rejects a password on the common-password list", () => {
  assert.match(checkStrength("password123", "someone"), /common/i);
  assert.match(checkStrength("123456", "someone"), /common/i);
  assert.match(checkStrength("qwerty123", "someone"), /common/i);
});

test("checkStrength is case-insensitive about the common-password list", () => {
  assert.match(checkStrength("PASSWORD123", "someone"), /common/i);
  assert.match(checkStrength("QwErTy123", "someone"), /common/i);
});

test("checkStrength rejects a password that contains the username", () => {
  assert.match(checkStrength("brian-the-great99", "brian"), /username/i);
});

test("checkStrength rejects a password equal to the username", () => {
  assert.match(checkStrength("brian", "brian"), /username/i);
});

test("checkStrength does not flag a coincidental short substring of the username", () => {
  // A 1-2 character username is too short to meaningfully constrain anything;
  // the check should not reject ordinary passwords over such a trivial match.
  assert.equal(checkStrength("correct-horse-battery", "ab"), null);
});

test("checkStrength accepts a genuinely unusual password", () => {
  assert.equal(checkStrength("correct-horse-battery-staple-42", "someone"), null);
});

test("checkStrength username check is case-insensitive", () => {
  assert.match(checkStrength("xxBRIANxx", "brian"), /username/i);
});

test("wasUsedBefore is true when the password matches the current hash", () => {
  const hash = hashPassword("my-current-password");
  assert.equal(wasUsedBefore("my-current-password", hash, []), true);
});

test("wasUsedBefore is true when the password matches an older hash", () => {
  const current = hashPassword("current-one");
  const older = hashPassword("an-older-password");
  assert.equal(wasUsedBefore("an-older-password", current, [older]), true);
});

test("wasUsedBefore is false for a password that was never used", () => {
  const current = hashPassword("current-one");
  const older = hashPassword("an-older-password");
  assert.equal(wasUsedBefore("something-brand-new", current, [older]), false);
});

test("wasUsedBefore handles an empty or missing history", () => {
  const current = hashPassword("current-one");
  assert.equal(wasUsedBefore("something-else", current, []), false);
  assert.equal(wasUsedBefore("something-else", current, undefined), false);
});

function sessionCookieFrom(response) {
  const setCookie = response.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : null;
}

const base = `http://localhost:${process.env.PORT}`;

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
    body: JSON.stringify({ name: `Policy Place ${unique()}`, kind: "university" }),
  });
  placeId = place.body.place.id;
});

after(() => {
  serverModule.wss.close();
  serverModule.server.close();
});

test("registration rejects a common password even though it is long enough", async () => {
  const { status, body } = await api("/api/register", {
    method: "POST",
    body: JSON.stringify({
      username: `u-${unique()}`,
      password: "qwerty123",
      email: `u-${unique()}@example.com`,
      role: "student",
      placeId,
      program: "1",
      year: 1,
    }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /common/i);
});

test("registration rejects a password containing the username", async () => {
  const username = `carlos-${unique()}`;
  const { status, body } = await api("/api/register", {
    method: "POST",
    body: JSON.stringify({
      username,
      password: `${username}-2026-secure`,
      email: `${username}@example.com`,
      role: "student",
      placeId,
      program: "1",
      year: 1,
    }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /username/i);
});

test("change-password rejects reusing the current password", async () => {
  const username = `reuse-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password: "genuinely-unusual-pw-1", email: `${username}@example.com`, role: "student", placeId, program: "1", year: 1 }),
  });
  const login = await loginAs(username, "genuinely-unusual-pw-1");
  const { status, body } = await api("/api/change-password", {
    method: "POST",
    headers: { Cookie: login.cookie },
    body: JSON.stringify({ currentPassword: "genuinely-unusual-pw-1", newPassword: "genuinely-unusual-pw-1" }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /recent/i);
});

test("change-password rejects reverting to a password used two changes ago", async () => {
  const username = `history-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password: "original-unusual-pw-1", email: `${username}@example.com`, role: "student", placeId, program: "1", year: 1 }),
  });
  let login = await loginAs(username, "original-unusual-pw-1");
  await api("/api/change-password", {
    method: "POST",
    headers: { Cookie: login.cookie },
    body: JSON.stringify({ currentPassword: "original-unusual-pw-1", newPassword: "second-unusual-pw-2" }),
  });

  login = await loginAs(username, "second-unusual-pw-2");
  const attempt = await api("/api/change-password", {
    method: "POST",
    headers: { Cookie: login.cookie },
    body: JSON.stringify({ currentPassword: "second-unusual-pw-2", newPassword: "original-unusual-pw-1" }),
  });
  assert.equal(attempt.status, 400);
  assert.match(attempt.body.error, /recent/i);
});

test("change-password accepts a genuinely new password not in history", async () => {
  const username = `fresh-${unique()}`;
  await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password: "starting-unusual-pw-1", email: `${username}@example.com`, role: "student", placeId, program: "1", year: 1 }),
  });
  const login = await loginAs(username, "starting-unusual-pw-1");
  const { status } = await api("/api/change-password", {
    method: "POST",
    headers: { Cookie: login.cookie },
    body: JSON.stringify({ currentPassword: "starting-unusual-pw-1", newPassword: "brand-new-unusual-pw-9" }),
  });
  assert.equal(status, 200);
});
