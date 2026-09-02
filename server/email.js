/**
 * Sending the one email this project has ever needed to send: a password
 * reset link. `RESEND_API_KEY` unset is a fully supported mode, not a
 * degraded one - the same shape as `SENTRY_DSN` (`server/errorTracking.js`)
 * and `REDIS_URL` (`server/rateLimit.js`): local development and CI need no
 * account with anyone to run this server, so a reset link is simply logged
 * instead of emailed. A plain `fetch` call to Resend's HTTP API is enough;
 * no SDK is worth adding for one endpoint.
 */

const log = require("./log");

const RESEND_API_URL = "https://api.resend.com/emails";
/** Resend requires a verified sending domain; onboarding@resend.dev works out of the box for testing every account gets. */
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS || "ScheduleForge <onboarding@resend.dev>";

/**
 * Emails `resetUrl` to `to`, or - with no RESEND_API_KEY configured - logs it
 * instead so a developer (or a test) can still see and use the link.
 */
async function sendPasswordResetEmail(to, resetUrl) {
  const subject = "Reset your ScheduleForge password";
  const text =
    `Someone (hopefully you) asked to reset the password for your ScheduleForge account.\n\n` +
    `Reset it here: ${resetUrl}\n\n` +
    `This link works once, and stops working in an hour. If you did not ask for this, nothing has changed and you can ignore this email.`;

  if (!process.env.RESEND_API_KEY) {
    log.warn("RESEND_API_KEY is not set - logging the password reset link instead of emailing it", { to, resetUrl });
    return;
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, text }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      log.error("Resend refused the password reset email", { status: response.status, body });
    }
  } catch (error) {
    log.error("Sending the password reset email failed", { error: error.message });
  }
}

module.exports = { sendPasswordResetEmail };
