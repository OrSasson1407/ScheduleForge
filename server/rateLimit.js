/**
 * Login/registration rate limiting, shared across every server instance
 * when `REDIS_URL` is set - without that, a fixed window per process (the
 * in-memory `Map` this had before) only limits each instance separately, so
 * running N instances behind a load balancer would let a client actually
 * make N times the intended limit of attempts, split across them by
 * whichever one it happened to land on each time.
 *
 * `REDIS_URL` unset is a fully supported mode, not a degraded one: local
 * development and a single-instance deployment (the default - see
 * `render.yaml`'s `numInstances: 1` on the server, and its comment on why)
 * never need Redis at all. A Redis error at runtime falls back to the same
 * in-memory check for that call rather than failing open (no limit) or
 * closed (blocking every request) - a temporarily weaker limit, not none.
 */

const log = require("./log");

let client = null;
if (process.env.REDIS_URL) {
  const { createClient } = require("redis");
  client = createClient({ url: process.env.REDIS_URL });
  client.on("error", (error) => log.error("Redis client error", { error: error.message }));
  client.connect().catch((error) => log.error("Redis connection failed at startup", { error: error.message }));
}

const memoryBuckets = new Map();

function checkMemory(key, limit, windowMs) {
  const now = Date.now();
  const bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

async function checkRedis(key, limit, windowMs) {
  const redisKey = `ratelimit:${key}`;
  const count = await client.incr(redisKey);
  if (count === 1) await client.pExpire(redisKey, windowMs);
  return count > limit;
}

/** True if this key has been hit more than `limit` times within the last `windowMs`. */
async function rateLimited(key, limit, windowMs) {
  if (client?.isReady) {
    try {
      return await checkRedis(key, limit, windowMs);
    } catch (error) {
      log.error("Redis rate-limit check failed, falling back to this instance's own memory for this request", {
        error: error.message,
      });
    }
  }
  return checkMemory(key, limit, windowMs);
}

/** Closes the Redis connection, if one was ever opened. A no-op otherwise - used by index.js's graceful shutdown. */
async function closeRateLimiter() {
  if (client) {
    try {
      await client.quit();
    } catch {
      /* shutting down anyway; nothing left to do with this error */
    }
  }
}

module.exports = { rateLimited, closeRateLimiter };
