/**
 * Accounts and the published schedule - the two pieces of state that have to
 * outlive a browser tab and be visible to *other* people's browsers, so they
 * cannot live in localStorage the way the rest of ScheduleForge's data does.
 * Kept in one JSON file next to this module and rewritten after every change;
 * small-scale (a classroom's worth of accounts) so a plain file is enough and
 * nothing here needs an actual database.
 *
 * A password is never stored as typed: `hashPassword` salts and hashes it
 * with scrypt, so reading this file does not hand out anyone's password even
 * though nothing else about this demo authentication is meant to be secure
 * (see `server/index.js`'s header for the full caveat).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_FILE = path.join(__dirname, "data.json");

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

function seedData() {
  return {
    accounts: [
      { username: "admin", password: hashPassword("admin123"), displayName: "Admin", role: "admin", status: "approved" },
      { username: "editor", password: hashPassword("editor123"), displayName: "Demo Editor", role: "editor", status: "approved" },
      { username: "student", password: hashPassword("student123"), displayName: "Demo Student", role: "viewer", status: "approved" },
    ],
    published: null,
  };
}

function load() {
  try {
    const text = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.accounts)) throw new Error("malformed");
    return parsed;
  } catch {
    const seeded = seedData();
    save(seeded);
    return seeded;
  }
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const data = load();

function findAccount(username) {
  return data.accounts.find((account) => account.username === username) ?? null;
}

function publicAccount(account) {
  return { username: account.username, displayName: account.displayName, role: account.role, status: account.status };
}

module.exports = {
  hashPassword,
  verifyPassword,
  findAccount,
  publicAccount,
  listEditors: () => data.accounts.filter((account) => account.role === "editor").map(publicAccount),
  addPendingEditor(username, password, displayName) {
    if (findAccount(username)) return false;
    data.accounts.push({ username, password: hashPassword(password), displayName, role: "editor", status: "pending" });
    save(data);
    return true;
  },
  setEditorStatus(username, status) {
    const account = findAccount(username);
    if (!account || account.role !== "editor") return false;
    account.status = status;
    save(data);
    return true;
  },
  removeAccount(username) {
    const before = data.accounts.length;
    data.accounts = data.accounts.filter((account) => account.username !== username);
    save(data);
    return data.accounts.length < before;
  },
  getPublished: () => data.published,
  setPublished(published) {
    data.published = published;
    save(data);
  },
};
