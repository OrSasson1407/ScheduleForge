/**
 * Places, accounts, sessions, and the schedule published per place - kept in
 * Firestore (`server/db.js`) rather than Postgres, so a production
 * deployment has a database that is genuinely free indefinitely rather than
 * free for a 30-day trial.
 *
 * A password is never stored as typed: `hashPassword` salts and hashes it
 * with scrypt, so a database dump does not hand out anyone's password.
 * Login tracks failed attempts and locks an account out for a cooldown
 * after too many, and every session carries an expiry that is pushed
 * forward on use rather than lasting until the server happens to restart.
 * See `server/index.js`'s header for the rest of what this does and does
 * not secure.
 *
 * Collections: `places/{placeId}`, `accounts/{username}`,
 * `sessions/{token}`, `published/{placeId}`, `passwordResets/{token}`. An
 * account's document ID is its own username, so "does this username exist"
 * is a single document lookup rather than a query, and `.create()` (fails if
 * the document already exists) is what makes registering race-free without a
 * SQL unique constraint to fall back on.
 */

const crypto = require("crypto");
const { db } = require("./db");

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;
const SESSION_TTL_HOURS = 24;
const FIRESTORE_ALREADY_EXISTS = 6;
/** How many of an account's previous passwords `changePassword` refuses to reuse. */
const PASSWORD_HISTORY_LENGTH = 5;
/** How long a forgot-password link stays usable. */
const PASSWORD_RESET_TTL_HOURS = 1;

const accounts = () => db.collection("accounts");
const places = () => db.collection("places");
const sessions = () => db.collection("sessions");
const published = () => db.collection("published");
const passwordResets = () => db.collection("passwordResets");

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

/** Short enough to read out loud or type from a note, random enough not to guess. */
function randomTempPassword() {
  return crypto.randomBytes(6).toString("hex");
}

function accountFromDoc(doc) {
  if (!doc.exists) return null;
  return { username: doc.id, ...doc.data() };
}

function publicAccount(account) {
  return {
    username: account.username,
    displayName: account.displayName,
    role: account.role,
    status: account.status,
    placeId: account.placeId ?? null,
    mustChangePassword: account.mustChangePassword,
    ...(account.role === "teacher" ? { instructorNames: account.instructorNames ?? [] } : {}),
    ...(account.role === "student" ? { program: account.program ?? null, year: account.year ?? null } : {}),
  };
}

async function findAccount(username) {
  return accountFromDoc(await accounts().doc(username).get());
}

/** Null for no match - callers must not reveal which case it was (see /api/forgot-password). */
async function findAccountByEmail(email) {
  const snapshot = await accounts().where("email", "==", email).limit(1).get();
  return snapshot.empty ? null : accountFromDoc(snapshot.docs[0]);
}

async function findPlace(placeId) {
  const doc = await places().doc(placeId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

/** True while the account is locked out from a run of failed logins. */
function isLocked(account) {
  return Boolean(account.lockedUntil && new Date(account.lockedUntil) > new Date());
}

async function recordFailedLogin(username) {
  const ref = accounts().doc(username);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) return;
    const attempts = (doc.data().failedAttempts ?? 0) + 1;
    const update = { failedAttempts: attempts };
    if (attempts >= LOCKOUT_THRESHOLD) {
      update.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
    }
    tx.update(ref, update);
  });
}

async function recordSuccessfulLogin(username) {
  await accounts().doc(username).update({ failedAttempts: 0, lockedUntil: null });
}

/**
 * `id` is a second, separate random value from the token itself: the session
 * list (`listSessions`) has to show the caller something to identify and
 * revoke a session by, but the token is a live credential - handing it back
 * in a list response would let anyone who can read their own session list
 * reconstruct a bearer credential for a session that is not "the current
 * request", which the cookie-only transport is specifically meant to avoid.
 */
async function createSession(username, userAgent) {
  const token = crypto.randomUUID();
  const id = crypto.randomUUID();
  await sessions()
    .doc(token)
    .set({
      id,
      username,
      userAgent: userAgent || "unknown",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 3600_000).toISOString(),
    });
  return token;
}

/** Resolves a bearer token to its account, sliding the session's expiry forward on every use; null for no session, an expired one, or a since-deleted account. */
async function accountForToken(token) {
  const ref = sessions().doc(token);
  const username = await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) return null;
    const data = doc.data();
    if (new Date(data.expiresAt) <= new Date()) return null;
    tx.update(ref, { expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 3600_000).toISOString() });
    return data.username;
  });
  return username ? findAccount(username) : null;
}

async function deleteSession(token) {
  await sessions().doc(token).delete();
}

/** The session's own `id` (not the token itself - see `createSession`), for marking "this device" in the session list. Null for an expired or unknown token, the same as `accountForToken`. */
async function sessionIdFor(token) {
  const doc = await sessions().doc(token).get();
  return doc.exists ? doc.data().id : null;
}

/** Every active session of an account, newest first - never the token itself, only what a person recognizes their own device by. */
async function listSessions(username) {
  const snapshot = await sessions().where("username", "==", username).get();
  return snapshot.docs
    .map((doc) => doc.data())
    .filter((data) => new Date(data.expiresAt) > new Date())
    .map((data) => ({ id: data.id, userAgent: data.userAgent, createdAt: data.createdAt }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Deletes one session by its public `id`, but only when it belongs to `username` - the ownership check that stops a user revoking a session that is not theirs. True if a session was actually removed. */
async function revokeSession(username, id) {
  const snapshot = await sessions().where("username", "==", username).where("id", "==", id).limit(1).get();
  if (snapshot.empty) return false;
  await snapshot.docs[0].ref.delete();
  return true;
}

/** Signs an account out of every device it is currently signed in on - used after a password reset. */
async function revokeAllSessions(username) {
  const snapshot = await sessions().where("username", "==", username).get();
  const batch = db.batch();
  snapshot.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

module.exports = {
  SESSION_TTL_HOURS,
  hashPassword,
  verifyPassword,
  findAccount,
  findPlace,
  publicAccount,
  isLocked,
  recordFailedLogin,
  recordSuccessfulLogin,
  createSession,
  accountForToken,
  deleteSession,
  sessionIdFor,
  listSessions,
  revokeSession,
  revokeAllSessions,
  findAccountByEmail,

  async listPlaces() {
    const snapshot = await places().get();
    return snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async addPlace(name, kind) {
    const id = crypto.randomUUID();
    await places().doc(id).set({ name, kind });
    return { id, name, kind };
  },

  /** Every account, or - for a place admin - only the ones that belong to `placeId`. */
  async listAccounts(placeId) {
    const query = placeId ? accounts().where("placeId", "==", placeId) : accounts();
    const snapshot = await query.get();
    return snapshot.docs
      .map((doc) => publicAccount(accountFromDoc(doc)))
      .sort((a, b) => a.username.localeCompare(b.username));
  },

  /** `role` is "editor", "teacher" or "student" - never "admin", which nobody registers into. */
  async register(username, password, displayName, role, placeId, email, extra) {
    if (!(await findPlace(placeId))) return false;
    const account = {
      password: hashPassword(password),
      displayName,
      role,
      placeId,
      email,
      status: role === "editor" ? "pending" : "approved",
      failedAttempts: 0,
      lockedUntil: null,
      mustChangePassword: false,
      previousPasswords: [],
      instructorNames: role === "teacher" ? extra?.instructorNames ?? [] : undefined,
      program: role === "student" ? extra?.program ?? "" : undefined,
      year: role === "student" ? extra?.year ?? 1 : undefined,
    };
    try {
      await accounts().doc(username).create(account);
      return true;
    } catch (error) {
      if (error.code === FIRESTORE_ALREADY_EXISTS) return false;
      throw error;
    }
  },

  /**
   * A `placeAdmin` account, scoped to one place - only the global admin can
   * create one (`server/index.js`'s route checks that, not this function).
   * Unlike `register`, there is no pending status: an admin creating another
   * admin does not need to approve themselves.
   */
  async createPlaceAdmin(username, password, displayName, placeId) {
    if (!(await findPlace(placeId))) return false;
    const account = {
      password: hashPassword(password),
      displayName,
      role: "placeAdmin",
      placeId,
      status: "approved",
      failedAttempts: 0,
      lockedUntil: null,
      mustChangePassword: false,
      previousPasswords: [],
    };
    try {
      await accounts().doc(username).create(account);
      return true;
    } catch (error) {
      if (error.code === FIRESTORE_ALREADY_EXISTS) return false;
      throw error;
    }
  },

  async setEditorStatus(username, status) {
    const ref = accounts().doc(username);
    return db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists || doc.data().role !== "editor") return false;
      tx.update(ref, { status });
      return true;
    });
  },

  async removeAccount(username) {
    const ref = accounts().doc(username);
    const doc = await ref.get();
    if (!doc.exists) return false;
    await ref.delete();
    return true;
  },

  /** Returns the new temporary password on success, so the caller (an admin) can relay it out of band. Also signs the account out everywhere. */
  async resetPassword(username) {
    const account = await findAccount(username);
    if (!account || account.role === "admin") return null;
    const temp = randomTempPassword();
    await accounts().doc(username).update({
      password: hashPassword(temp),
      mustChangePassword: true,
      failedAttempts: 0,
      lockedUntil: null,
    });
    await revokeAllSessions(username);
    return temp;
  },

  async clearMustChangePassword(username) {
    await accounts().doc(username).update({ mustChangePassword: false });
  },

  /**
   * The outgoing password hash is pushed onto `previousPasswords` (newest
   * first, capped at `PASSWORD_HISTORY_LENGTH`) before it is overwritten, so
   * a later change can refuse to let this exact password come back - see
   * `server/passwordPolicy.js`'s `wasUsedBefore`, checked by the caller
   * before this is ever reached.
   */
  async changePassword(username, newPassword) {
    const account = await findAccount(username);
    const previousPasswords = [account.password, ...(account.previousPasswords ?? [])].slice(
      0,
      PASSWORD_HISTORY_LENGTH
    );
    await accounts().doc(username).update({
      password: hashPassword(newPassword),
      mustChangePassword: false,
      previousPasswords,
    });
    await revokeAllSessions(username);
  },

  /** A one-hour, single-use reset link's token for `username`, for `sendPasswordResetEmail` (`server/email.js`) to mail out. */
  async createPasswordReset(username) {
    const token = crypto.randomUUID();
    await passwordResets()
      .doc(token)
      .set({
        username,
        used: false,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_HOURS * 3600_000).toISOString(),
      });
    return token;
  },

  /** The username a reset token is for, marking it used in the same breath so it cannot be replayed - or null for an unknown, expired or already-used one. */
  async consumePasswordReset(token) {
    const ref = passwordResets().doc(token);
    return db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return null;
      const data = doc.data();
      if (data.used || new Date(data.expiresAt) <= new Date()) return null;
      tx.update(ref, { used: true });
      return data.username;
    });
  },

  async getPublished(placeId) {
    const doc = await published().doc(placeId).get();
    return doc.exists ? doc.data().schedule : null;
  },

  async setPublished(placeId, schedule) {
    await published().doc(placeId).set({ schedule });
  },

  /**
   * A bootstrap admin account, created only if none exists yet. Its password
   * comes from ADMIN_PASSWORD; if that is not set, a random one is generated
   * and returned so the caller can log it once - never invented silently and
   * never left unlogged, since that would be a password nobody can ever use.
   */
  async ensureBootstrapAdmin() {
    if (await findAccount("admin")) return null;
    const password = process.env.ADMIN_PASSWORD || randomTempPassword();
    try {
      await accounts().doc("admin").create({
        password: hashPassword(password),
        displayName: "Admin",
        role: "admin",
        status: "approved",
        placeId: null,
        failedAttempts: 0,
        lockedUntil: null,
        mustChangePassword: false,
        previousPasswords: [],
      });
    } catch (error) {
      if (error.code === FIRESTORE_ALREADY_EXISTS) return null; // lost a startup race with another instance; fine
      throw error;
    }
    return process.env.ADMIN_PASSWORD ? null : password;
  },

  /** Fixed, publicly-known demo accounts - opt-in only (SEED_DEMO_ACCOUNTS=true), for a classroom trial or staging environment, never production. */
  async seedDemoAccounts() {
    if (process.env.SEED_DEMO_ACCOUNTS !== "true") return;
    if (await findPlace("demo")) return;
    const batch = db.batch();
    batch.set(places().doc("demo"), { name: "Demo Faculty", kind: "university" });
    const demo = [
      ["editor", "editor123", "Demo Editor", "editor", undefined, undefined, undefined],
      ["teacher", "teacher123", "Demo Teacher", "teacher", ["Dr. A. Levi"], undefined, undefined],
      ["student", "student123", "Demo Student", "student", undefined, "83101", 1],
    ];
    for (const [username, password, displayName, role, instructorNames, program, year] of demo) {
      batch.set(accounts().doc(username), {
        password: hashPassword(password),
        displayName,
        role,
        placeId: "demo",
        status: "approved",
        failedAttempts: 0,
        lockedUntil: null,
        mustChangePassword: false,
        previousPasswords: [],
        instructorNames,
        program,
        year,
      });
    }
    await batch.commit();
  },
};
