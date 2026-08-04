const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  min: 2,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

/**
 * Run a SQL query
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @returns {Promise<object>}
 */
async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== 'production') {
    console.log('Executed query', { text: text.substring(0, 100), duration, rows: result.rowCount });
  }
  return result;
}

/**
 * Get a client from the pool for transactions
 * @returns {Promise<object>}
 */
async function getClient() {
  return pool.connect();
}

/**
 * Run a function inside a transaction
 * @param {Function} callback - async function receiving the client
 * @returns {Promise<any>}
 */
async function transaction(callback) {
  const client = await pool.connect();
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
 * @returns {Promise<boolean>}
 */
async function healthCheck() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Close all pool connections
 */
async function close() {
  await pool.end();
}

module.exports = {
  query,
  getClient,
  transaction,
  healthCheck,
  close,
  pool,
};
