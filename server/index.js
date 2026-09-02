/**
 * ScheduleForge - shared server.
 *
 * Two unrelated jobs share this one small Node process only because a
 * classroom deployment should not have to run (and remember the port of) two
 * separate servers:
 *
 *   1. Real-time collaboration (the original job - see the WebSocket section
 *      below): a relay that lets a few people editing the same exam system
 *      see each other's moves, in memory only, forgotten on restart. That
 *      memory is this one process's own - unlike accounts, places and rate
 *      limiting, room state was not moved to something shared (Redis) when
 *      this went to production, so this server has to run as exactly one
 *      instance (`render.yaml`'s `numInstances: 1`, and its comment on what
 *      would need to change first to safely raise that).
 *
 *   2. Accounts and the published schedule (`server/store.js`): the one piece
 *      of ScheduleForge state that genuinely has to be visible to *other*
 *      people's browsers - an editor registers on their computer, an admin
 *      approves them from a different computer, a student opens the site on
 *      a third computer and sees what was published. None of that is
 *      possible from localStorage alone, which is why this exists.
 *
 * A third thing lives here too, underneath both of the above: **places**. A
 * place is one institution (a university, a high school, a college, ...);
 * every account except `admin` belongs to exactly one, and everything an
 * editor publishes, and everything a teacher or student reads, is scoped to
 * the caller's own place, resolved from their token server-side rather than
 * trusted from anything the client sends - so one place's editor can never
 * publish into another place's schedule by supplying a different id.
 *
 * SECURITY NOTE: production posture, not a toy. Data lives in Postgres
 * (`server/db.js`), not a JSON file. Passwords are hashed at rest; a forgotten
 * one is reset by an admin to a random temporary password relayed out of
 * band (there is still no email sending here) and forces a change on next
 * sign-in. A session has a sliding 24-hour expiry instead of surviving until
 * the process restarts. Login and registration are rate-limited per IP
 * (`server/rateLimit.js` - shared across instances via Redis when
 * `REDIS_URL` is set, per-process otherwise) and an account locks out for 15
 * minutes after 5 failed attempts. CORS is restricted to `ALLOWED_ORIGIN` -
 * set it, or every origin is allowed, which is fine for local development and
 * wrong for anything else. Every request error is logged as structured JSON
 * (`server/log.js`) and, if `SENTRY_DSN` is set, reported to Sentry
 * (`server/errorTracking.js`) - neither is required to run this. None of
 * this is a substitute for running behind HTTPS (`DEPLOYMENT.md`) - a bearer
 * token sent over plain HTTP is trivially interceptable no matter how well
 * it is generated or expired.
 *
 * HTTP API (JSON in, JSON out; CORS restricted to ALLOWED_ORIGIN):
 *
 *   GET  /healthz                -> 200 {ok:true}  (no auth - for the platform's health check)
 *   GET  /api/places             -> 200 {places: [...]}  (public - needed before registering)
 *   POST /api/places             admin only, {name, kind} -> 201 {place}
 *   POST /api/register           {username, password, displayName, role, placeId, ...role-specific}
 *                                 -> 201 {status:"pending"|"approved"} | 400 | 409 {error:"taken"}
 *   POST /api/login               {username, password}
 *                                 -> 200 {token, account} | 401 | 403 {reason:"pending"|"locked"} | 429
 *   GET  /api/me                  (Authorization: Bearer <token>) -> 200 {account}
 *   POST /api/change-password     {currentPassword, newPassword} -> 200 | 401
 *   GET  /api/accounts            admin only -> 200 {accounts: [...]}  (every role, every place)
 *   POST /api/editors/:username/approve   admin only -> 200
 *   POST /api/editors/:username/reject    admin only -> 200
 *   POST /api/accounts/:username/reset-password   admin only -> 200 {temporaryPassword}
 *   GET  /api/published            any signed-in account -> 200 {published}  (the caller's own place)
 *   POST /api/published           editor only -> body is the PublishedSchedule -> 200  (the caller's own place)
 *
 * WebSocket message shapes (JSON over one connection per browser tab):
 *
 *   client -> server
 *     {type:"join", room, name, role}   -- role is "editor" or "viewer"
 *     {type:"lock", examId}             -- refused with lock-denied for a viewer
 *     {type:"unlock", examId}
 *     {type:"move", examId, date}      -- requires already holding the lock
 *     {type:"settings", settings}       -- the whole Settings object; ignored from a viewer
 *
 *   server -> client
 *     {type:"state", examDates, locks, settings, users}   -- sent once, on join
 *     {type:"presence", users}
 *     {type:"lock-changed", examId, by, clientId}          -- by/clientId null when released
 *     {type:"lock-denied", examId, heldBy}                 -- sent only to the requester
 *     {type:"moved", examId, date, by}
 *     {type:"settings", settings, by}
 */

const http = require("http");
const { randomUUID } = require("crypto");
const { WebSocketServer } = require("ws");
const store = require("./store");
const { migrate } = require("./db");
const log = require("./log");
const { captureError } = require("./errorTracking");
const { rateLimited } = require("./rateLimit");

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
if (ALLOWED_ORIGIN === "*") {
  log.warn("ALLOWED_ORIGIN is not set - allowing every origin. Set it before deploying anywhere but localhost.");
}

process.on("uncaughtException", (error) => captureError(error, { source: "uncaughtException" }));
process.on("unhandledRejection", (reason) => {
  captureError(reason instanceof Error ? reason : new Error(String(reason)), { source: "unhandledRejection" });
});

// Overridable so a test run's own burst of registrations/logins does not
// trip the same limit a real attacker would - production should leave these
// at their defaults.
const REGISTER_LIMIT = Number(process.env.REGISTER_RATE_LIMIT) || 5;
const LOGIN_LIMIT = Number(process.env.LOGIN_RATE_LIMIT) || 20;

/* --- HTTP API: accounts and the published schedule ----------------------- */

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 5_000_000) req.destroy(); // guards against a runaway body, not a real attacker
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        const error = new Error("invalid JSON body");
        error.isBadRequest = true;
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, body) {
  const text = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  });
  res.end(text);
  return true; // lets handleApi's callers return this call directly and still signal "handled"
}

async function accountFromRequest(req) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  return token ? store.accountForToken(token) : null;
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : null) || req.socket.remoteAddress || "unknown";
}

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    });
    res.end();
    return true;
  }

  if (req.method === "GET" && url.pathname === "/healthz") {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/places") {
    return sendJson(res, 200, { places: await store.listPlaces() });
  }

  if (req.method === "POST" && url.pathname === "/api/places") {
    const account = await accountFromRequest(req);
    if (!account || account.role !== "admin") return sendJson(res, 403, { error: "admins only" });
    const body = await readJsonBody(req);
    const name = String(body.name || "").trim();
    const kind = String(body.kind || "").trim();
    if (!name || !kind) return sendJson(res, 400, { error: "name and kind are required" });
    return sendJson(res, 201, { place: await store.addPlace(name, kind) });
  }

  if (req.method === "POST" && url.pathname === "/api/register") {
    if (await rateLimited(`register:${clientIp(req)}`, REGISTER_LIMIT, 60 * 60 * 1000)) {
      return sendJson(res, 429, { error: "too many registration attempts - try again later" });
    }
    const body = await readJsonBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const displayName = String(body.displayName || "").trim() || username;
    const role = ["editor", "teacher", "student"].includes(body.role) ? body.role : null;
    const placeId = String(body.placeId || "");
    if (!role) return sendJson(res, 400, { error: "a valid role is required" });
    if (!USERNAME_PATTERN.test(username)) {
      return sendJson(res, 400, { error: "username must be 3-32 characters: letters, digits, ., _ or -" });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return sendJson(res, 400, { error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    if (!(await store.findPlace(placeId))) return sendJson(res, 400, { error: "unknown place" });
    const extra =
      role === "teacher"
        ? { instructorNames: Array.isArray(body.instructorNames) ? body.instructorNames.map(String) : [] }
        : role === "student"
        ? { program: String(body.program || ""), year: Number(body.year) || 1 }
        : undefined;
    const created = await store.register(username, password, displayName, role, placeId, extra);
    if (!created) return sendJson(res, 409, { error: "taken" });
    return sendJson(res, 201, { status: role === "editor" ? "pending" : "approved" });
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    if (await rateLimited(`login:${clientIp(req)}`, LOGIN_LIMIT, 5 * 60 * 1000)) {
      return sendJson(res, 429, { error: "too many attempts - try again later" });
    }
    const body = await readJsonBody(req);
    const username = String(body.username || "").trim();
    const account = await store.findAccount(username);
    if (account && store.isLocked(account)) {
      return sendJson(res, 403, { reason: "locked" });
    }
    if (!account || !store.verifyPassword(String(body.password || ""), account.password)) {
      if (account) await store.recordFailedLogin(username);
      return sendJson(res, 401, { error: "invalid" });
    }
    if (account.status !== "approved") return sendJson(res, 403, { reason: "pending" });
    await store.recordSuccessfulLogin(username);
    const token = await store.createSession(account.username);
    return sendJson(res, 200, { token, account: store.publicAccount(account) });
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    const account = await accountFromRequest(req);
    if (!account) return sendJson(res, 401, { error: "not signed in" });
    return sendJson(res, 200, { account: store.publicAccount(account) });
  }

  if (req.method === "POST" && url.pathname === "/api/change-password") {
    const account = await accountFromRequest(req);
    if (!account) return sendJson(res, 401, { error: "not signed in" });
    const body = await readJsonBody(req);
    if (!store.verifyPassword(String(body.currentPassword || ""), account.password)) {
      return sendJson(res, 401, { error: "wrong current password" });
    }
    const newPassword = String(body.newPassword || "");
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return sendJson(res, 400, { error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    await store.changePassword(account.username, newPassword);
    // The session used to make this call is revoked along with every other one; sign back in with the new password.
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/accounts") {
    const account = await accountFromRequest(req);
    if (!account || account.role !== "admin") return sendJson(res, 403, { error: "admins only" });
    return sendJson(res, 200, { accounts: await store.listAccounts() });
  }

  const approveMatch = url.pathname.match(/^\/api\/editors\/([^/]+)\/approve$/);
  if (req.method === "POST" && approveMatch) {
    const account = await accountFromRequest(req);
    if (!account || account.role !== "admin") return sendJson(res, 403, { error: "admins only" });
    const ok = await store.setEditorStatus(decodeURIComponent(approveMatch[1]), "approved");
    return sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not found" });
  }

  const rejectMatch = url.pathname.match(/^\/api\/editors\/([^/]+)\/reject$/);
  if (req.method === "POST" && rejectMatch) {
    const account = await accountFromRequest(req);
    if (!account || account.role !== "admin") return sendJson(res, 403, { error: "admins only" });
    const ok = await store.removeAccount(decodeURIComponent(rejectMatch[1]));
    return sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not found" });
  }

  const resetMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)\/reset-password$/);
  if (req.method === "POST" && resetMatch) {
    const account = await accountFromRequest(req);
    if (!account || account.role !== "admin") return sendJson(res, 403, { error: "admins only" });
    const temp = await store.resetPassword(decodeURIComponent(resetMatch[1]));
    return sendJson(res, temp ? 200 : 404, temp ? { temporaryPassword: temp } : { error: "not found" });
  }

  if (req.method === "GET" && url.pathname === "/api/published") {
    const account = await accountFromRequest(req);
    if (!account || !account.placeId) return sendJson(res, 401, { error: "not signed in" });
    return sendJson(res, 200, { published: await store.getPublished(account.placeId) });
  }

  if (req.method === "POST" && url.pathname === "/api/published") {
    const account = await accountFromRequest(req);
    if (!account || account.role !== "editor") return sendJson(res, 403, { error: "editors only" });
    const body = await readJsonBody(req);
    await store.setPublished(account.placeId, body);
    return sendJson(res, 200, { ok: true });
  }

  return false;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/healthz" && !url.pathname.startsWith("/api/")) {
    res.writeHead(404);
    res.end();
    return;
  }
  handleApi(req, res, url)
    .then((handled) => {
      if (!handled) sendJson(res, 404, { error: "not found" });
    })
    .catch((error) => {
      if (error.isBadRequest) return sendJson(res, 400, { error: error.message });
      captureError(error, { path: url.pathname, method: req.method });
      sendJson(res, 500, { error: "internal error" });
    });
});

/* --- WebSocket: real-time collaboration ----------------------------------- */

/** room code -> { examDates: Map, locks: Map<examId, {clientId, name}>,
 *                 settings: object|null, clients: Map<clientId, {ws, name}> } */
const rooms = new Map();

function roomOf(code) {
  let room = rooms.get(code);
  if (!room) {
    room = { examDates: new Map(), locks: new Map(), settings: null, clients: new Map() };
    rooms.set(code, room);
  }
  return room;
}

function usersOf(room) {
  return [...room.clients.entries()].map(([clientId, client]) => ({
    clientId,
    name: client.name,
    role: client.role,
  }));
}

function send(client, message) {
  if (client.ws.readyState === client.ws.OPEN) {
    client.ws.send(JSON.stringify(message));
  }
}

function broadcast(room, message, exceptClientId) {
  for (const [clientId, client] of room.clients) {
    if (clientId === exceptClientId) continue;
    send(client, message);
  }
}

function releaseLocksOf(room, clientId) {
  for (const [examId, lock] of [...room.locks]) {
    if (lock.clientId !== clientId) continue;
    room.locks.delete(examId);
    broadcast(room, { type: "lock-changed", examId, by: null, clientId: null });
  }
}

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  const clientId = randomUUID();
  let room = null;

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return; // a malformed message is simply ignored, not a reason to disconnect
    }

    if (message.type === "join") {
      room = roomOf(String(message.room || "default"));
      const role = message.role === "viewer" ? "viewer" : "editor";
      room.clients.set(clientId, { ws, name: String(message.name || "Guest"), role });
      send(room.clients.get(clientId), {
        type: "state",
        clientId,
        examDates: Object.fromEntries(room.examDates),
        locks: Object.fromEntries(
          [...room.locks].map(([examId, lock]) => [examId, { name: lock.name, clientId: lock.clientId }])
        ),
        settings: room.settings,
        users: usersOf(room),
      });
      broadcast(room, { type: "presence", users: usersOf(room) }, clientId);
      return;
    }

    if (!room) return; // every other message needs a room to already be joined

    if (message.type === "lock") {
      const examId = String(message.examId);
      if (room.clients.get(clientId).role !== "editor") {
        send(room.clients.get(clientId), {
          type: "lock-denied",
          examId,
          heldBy: "nobody - you joined this room as a viewer",
        });
        return;
      }
      const holder = room.locks.get(examId);
      if (holder && holder.clientId !== clientId) {
        send(room.clients.get(clientId), { type: "lock-denied", examId, heldBy: holder.name });
        return;
      }
      const name = room.clients.get(clientId).name;
      room.locks.set(examId, { clientId, name });
      broadcast(room, { type: "lock-changed", examId, by: name, clientId });
      return;
    }

    if (message.type === "unlock") {
      const examId = String(message.examId);
      const holder = room.locks.get(examId);
      if (holder && holder.clientId === clientId) {
        room.locks.delete(examId);
        broadcast(room, { type: "lock-changed", examId, by: null, clientId: null });
      }
      return;
    }

    if (message.type === "move") {
      const examId = String(message.examId);
      const holder = room.locks.get(examId);
      if (!holder || holder.clientId !== clientId) {
        send(room.clients.get(clientId), {
          type: "lock-denied",
          examId,
          heldBy: holder ? holder.name : "nobody - lock it before moving it",
        });
        return;
      }
      room.examDates.set(examId, String(message.date));
      room.locks.delete(examId);
      const name = room.clients.get(clientId).name;
      broadcast(room, { type: "moved", examId, date: message.date, by: name });
      broadcast(room, { type: "lock-changed", examId, by: null, clientId: null });
      return;
    }

    if (message.type === "settings") {
      if (room.clients.get(clientId).role !== "editor") return; // a viewer's change is silently ignored
      room.settings = message.settings;
      const name = room.clients.get(clientId).name;
      broadcast(room, { type: "settings", settings: message.settings, by: name }, clientId);
      return;
    }
  });

  ws.on("close", () => {
    if (!room) return;
    room.clients.delete(clientId);
    releaseLocksOf(room, clientId);
    broadcast(room, { type: "presence", users: usersOf(room) });
  });
});

async function start() {
  await migrate();
  const generatedAdminPassword = await store.ensureBootstrapAdmin();
  if (generatedAdminPassword) {
    log.warn(
      "No ADMIN_PASSWORD was set, so a bootstrap admin account was created with a generated password - " +
        "printed once, here, and not stored anywhere else. Save it now.",
      { username: "admin", password: generatedAdminPassword }
    );
  }
  await store.seedDemoAccounts();

  server.listen(PORT, () => {
    log.info("ScheduleForge server listening", { port: PORT });
  });
}

start().catch((error) => {
  captureError(error, { source: "startup" });
  process.exit(1);
});

// Exposed only so server/test/api.test.js can close the listener and the
// WebSocket server cleanly once its assertions are done.
module.exports = { server, wss };
