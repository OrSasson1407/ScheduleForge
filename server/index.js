/**
 * ScheduleForge - shared server.
 *
 * Two unrelated jobs share this one small Node process only because a
 * classroom deployment should not have to run (and remember the port of) two
 * separate servers:
 *
 *   1. Real-time collaboration (the original job - see the WebSocket section
 *      below): a relay that lets a few people editing the same exam system
 *      see each other's moves, in memory only, forgotten on restart.
 *
 *   2. Accounts and the published schedule (`server/store.js`): the one piece
 *      of ScheduleForge state that genuinely has to be visible to *other*
 *      people's browsers - an editor registers on their computer, an admin
 *      approves them from a different computer, a student opens the site on
 *      a third computer and sees what was published. None of that is
 *      possible from localStorage alone, which is why this exists.
 *
 * SECURITY NOTE: this is still a classroom tool, not a production auth
 * system. Passwords are hashed at rest, but there is no HTTPS here, no rate
 * limiting, no password reset, and a session token never expires until the
 * server restarts. Do not point this at anything that needs to actually be
 * secure.
 *
 * HTTP API (JSON in, JSON out; CORS open to any origin):
 *
 *   POST /api/register        {username, password, displayName} -> 201 {status:"pending"}
 *   POST /api/login           {username, password} -> 200 {token, account} | 401 | 403 {reason:"pending"}
 *   GET  /api/me               (Authorization: Bearer <token>) -> 200 {account}
 *   GET  /api/editors          admin only -> 200 {editors: [...]}
 *   POST /api/editors/:username/approve   admin only -> 200
 *   POST /api/editors/:username/reject    admin only -> 200
 *   GET  /api/published         (any signed-in account) -> 200 {published}
 *   POST /api/published        editor or admin -> body is the PublishedSchedule -> 200
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

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;

/* --- HTTP API: accounts and the published schedule ----------------------- */

/** token -> username. Lost on restart, same as the collaboration rooms below. */
const sessions = new Map();

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
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, body) {
  const text = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(text);
  return true; // lets handleApi's callers return this call directly and still signal "handled"
}

function accountFromRequest(req) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const username = token ? sessions.get(token) : null;
  return username ? store.findAccount(username) : null;
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    });
    res.end();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/register") {
    const body = await readJsonBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const displayName = String(body.displayName || "").trim() || username;
    if (!username || !password) return sendJson(res, 400, { error: "username and password are required" });
    const created = store.addPendingEditor(username, password, displayName);
    if (!created) return sendJson(res, 409, { error: "taken" });
    return sendJson(res, 201, { status: "pending" });
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readJsonBody(req);
    const account = store.findAccount(String(body.username || "").trim());
    if (!account || !store.verifyPassword(String(body.password || ""), account.password)) {
      return sendJson(res, 401, { error: "invalid" });
    }
    if (account.status !== "approved") return sendJson(res, 403, { reason: "pending" });
    const token = randomUUID();
    sessions.set(token, account.username);
    return sendJson(res, 200, { token, account: store.publicAccount(account) });
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    const account = accountFromRequest(req);
    if (!account) return sendJson(res, 401, { error: "not signed in" });
    return sendJson(res, 200, { account: store.publicAccount(account) });
  }

  if (req.method === "GET" && url.pathname === "/api/editors") {
    const account = accountFromRequest(req);
    if (!account || account.role !== "admin") return sendJson(res, 403, { error: "admins only" });
    return sendJson(res, 200, { editors: store.listEditors() });
  }

  const approveMatch = url.pathname.match(/^\/api\/editors\/([^/]+)\/approve$/);
  if (req.method === "POST" && approveMatch) {
    const account = accountFromRequest(req);
    if (!account || account.role !== "admin") return sendJson(res, 403, { error: "admins only" });
    const ok = store.setEditorStatus(decodeURIComponent(approveMatch[1]), "approved");
    return sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not found" });
  }

  const rejectMatch = url.pathname.match(/^\/api\/editors\/([^/]+)\/reject$/);
  if (req.method === "POST" && rejectMatch) {
    const account = accountFromRequest(req);
    if (!account || account.role !== "admin") return sendJson(res, 403, { error: "admins only" });
    const ok = store.removeAccount(decodeURIComponent(rejectMatch[1]));
    return sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not found" });
  }

  if (req.method === "GET" && url.pathname === "/api/published") {
    const account = accountFromRequest(req);
    if (!account) return sendJson(res, 401, { error: "not signed in" });
    return sendJson(res, 200, { published: store.getPublished() });
  }

  if (req.method === "POST" && url.pathname === "/api/published") {
    const account = accountFromRequest(req);
    if (!account || (account.role !== "editor" && account.role !== "admin")) {
      return sendJson(res, 403, { error: "editors only" });
    }
    const body = await readJsonBody(req);
    store.setPublished(body);
    return sendJson(res, 200, { ok: true });
  }

  return false;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!url.pathname.startsWith("/api/")) {
    res.writeHead(404);
    res.end();
    return;
  }
  handleApi(req, res, url)
    .then((handled) => {
      if (!handled) sendJson(res, 404, { error: "not found" });
    })
    .catch((error) => sendJson(res, 400, { error: error.message }));
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

server.listen(PORT, () => {
  console.log(`ScheduleForge server listening on http://localhost:${PORT} (and ws://localhost:${PORT})`);
});
