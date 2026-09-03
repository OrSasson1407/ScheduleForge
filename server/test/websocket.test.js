/**
 * Integration tests for the WebSocket real-time collaboration relay in
 * index.js: join/presence, exam locking, moves, and settings broadcast. Runs
 * its own server instance on its own port, independent of the other test
 * files.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const WebSocket = require("ws");

process.env.PORT = "8797";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.ALLOWED_ORIGIN = "*";
process.env.SEED_DEMO_ACCOUNTS = "false";

const base = `http://localhost:${process.env.PORT}`;
const wsBase = `ws://localhost:${process.env.PORT}`;
const unique = () => crypto.randomBytes(4).toString("hex");

let serverModule;

before(async () => {
  serverModule = require("../index.js");
  // A cold Firestore emulator (or a loaded CI runner) can take well past 5
  // seconds to answer its first request; 150 * 200ms gives it real headroom
  // before this gives up.
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("server did not become healthy in time");
});

// `WebSocketServer.close()` only stops accepting new connections and waits
// for every existing one to close on its own - it does not terminate them
// (ws's own doc comment on `close()` says so explicitly). A test that throws
// or times out before reaching its own `.close()` calls therefore leaves a
// socket open on both ends forever, and since nothing here ever forces it
// shut, `after` below hangs waiting for a `'close'` event that would never
// come, and so does the whole `node --test` process - exactly what turned
// one flaky "timed out waiting for a message" failure into a CI job stuck
// for hours instead of a failing test. Tracking every socket this file opens
// and force-terminating whichever ones are still open, regardless of why,
// is what makes a single test's failure cost seconds instead of hours.
const openSockets = new Set();

after(() => {
  for (const ws of openSockets) ws.terminate();
  serverModule.wss.close();
  serverModule.server.close();
});

// Two server actions - a successful move, and a client disconnecting while
// holding a lock - broadcast *two* messages back to back in one synchronous
// handler (`moved` then `lock-changed`; `lock-changed` then `presence` -
// server/index.js's "move" and `ws.on("close")` handlers). A `nextMessage`
// built on a single `ws.once("message", ...)` cannot safely consume two
// messages from one trigger with two sequential calls: `once` only catches
// an event that fires *after* it is attached, and Node delivers a burst of
// frames that arrived together by calling every currently-registered
// listener for the first one, then the next, synchronously, before any
// `await` in the calling test gets a chance to run and attach a listener
// for the second message. The result is not "sometimes slow" but a message
// silently and permanently dropped, and the next `nextMessage` call then
// waits out its full timeout for a message that already came and went -
// which is exactly what made two timing-sensitive tests below flake on a
// real CI run even after the first version of this fix (which only solved
// the *editor-vs-observer* instance of the same race, not this one).
//
// The fix is a real, per-socket queue rather than a one-shot listener: every
// incoming message is buffered in arrival order the moment it is received,
// completely independent of whether or when anything calls `nextMessage`,
// and `nextMessage` simply drains that queue (or waits for the next arrival
// if it is empty). This makes every test's `nextMessage` call safe
// regardless of how many messages one action produces or when each call
// happens to run relative to the broadcast.
const messageQueues = new WeakMap(); // ws -> { messages: [], waiters: [] }

function connect() {
  const ws = new WebSocket(wsBase);
  openSockets.add(ws);
  ws.once("close", () => openSockets.delete(ws));
  const queue = { messages: [], waiters: [] };
  messageQueues.set(ws, queue);
  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (queue.waiters.length) queue.waiters.shift()(message);
    else queue.messages.push(message);
  });
  return ws;
}

/** Resolves with the next parsed JSON message received on `ws`, in arrival order. */
function nextMessage(ws) {
  const queue = messageQueues.get(ws);
  if (queue.messages.length) return Promise.resolve(queue.messages.shift());
  return new Promise((resolve, reject) => {
    const waiter = (message) => {
      clearTimeout(timer);
      resolve(message);
    };
    // A shared CI runner has the Firestore emulator, this server and several
    // concurrent sockets competing for the same CPU; 3000ms occasionally was
    // not enough headroom for a broadcast to arrive under that contention,
    // the same class of slow-first-request problem `before` above already
    // gives 150 * 200ms for. This is a generous ceiling, not a real
    // expectation of the relay ever taking this long.
    const timer = setTimeout(() => {
      const index = queue.waiters.indexOf(waiter);
      if (index !== -1) queue.waiters.splice(index, 1); // do not let a late arrival resolve an already-rejected wait
      reject(new Error("timed out waiting for a message"));
    }, 10000);
    queue.waiters.push(waiter);
  });
}

function opened(ws) {
  return new Promise((resolve) => ws.once("open", resolve));
}

function closed(ws) {
  return new Promise((resolve) => ws.once("close", resolve));
}

function join(ws, room, name, role) {
  ws.send(JSON.stringify({ type: "join", room, name, role }));
  return nextMessage(ws);
}

test("joining a room returns a state message with the client's own id", async () => {
  const ws = connect();
  await opened(ws);
  const room = unique();
  const state = await join(ws, room, "Alice", "editor");
  assert.equal(state.type, "state");
  assert.ok(state.clientId);
  assert.deepEqual(state.examDates, {});
  assert.deepEqual(state.locks, {});
  assert.equal(state.settings, null);
  ws.close();
});

test("a second client joining the same room sees the first in state.users", async () => {
  const room = unique();
  const first = connect();
  await opened(first);
  await join(first, room, "Alice", "editor");

  const second = connect();
  await opened(second);
  const state = await join(second, room, "Bob", "viewer");
  assert.equal(state.users.length, 2);
  assert.ok(state.users.some((u) => u.name === "Alice"));
  assert.ok(state.users.some((u) => u.name === "Bob" && u.role === "viewer"));

  first.close();
  second.close();
});

test("joining broadcasts a presence update to clients already in the room", async () => {
  const room = unique();
  const first = connect();
  await opened(first);
  await join(first, room, "Alice", "editor");

  const second = connect();
  await opened(second);
  const presencePromise = nextMessage(first);
  await join(second, room, "Bob", "editor");
  const presence = await presencePromise;
  assert.equal(presence.type, "presence");
  assert.equal(presence.users.length, 2);

  first.close();
  second.close();
});

test("an editor can lock an exam, and everyone in the room is told", async () => {
  const room = unique();
  const editor = connect();
  await opened(editor);
  await join(editor, room, "Alice", "editor");

  const observer = connect();
  await opened(observer);
  await join(observer, room, "Bob", "viewer");

  const lockChangedPromise = nextMessage(observer);
  editor.send(JSON.stringify({ type: "lock", examId: "exam-1" }));
  const lockChanged = await lockChangedPromise;
  assert.equal(lockChanged.type, "lock-changed");
  assert.equal(lockChanged.examId, "exam-1");
  assert.equal(lockChanged.by, "Alice");

  editor.close();
  observer.close();
});

test("a viewer cannot lock an exam", async () => {
  const room = unique();
  const viewer = connect();
  await opened(viewer);
  await join(viewer, room, "Bob", "viewer");

  viewer.send(JSON.stringify({ type: "lock", examId: "exam-1" }));
  const response = await nextMessage(viewer);
  assert.equal(response.type, "lock-denied");
  assert.match(response.heldBy, /viewer/);

  viewer.close();
});

test("locking an exam already held by someone else is denied", async () => {
  const room = unique();
  const first = connect();
  await opened(first);
  await join(first, room, "Alice", "editor");
  first.send(JSON.stringify({ type: "lock", examId: "exam-1" }));
  await nextMessage(first); // its own lock-changed echo

  const second = connect();
  await opened(second);
  await join(second, room, "Bob", "editor");
  second.send(JSON.stringify({ type: "lock", examId: "exam-1" }));
  const denied = await nextMessage(second);
  assert.equal(denied.type, "lock-denied");
  assert.equal(denied.heldBy, "Alice");

  first.close();
  second.close();
});

test("the same client can re-lock an exam it already holds", async () => {
  const room = unique();
  const editor = connect();
  await opened(editor);
  await join(editor, room, "Alice", "editor");
  editor.send(JSON.stringify({ type: "lock", examId: "exam-1" }));
  await nextMessage(editor);
  editor.send(JSON.stringify({ type: "lock", examId: "exam-1" }));
  const second = await nextMessage(editor);
  assert.equal(second.type, "lock-changed");
  editor.close();
});

test("unlocking releases the lock and notifies the room", async () => {
  const room = unique();
  const editor = connect();
  await opened(editor);
  await join(editor, room, "Alice", "editor");
  editor.send(JSON.stringify({ type: "lock", examId: "exam-1" }));
  await nextMessage(editor);

  editor.send(JSON.stringify({ type: "unlock", examId: "exam-1" }));
  const released = await nextMessage(editor);
  assert.equal(released.type, "lock-changed");
  assert.equal(released.by, null);
  editor.close();
});

test("moving an exam requires holding its lock first", async () => {
  const room = unique();
  const editor = connect();
  await opened(editor);
  await join(editor, room, "Alice", "editor");

  editor.send(JSON.stringify({ type: "move", examId: "exam-1", date: "2026-01-01" }));
  const response = await nextMessage(editor);
  assert.equal(response.type, "lock-denied");
  editor.close();
});

test("moving a locked exam broadcasts the move and releases the lock", async () => {
  const room = unique();
  const editor = connect();
  await opened(editor);
  await join(editor, room, "Alice", "editor");

  const observer = connect();
  await opened(observer);
  await join(observer, room, "Bob", "viewer");

  editor.send(JSON.stringify({ type: "lock", examId: "exam-1" }));
  await nextMessage(editor);
  await nextMessage(observer); // the observer's own lock-changed broadcast

  // "move" broadcasts two messages back to back (moved, then lock-changed) -
  // nextMessage's own queue (above) is what makes consuming them with two
  // plain, sequential calls safe regardless of exactly when each one runs
  // relative to the broadcast.
  editor.send(JSON.stringify({ type: "move", examId: "exam-1", date: "2026-03-15" }));
  const moved = await nextMessage(observer);
  assert.equal(moved.type, "moved");
  assert.equal(moved.examId, "exam-1");
  assert.equal(moved.date, "2026-03-15");
  assert.equal(moved.by, "Alice");

  const lockReleased = await nextMessage(observer);
  assert.equal(lockReleased.type, "lock-changed");
  assert.equal(lockReleased.by, null);

  editor.close();
  observer.close();
});

test("an editor's settings change is broadcast to other clients, not echoed back", async () => {
  const room = unique();
  const editor = connect();
  await opened(editor);
  await join(editor, room, "Alice", "editor");

  const observer = connect();
  await opened(observer);
  await join(observer, room, "Bob", "viewer");

  const settingsPromise = nextMessage(observer);
  editor.send(JSON.stringify({ type: "settings", settings: { maxExamsPerDay: 2 } }));
  const settings = await settingsPromise;
  assert.equal(settings.type, "settings");
  assert.deepEqual(settings.settings, { maxExamsPerDay: 2 });
  assert.equal(settings.by, "Alice");

  editor.close();
  observer.close();
});

test("a viewer's settings change is silently ignored", async () => {
  const room = unique();
  const viewer = connect();
  await opened(viewer);
  await join(viewer, room, "Bob", "viewer");

  const editor = connect();
  await opened(editor);
  await join(editor, room, "Alice", "editor");
  // The viewer's settings message must produce no broadcast to the editor.
  viewer.send(JSON.stringify({ type: "settings", settings: { maxExamsPerDay: 99 } }));
  // Prove the connection is still alive and ordinary messages still flow.
  editor.send(JSON.stringify({ type: "lock", examId: "exam-x" }));
  const stillWorks = await nextMessage(editor);
  assert.equal(stillWorks.type, "lock-changed");

  viewer.close();
  editor.close();
});

test("a late joiner sees settings already set in the room", async () => {
  const room = unique();
  const editor = connect();
  await opened(editor);
  await join(editor, room, "Alice", "editor");
  editor.send(JSON.stringify({ type: "settings", settings: { maxExamsPerDay: 3 } }));
  await new Promise((resolve) => setTimeout(resolve, 100)); // let the server apply it

  const late = connect();
  await opened(late);
  const state = await join(late, room, "Carol", "viewer");
  assert.deepEqual(state.settings, { maxExamsPerDay: 3 });

  editor.close();
  late.close();
});

test("a late joiner sees a date moved earlier", async () => {
  const room = unique();
  const editor = connect();
  await opened(editor);
  await join(editor, room, "Alice", "editor");
  editor.send(JSON.stringify({ type: "lock", examId: "exam-9" }));
  await nextMessage(editor);
  editor.send(JSON.stringify({ type: "move", examId: "exam-9", date: "2026-05-05" }));
  await nextMessage(editor);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const late = connect();
  await opened(late);
  const state = await join(late, room, "Carol", "viewer");
  assert.equal(state.examDates["exam-9"], "2026-05-05");

  editor.close();
  late.close();
});

test("disconnecting releases the client's locks and updates presence", async () => {
  const room = unique();
  const editor = connect();
  await opened(editor);
  await join(editor, room, "Alice", "editor");
  editor.send(JSON.stringify({ type: "lock", examId: "exam-1" }));
  await nextMessage(editor);

  const observer = connect();
  await opened(observer);
  await join(observer, room, "Bob", "viewer");

  const releasePromise = nextMessage(observer);
  editor.close();
  const released = await releasePromise;
  assert.equal(released.type, "lock-changed");
  assert.equal(released.examId, "exam-1");
  assert.equal(released.by, null);

  const presence = await nextMessage(observer);
  assert.equal(presence.type, "presence");
  assert.equal(presence.users.length, 1);

  observer.close();
});

test("rooms are independent: a lock in one room is invisible in another", async () => {
  const roomA = unique();
  const roomB = unique();
  const editorA = connect();
  await opened(editorA);
  await join(editorA, roomA, "Alice", "editor");
  editorA.send(JSON.stringify({ type: "lock", examId: "shared-id" }));
  await nextMessage(editorA);

  const clientB = connect();
  await opened(clientB);
  const stateB = await join(clientB, roomB, "Bob", "viewer");
  assert.deepEqual(stateB.locks, {});

  editorA.close();
  clientB.close();
});

test("a malformed message is ignored, not disconnected", async () => {
  const ws = connect();
  await opened(ws);
  ws.send("not valid json{{{");
  await join(ws, unique(), "Alice", "editor"); // the connection still works afterwards
  ws.close();
});

test("a message sent before joining any room is ignored", async () => {
  const ws = connect();
  await opened(ws);
  ws.send(JSON.stringify({ type: "lock", examId: "exam-1" })); // no room joined yet
  // Prove the socket is still usable: join now, and it should work normally.
  const state = await join(ws, unique(), "Alice", "editor");
  assert.equal(state.type, "state");
  ws.close();
});
