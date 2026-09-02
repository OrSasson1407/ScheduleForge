/**
 * The Firestore connection this server runs on - replacing Postgres, which
 * had no truly free tier that did not expire (Render's free database is
 * deleted 30 days after creation). Firebase's Spark plan is free with no
 * card and no expiration, at daily limits (50K reads, 20K writes, 20K
 * deletes, 1 GiB storage) far past anything a handful of institutions'
 * worth of accounts and one schedule per place would ever reach.
 *
 * Two ways to reach it, chosen by which environment variable is set:
 *
 *   - `FIRESTORE_EMULATOR_HOST` (e.g. "localhost:8080") - local development
 *     and CI, talking to the Firebase Local Emulator Suite. No real Google
 *     Cloud project or credentials needed at all; `FIREBASE_PROJECT_ID` can
 *     be any string in this mode, since nothing real is being addressed.
 *   - `FIREBASE_SERVICE_ACCOUNT` - production, the full JSON key of a
 *     Firebase service account (Project Settings -> Service Accounts ->
 *     Generate new private key), pasted as one environment variable rather
 *     than a file on disk, since a platform like Render has nowhere
 *     persistent to put a file that is not itself checked into the repo.
 */

const admin = require("firebase-admin");

let app;
if (process.env.FIRESTORE_EMULATOR_HOST) {
  app = admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || "scheduleforge-dev" });
} else {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error(
      "Neither FIRESTORE_EMULATOR_HOST nor FIREBASE_SERVICE_ACCOUNT is set - see server/.env.example"
    );
  }
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON");
  }
  app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore(app);
// Accounts have fields that only apply to one role (a teacher's
// instructorNames, a student's program and year); the ones that do not
// apply are simply undefined rather than null, and Firestore rejects
// undefined values by default.
db.settings({ ignoreUndefinedProperties: true });

module.exports = { db };
