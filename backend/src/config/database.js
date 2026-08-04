const { Pool } = require('pg');

// Lazy pool — created on first query to avoid connection errors at import time
let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: process.env.VERCEL ? 5 : 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });
    pool.on('error', (err) => {
      console.error('[DB] Unexpected client error:', err.message);
    });
  }
  return pool;
}

/**
 * Run a SQL query
 */
async function query(text, params) {
  const start = Date.now();
  const result = await getPool().query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== 'production') {
    console.log('SQL:', text.substring(0, 100), '|', duration + 'ms');
  }
  return result;
}

/**
 * Run a function inside a transaction
 */
async function transaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Check database health
 */
async function healthCheck() {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Close all pool connections
 */
async function close() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { query, transaction, healthCheck, close };

