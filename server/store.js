/**
 * Places, accounts, sessions, and the schedule published per place - now
 * backed by Postgres (`server/db.js`) instead of the single JSON file the
 * classroom-grade version of this server kept: a production deployment
 * needs real concurrency safety, backups, and data that survives a redeploy
 * on a host whose own filesystem is not persistent.
 *
 * A password is never stored as typed: `hashPassword` salts and hashes it
 * with scrypt, so a database dump does not hand out anyone's password.
 * Login also now tracks failed attempts and locks an account out for a
 * cooldown after too many, and every session carries an expiry that is
 * pushed forward on use rather than lasting until the server happens to
 * restart. See `server/index.js`'s header for the rest of what this does
 * and does not secure.
 */

const crypto = require("crypto");
const { pool } = require("./db");

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;
const SESSION_TTL_HOURS = 24;

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

function rowToAccount(row) {
  return {
    username: row.username,
    password: row.password,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    placeId: row.place_id,
    instructorNames: row.instructor_names ?? undefined,
    program: row.program ?? undefined,
    year: row.year ?? undefined,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    mustChangePassword: row.must_change_password,
  };
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
  const { rows } = await pool.query("SELECT * FROM accounts WHERE username = $1", [username]);
  return rows[0] ? rowToAccount(rows[0]) : null;
}

async function findPlace(placeId) {
  const { rows } = await pool.query("SELECT * FROM places WHERE id = $1", [placeId]);
  return rows[0] ?? null;
}

/** True while the account is locked out from a run of failed logins. */
function isLocked(account) {
  return Boolean(account.lockedUntil && new Date(account.lockedUntil) > new Date());
}

async function recordFailedLogin(username) {
  const { rows } = await pool.query(
    `UPDATE accounts SET failed_attempts = failed_attempts + 1 WHERE username = $1 RETURNING failed_attempts`,
    [username]
  );
  const attempts = rows[0]?.failed_attempts ?? 0;
  if (attempts >= LOCKOUT_THRESHOLD) {
    await pool.query(
      `UPDATE accounts SET locked_until = now() + ($2 || ' minutes')::interval WHERE username = $1`,
      [username, LOCKOUT_MINUTES]
    );
  }
}

async function recordSuccessfulLogin(username) {
  await pool.query(
    `UPDATE accounts SET failed_attempts = 0, locked_until = NULL WHERE username = $1`,
    [username]
  );
}

async function createSession(username) {
  const token = crypto.randomUUID();
  await pool.query(
    `INSERT INTO sessions (token, username, expires_at) VALUES ($1, $2, now() + ($3 || ' hours')::interval)`,
    [token, username, SESSION_TTL_HOURS]
  );
  return token;
}

/** Resolves a bearer token to its account, sliding the session's expiry forward on every use; null for no session, an expired one, or a since-deleted account. */
async function accountForToken(token) {
  const { rows } = await pool.query(
    `UPDATE sessions SET expires_at = now() + ($2 || ' hours')::interval
     WHERE token = $1 AND expires_at > now()
     RETURNING username`,
    [token, SESSION_TTL_HOURS]
  );
  if (!rows[0]) return null;
  return findAccount(rows[0].username);
}

async function deleteSession(token) {
  await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
}

/** Signs an account out of every device it is currently signed in on - used after a password reset. */
async function revokeAllSessions(username) {
  await pool.query("DELETE FROM sessions WHERE username = $1", [username]);
}

module.exports = {
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
  revokeAllSessions,

  async listPlaces() {
    const { rows } = await pool.query("SELECT id, name, kind FROM places ORDER BY name");
    return rows;
  },

  async addPlace(name, kind) {
    const id = crypto.randomUUID();
    await pool.query("INSERT INTO places (id, name, kind) VALUES ($1, $2, $3)", [id, name, kind]);
    return { id, name, kind };
  },

  async listAccounts() {
    const { rows } = await pool.query("SELECT * FROM accounts ORDER BY username");
    return rows.map((row) => publicAccount(rowToAccount(row)));
  },

  /** `role` is "editor", "teacher" or "student" - never "admin", which nobody registers into. */
  async register(username, password, displayName, role, placeId, extra) {
    if (await findAccount(username)) return false;
    if (!(await findPlace(placeId))) return false;
    const status = role === "editor" ? "pending" : "approved";
    const instructorNames = role === "teacher" ? JSON.stringify(extra?.instructorNames ?? []) : null;
    const program = role === "student" ? extra?.program ?? "" : null;
    const year = role === "student" ? extra?.year ?? 1 : null;
    await pool.query(
      `INSERT INTO accounts (username, password, display_name, role, status, place_id, instructor_names, program, year)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [username, hashPassword(password), displayName, role, status, placeId, instructorNames, program, year]
    );
    return true;
  },

  async setEditorStatus(username, status) {
    const { rowCount } = await pool.query(
      "UPDATE accounts SET status = $2 WHERE username = $1 AND role = 'editor'",
      [username, status]
    );
    return rowCount > 0;
  },

  async removeAccount(username) {
    const { rowCount } = await pool.query("DELETE FROM accounts WHERE username = $1", [username]);
    return rowCount > 0;
  },

  /** Returns the new temporary password on success, so the caller (an admin) can relay it out of band. Also signs the account out everywhere. */
  async resetPassword(username) {
    const account = await findAccount(username);
    if (!account || account.role === "admin") return null;
    const temp = randomTempPassword();
    await pool.query(
      "UPDATE accounts SET password = $2, must_change_password = TRUE, failed_attempts = 0, locked_until = NULL WHERE username = $1",
      [username, hashPassword(temp)]
    );
    await revokeAllSessions(username);
    return temp;
  },

  async clearMustChangePassword(username) {
    await pool.query("UPDATE accounts SET must_change_password = FALSE WHERE username = $1", [username]);
  },

  async changePassword(username, newPassword) {
    await pool.query(
      "UPDATE accounts SET password = $2, must_change_password = FALSE WHERE username = $1",
      [username, hashPassword(newPassword)]
    );
    await revokeAllSessions(username);
  },

  async getPublished(placeId) {
    const { rows } = await pool.query("SELECT schedule FROM published_schedules WHERE place_id = $1", [placeId]);
    return rows[0]?.schedule ?? null;
  },

  async setPublished(placeId, published) {
    await pool.query(
      `INSERT INTO published_schedules (place_id, schedule) VALUES ($1, $2)
       ON CONFLICT (place_id) DO UPDATE SET schedule = EXCLUDED.schedule`,
      [placeId, JSON.stringify(published)]
    );
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
    await pool.query(
      `INSERT INTO accounts (username, password, display_name, role, status, place_id)
       VALUES ('admin', $1, 'Admin', 'admin', 'approved', NULL)`,
      [hashPassword(password)]
    );
    return process.env.ADMIN_PASSWORD ? null : password;
  },

  /** Fixed, publicly-known demo accounts - opt-in only (SEED_DEMO_ACCOUNTS=true), for a classroom trial or staging environment, never production. */
  async seedDemoAccounts() {
    if (process.env.SEED_DEMO_ACCOUNTS !== "true") return;
    if (await findPlace("demo")) return;
    await pool.query("INSERT INTO places (id, name, kind) VALUES ('demo', 'Demo Faculty', 'university')");
    const demo = [
      ["editor", "editor123", "Demo Editor", "editor", "approved", "demo", null, null, null],
      ["teacher", "teacher123", "Demo Teacher", "teacher", "approved", "demo", JSON.stringify(["Dr. A. Levi"]), null, null],
      ["student", "student123", "Demo Student", "student", "approved", "demo", null, "83101", 1],
    ];
    for (const [username, password, displayName, role, status, placeId, instructorNames, program, year] of demo) {
      await pool.query(
        `INSERT INTO accounts (username, password, display_name, role, status, place_id, instructor_names, program, year)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [username, hashPassword(password), displayName, role, status, placeId, instructorNames, program, year]
      );
    }
  },
};
