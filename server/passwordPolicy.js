/**
 * What makes a chosen password weak, beyond its raw length (`MIN_PASSWORD_LENGTH`
 * in `server/index.js`, checked separately and first). Modern guidance (NIST
 * 800-63B) is that arbitrary complexity rules (force a digit, force a symbol)
 * do not make a password meaningfully harder to guess and mostly just push
 * people toward predictable substitutions ("Password1!"); what actually
 * matters is that it is not something already on every attacker's guess
 * list, and not built out of the account's own username.
 *
 * No third-party password-strength library is used here - the project's
 * existing stance on avoiding one (see `web/src/engine/csvImport.ts`'s
 * header comment) applies equally well to a small, fixed list like this one.
 */

const { verifyPassword } = require("./store");

/**
 * A sample of the passwords that show up at the top of every published
 * breach-analysis list (NordPass, SplashData, Have I Been Pwned's own most
 * common list, ...), year after year - checking against it catches the
 * overwhelming majority of "this is just a guess away" passwords without
 * needing a network call or a multi-megabyte list.
 */
const COMMON_PASSWORDS = new Set(
  [
    "123456", "123456789", "12345678", "12345", "1234567", "1234567890", "qwerty",
    "password", "password1", "password123", "123123", "111111", "000000", "iloveyou",
    "1q2w3e4r", "1qaz2wsx", "qwertyuiop", "abc123", "abc12345", "letmein", "monkey",
    "dragon", "master", "sunshine", "princess", "football", "baseball", "superman",
    "trustno1", "admin", "administrator", "welcome", "welcome1", "login", "starwars",
    "solo", "shadow", "michael", "jennifer", "jordan", "hunter", "hunter2", "freedom",
    "whatever", "qazwsx", "zaq12wsx", "passw0rd", "p@ssw0rd", "p@ssword", "changeme",
    "letmein1", "iloveyou1", "123qwe", "qwe123", "asdfghjkl", "asdf1234", "zxcvbnm",
    "1q2w3e4r5t", "aa123456", "654321", "7777777", "1231231234", "666666", "121212",
    "123321", "112233", "159753", "987654321", "1qazxsw2", "qwerty123", "qwerty1",
    "michelle", "daniel", "computer", "internet", "samsung", "google", "facebook",
    "instagram", "twitter", "yahoo", "hotmail", "outlook", "gmail1", "myspace1",
    "ninja", "batman", "spiderman", "pokemon", "minecraft", "fortnite", "roblox",
    "matrix", "phoenix", "dragon1", "chelsea", "arsenal", "liverpool", "manutd",
    "cheese", "banana", "orange1", "purple1", "yellow1", "asdfasdf", "asdasdasd",
    "aaaaaa", "bbbbbb", "111222", "222222", "333333", "444444", "555555", "888888",
    "999999", "101010", "102030", "112211", "123465", "123abc", "12341234",
    "1qaz2wsx3edc", "qazwsxedc", "azerty", "azerty123", "motdepasse", "soleil",
    "passwort", "willkommen", "geheim", "schatz", "contrasena", "murcielago",
    "trustme", "iamgroot", "nothing", "letmeinnow", "opensesame", "sesame",
    "temppass", "temp1234", "changeit", "newpassword", "newpass123", "guest",
    "guest123", "test123", "test1234", "testtest", "demo1234", "sample123",
    "default", "root", "toor", "system", "server", "network", "security",
    "secret", "secret1", "private", "public123", "backup123", "recovery1",
    "1234", "12345a", "a12345", "abcd1234", "1234abcd", "qwerty12345",
    "qwertyuiop1", "asdfghjkl1", "zxcvbnm1", "123456a", "a123456",
    "iloveyou2", "loveyou1", "iloveu123", "friends1", "family123", "forever1",
    "always123", "welcome123", "hello123", "hello1234", "goodbye1", "thankyou1",
    "birthday1", "summer2023", "summer2024", "summer2025", "winter2023",
    "winter2024", "winter2025", "spring2024", "autumn2024", "january2024",
    "december2024", "monday123", "friday123", "weekend1", "holiday1",
    "vacation1", "sunshine1", "rainbow1", "starlight", "moonlight1", "midnight1",
    "eagle1234", "tiger1234", "lion1234", "wolf12345", "bear12345", "shark1234",
  ].map((entry) => entry.toLowerCase())
);

/**
 * Rejects a password that equals or is built out of the account's own
 * username, or that appears on the common-password list above. Returns a
 * short, specific reason string, or null when the password passes.
 */
function checkStrength(password, username) {
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return "that password is too common - choose one that is not on an easily guessed list";
  }
  const usernameLower = (username || "").toLowerCase();
  if (usernameLower.length >= 3 && lower.includes(usernameLower)) {
    return "a password cannot contain your username";
  }
  return null;
}

/**
 * True when `password` matches the account's current password or one of its
 * `previousHashes` (`server/store.js`'s `previousPasswords`, oldest first).
 */
function wasUsedBefore(password, currentHash, previousHashes) {
  if (verifyPassword(password, currentHash)) return true;
  return (previousHashes || []).some((hash) => verifyPassword(password, hash));
}

module.exports = { checkStrength, wasUsedBefore };
