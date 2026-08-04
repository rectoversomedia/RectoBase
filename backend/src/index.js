require('dotenv').config();
const app = require('./app');
const db = require('./utils/db');
const redis = require('./config/redis');
const logger = require('./utils/logger');

const PORT = parseInt(process.env.PORT || '3000', 10);

// ── Startup ───────────────────────────────────────────────────────────────────
async function start() {
  try {
    // 1. Database health check
    await db.query('SELECT 1');
    logger.info('PostgreSQL connected');

    // 2. Redis ping
    try {
      await redis.ping();
      logger.info('Redis connected');
    } catch (redisErr) {
      logger.warn('Redis unavailable — continuing without cache layer:', redisErr.message);
    }

    // 3. Start HTTP server
    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`RectoBase API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
    });

    // 4. Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received — shutting down gracefully...`);
      server.close(async () => {
        try {
          const pool = require('./utils/db').pool;
          await pool.end();
          await redis.quit();
          logger.info('All connections closed');
          process.exit(0);
        } catch (err) {
          logger.error('Error during shutdown:', err);
          process.exit(1);
        }
      });

      // Force exit after 30s
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30_000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // 5. Uncaught exception handler
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception:', err);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
