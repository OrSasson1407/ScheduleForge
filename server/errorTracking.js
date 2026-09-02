/**
 * Error reporting to Sentry - entirely optional, and a genuine no-op (not a
 * silent failure) when `SENTRY_DSN` is unset, which is the default: nothing
 * here requires an account with anyone. Every error still reaches
 * `server/log.js`'s structured log either way, so a deployment that never
 * sets this up loses nothing but the "someone gets paged" part - see
 * DEPLOYMENT.md for what still needs an external service for that.
 */

const log = require("./log");

let Sentry = null;
if (process.env.SENTRY_DSN) {
  try {
    Sentry = require("@sentry/node");
    Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || "production" });
    log.info("Error tracking enabled");
  } catch (error) {
    log.error("SENTRY_DSN was set but @sentry/node failed to initialize - continuing without it", {
      error: error.message,
    });
  }
}

/** Logs an error and, if configured, reports it to Sentry. Never throws itself. */
function captureError(error, context) {
  log.error(error.message, { stack: error.stack, ...context });
  if (Sentry) {
    try {
      Sentry.captureException(error, { extra: context });
    } catch {
      /* Reporting the error failed; the log line above already recorded it either way. */
    }
  }
}

module.exports = { captureError };
