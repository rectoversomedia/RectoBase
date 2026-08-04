/**
 * Redis shim for Vercel serverless / local development
 *
 * Production: Set REDIS_URL to your Upstash Redis or self-hosted Redis.
 * Serverless (no Redis available): Falls back to in-memory Map with JWT expiry.
 *
 * This shim is transparent — auth.service.js etc. call the same API:
 *   set(key, value, ttlSeconds)
 *   get(key)
 *   del(key)
 */

const Redis = require('ioredis');

// In-memory fallback store (per-process, resets on cold start)
const MEM = new Map();

let redis = null;
let useFallback = false;

// ── Try to connect real Redis ───────────────────────────────────────────────────
function init() {
  if (redis) return;

  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    console.log('[Redis] REDIS_URL not set — using in-memory fallback (serverless mode)');
    useFallback = true;
    return;
  }

  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    });

    redis.on('error', (err) => {
      console.warn('[Redis] Connection error:', err.message, '— falling back to in-memory');
      useFallback = true;
    });

    redis.on('connect', () => {
      console.log('[Redis] Connected to', redisUrl.substring(0, 20) + '...');
      useFallback = false;
    });
  } catch (e) {
    console.warn('[Redis] Failed to init:', e.message, '— using in-memory fallback');
    useFallback = true;
  }
}

// ── Wrapped API ────────────────────────────────────────────────────────────────
async function set(key, value, ttlSeconds) {
  init();

  const serialized = JSON.stringify(value);

  if (useFallback || !redis) {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    MEM.set(key, { value: serialized, expiresAt });
    // Auto-cleanup expired in-memory entries occasionally
    if (MEM.size > 1000) cleanupMem();
    return;
  }

  if (ttlSeconds) {
    await redis.set(key, serialized, 'EX', ttlSeconds);
  } else {
    await redis.set(key, serialized);
  }
}

async function get(key) {
  init();

  if (useFallback || !redis) {
    const entry = MEM.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      MEM.delete(key);
      return null;
    }
    try { return JSON.parse(entry.value); } catch { return entry.value; }
  }

  const val = await redis.get(key);
  if (!val) return null;
  try { return JSON.parse(val); } catch { return val; }
}

async function del(key) {
  init();
  if (useFallback || !redis) { MEM.delete(key); return; }
  await redis.del(key);
}

async function sadd(key, ...members) {
  init();
  if (useFallback || !redis) {
    const existing = MEM.get(key);
    const set = existing ? new Set(JSON.parse(existing.value)) : new Set();
    members.forEach(m => set.add(m));
    MEM.set(key, { value: JSON.stringify([...set]), expiresAt: null });
    return;
  }
  await redis.sadd(key, ...members);
}

async function smembers(key) {
  init();
  if (useFallback || !redis) {
    const entry = MEM.get(key);
    if (!entry) return [];
    return JSON.parse(entry.value);
  }
  return redis.smembers(key);
}

async function sismember(key, member) {
  init();
  if (useFallback || !redis) {
    const entry = MEM.get(key);
    if (!entry) return false;
    return JSON.parse(entry.value).includes(member);
  }
  return (await redis.sismember(key, member)) === 1;
}

async function incr(key, ttlSeconds) {
  init();
  if (useFallback || !redis) {
    const existing = MEM.get(key);
    const current = existing ? parseInt(JSON.parse(existing.value), 10) : 0;
    const next = current + 1;
    MEM.set(key, { value: JSON.stringify(next), expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
    return next;
  }
  const val = await redis.incr(key);
  if (ttlSeconds) await redis.expire(key, ttlSeconds);
  return val;
}

async function close() {
  if (redis) await redis.quit();
}

function cleanupMem() {
  const now = Date.now();
  for (const [k, v] of MEM) {
    if (v.expiresAt && now > v.expiresAt) MEM.delete(k);
  }
}

// Export the redis instance (for events) plus shim functions
module.exports = {
  redis: { on: () => {}, off: () => {} }, // stub — auth.service.js listens on 'redis'
  set,
  get,
  del,
  sadd,
  smembers,
  sismember,
  incr,
  close,
};
