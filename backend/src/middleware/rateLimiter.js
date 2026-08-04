const rateLimit = require('express-rate-limit');
const redisStore = require('rate-limit-redis').default;

/**
 * Create a rate limiter with Redis store
 * Falls back to memory store if Redis is unavailable
 */
function createRateLimiter(options = {}) {
  const defaults = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator({ ip }) {
      return ip;
    },
    handler({ statusCode, message }) {
      return {
        success: false,
        message: typeof message === 'string' ? message : 'Terlalu banyak permintaan. Silakan coba lagi beberapa saat.',
      };
    },
    skipFailedRequests: false,
  };

  const config = { ...defaults, ...options };

  // Use Redis store in production if Redis is configured
  if (process.env.REDIS_URL && process.env.NODE_ENV === 'production') {
    try {
      config.store = new redisStore({
        sendCommand: (...args) => {
          const Redis = require('ioredis');
          const redis = new Redis(process.env.REDIS_URL);
          return redis.call(...args);
        },
      });
    } catch (err) {
      console.warn('Redis rate limit store failed, using memory store:', err.message);
    }
  }

  return rateLimit(config);
}

/**
 * General API rate limiter: 100 requests per 15 minutes
 */
const apiLimiter = createRateLimiter({
  max: 100,
  windowMs: 15 * 60 * 1000,
  keyGenerator({ ip }) {
    return ip;
  },
  message: 'Terlalu banyak permintaan. Maksimal 100 permintaan per 15 menit.',
});

/**
 * Auth endpoints rate limiter: 5 requests per 15 minutes per IP
 */
const authLimiter = createRateLimiter({
  max: 5,
  windowMs: 15 * 60 * 1000,
  keyGenerator({ ip }) {
    return `auth:${ip}`;
  },
  message: 'Terlalu banyak percobaan. Silakan tunggu 15 menit sebelum mencoba lagi.',
});

/**
 * Strict rate limiter for sensitive operations: 3 per hour
 */
const strictLimiter = createRateLimiter({
  max: 3,
  windowMs: 60 * 60 * 1000,
  keyGenerator({ ip }) {
    return `strict:${ip}`;
  },
  message: 'Terlalu banyak permintaan. Silakan tunggu 1 jam.',
});

/**
 * Per-tenant rate limiter using req.tenant
 */
function tenantRateLimiter(max = 100, windowMs = 15 * 60 * 1000) {
  return createRateLimiter({
    max,
    windowMs,
    keyGenerator(req) {
      const tenantId = req.user?.tenantId || req.ip;
      return `tenant:${tenantId}`;
    },
    message: 'Batas penggunaan tercapai. Silakan coba lagi nanti.',
  });
}

module.exports = {
  createRateLimiter,
  apiLimiter,
  authLimiter,
  strictLimiter,
  tenantRateLimiter,
};
