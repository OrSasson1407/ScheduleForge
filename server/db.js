/**
 * The Postgres connection this server runs on in production - replacing the
 * single `server/data.json` file the classroom-grade version of this server
 * used, which had no concurrency safety, no backups, and could not survive
 * a redeploy on a platform with an ephemeral filesystem (which is exactly
 * what a managed host like Render gives a web service's own disk).
 *
 * `DATABASE_URL` is required; there is no file-based fallback on purpose -
 * a production server should fail loudly at startup if it has nowhere to
 * put its data, not quietly fall back to something that will lose it.
 */

const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set - see server/.env.example");
}

// Managed Postgres (Render and similar) terminates TLS with a certificate
// that is not in Node's default trust store; the connection is still
// encrypted, just not verified against a public CA, which is the standard,
// documented tradeoff these platforms expect internal connections to make.
// Set DATABASE_SSL=disable for a local database that has no TLS at all.
const ssl = process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false };

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl });

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS places (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS accounts (
    username TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'teacher', 'student')),
    status TEXT NOT NULL CHECK (status IN ('approved', 'pending')),
    place_id TEXT REFERENCES places(id) ON DELETE CASCADE,
    instructor_names JSONB,
    program TEXT,
    year INTEGER,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE IF NOT EXISTS published_schedules (
    place_id TEXT PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
    schedule JSONB NOT NULL
  );
`;

async function migrate() {
  await pool.query(SCHEMA);
}

module.exports = { pool, migrate };
