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

/**
 * Set a key with optional TTL (in seconds)
 */
async function set(key, value, ttlSeconds) {
  if (ttlSeconds) {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } else {
    await redis.set(key, JSON.stringify(value));
  }
}

/**
 * Get a key, parsed as JSON
 */
async function get(key) {
  const val = await redis.get(key);
  if (!val) return null;
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

/**
 * Delete a key
 */
async function del(key) {
  await redis.del(key);
}

/**
 * Add to a set
 */
async function sadd(key, ...members) {
  await redis.sadd(key, ...members);
}

/**
 * Get all members of a set
 */
async function smembers(key) {
  return redis.smembers(key);
}

/**
 * Check if member exists in set
 */
async function sismember(key, member) {
  return (await redis.sismember(key, member)) === 1;
}

/**
 * Increment a counter with TTL
 */
async function incr(key, ttlSeconds) {
  const val = await redis.incr(key);
  if (ttlSeconds) {
    await redis.expire(key, ttlSeconds);
  }
  return val;
}

async function close() {
  await redis.quit();
}

module.exports = {
  redis,
  set,
  get,
  del,
  sadd,
  smembers,
  sismember,
  incr,
  close,
};
