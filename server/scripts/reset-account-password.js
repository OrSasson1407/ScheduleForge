#!/usr/bin/env node
/**
 * Recovery tool for when an account's password is lost and nobody signed in
 * can reset it through the app itself - most notably the global admin, whose
 * password `store.js`'s own `resetPassword` deliberately refuses to touch
 * (see its comment), since letting a place admin reset the global admin's
 * password through the UI would be a privilege escalation. This script
 * exists precisely for the one case that restriction doesn't cover: the
 * account's own owner, locked out with no other admin to ask.
 *
 * Run locally, pointed at whichever database you mean to change - same
 * environment variables `server/index.js` itself reads (`FIREBASE_SERVICE_ACCOUNT`
 * for production, or `FIRESTORE_EMULATOR_HOST`/`FIREBASE_PROJECT_ID` for the
 * emulator). Nothing here is wired into the running server or any HTTP route;
 * it's a one-off, deliberately outside the app's normal request handling.
 *
 * Usage (from server/):
 *   FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/reset-account-password.js <username> <newPassword>
 */

const store = require("../store");
const { checkStrength } = require("../passwordPolicy");
const { db } = require("../db");

const MIN_PASSWORD_LENGTH = 8; // matches server/index.js's own MIN_PASSWORD_LENGTH

async function main() {
  const [username, newPassword] = process.argv.slice(2);
  if (!username || !newPassword) {
    console.error("Usage: node scripts/reset-account-password.js <username> <newPassword>");
    process.exit(1);
  }

  const account = await store.findAccount(username);
  if (!account) {
    console.error(`No account named "${username}" exists.`);
    process.exit(1);
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }
  const weakness = checkStrength(newPassword, username);
  if (weakness) {
    console.error(`Rejected: ${weakness}`);
    process.exit(1);
  }

  await db.collection("accounts").doc(username).update({
    password: store.hashPassword(newPassword),
    mustChangePassword: false,
    failedAttempts: 0,
    lockedUntil: null,
    // Deliberately not touching previousPasswords here - this is a recovery
    // path taken because the password was forgotten, not a normal change, so
    // there is nothing useful to remember it *as* a reuse candidate against.
  });
  await store.revokeAllSessions(username);

  console.log(`Password reset for "${username}" (role: ${account.role}). Every existing session for this account was signed out.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
