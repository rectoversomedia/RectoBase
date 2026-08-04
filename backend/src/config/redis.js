/**
 * Redis config — auto-detects serverless vs. persistent environment.
 *
 * Serverless (VERCEL or no REDIS_URL): uses in-memory shim (redis.serverless.js)
 *   → safe for cold starts, no persistent connections needed
 *
 * Persistent (self-hosted / VM): connects to REDIS_URL
 *   → full Redis with connection pool
 */

const isServerless = !!(
  process.env.VERCEL ||
  !process.env.REDIS_URL ||
  process.env.USE_IN_MEMORY_REDIS === 'true'
);

if (isServerless) {
  module.exports = require('./redis.serverless');
  return;
}

// ── Persistent Redis (self-hosted / VM) ────────────────────────────────────────
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  lazyConnect: true,
});

redis.on('error', (err) => {
  console.error('Redis error:', err.message);
});

redis.on('connect', () => {
  console.log('Redis connected');
});

async function set(key, value, ttlSeconds) {
  const serialized = JSON.stringify(value);
  if (ttlSeconds) {
    await redis.set(key, serialized, 'EX', ttlSeconds);
  } else {
    await redis.set(key, serialized);
  }
}

async function get(key) {
  const val = await redis.get(key);
  if (!val) return null;
  try { return JSON.parse(val); } catch { return val; }
}

async function del(key) { await redis.del(key); }

async function sadd(key, ...members) { await redis.sadd(key, ...members); }

async function smembers(key) { return redis.smembers(key); }

async function sismember(key, member) { return (await redis.sismember(key, member)) === 1; }

async function incr(key, ttlSeconds) {
  const val = await redis.incr(key);
  if (ttlSeconds) await redis.expire(key, ttlSeconds);
  return val;
}

async function close() { await redis.quit(); }

module.exports = { redis, set, get, del, sadd, smembers, sismember, incr, close };

