/**
 * One JSON line per event, to stdout/stderr - not for a person tailing logs
 * in a terminal (though it still reads fine there), but for whatever a real
 * deployment forwards its logs into: Render's own log viewer, or anything
 * downstream of it, all of which do far more with a structured line than
 * with a free-text sentence. Kept intentionally tiny - no log levels beyond
 * the three used here, no transports, nothing this project would have to
 * configure.
 */

function line(level, message, context) {
  const entry = { time: new Date().toISOString(), level, message, ...context };
  const text = JSON.stringify(entry);
  if (level === "error") process.stderr.write(text + "\n");
  else process.stdout.write(text + "\n");
}

module.exports = {
  info: (message, context) => line("info", message, context),
  warn: (message, context) => line("warn", message, context),
  error: (message, context) => line("error", message, context),
};
