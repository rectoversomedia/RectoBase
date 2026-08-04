const db = require('../config/database');

/**
 * Run a raw SQL query
 */
async function query(sql, params) {
  return db.query(sql, params);
}

/**
 * Run a transaction with automatic rollback on error
 * @param {Function} callback - async function(client)
 */
async function transaction(callback) {
  return db.transaction(callback);
}

/**
 * Find a single row
 */
async function findOne(table, where, cols = '*') {
  const whereClause = buildWhere(where);
  const values = Object.values(where);
  const result = await db.query(
    `SELECT ${cols} FROM ${table} WHERE ${whereClause} LIMIT 1`,
    values
  );
  return result.rows[0] || null;
}

/**
 * Find many rows with optional filters
 */
async function findMany(table, where = {}, cols = '*', options = {}) {
  const { orderBy = 'created_at DESC', limit = 50, offset = 0 } = options;
  const whereClause = Object.keys(where).length > 0 ? `WHERE ${buildWhere(where)}` : '';
  const values = Object.values(where);
  const result = await db.query(
    `SELECT ${cols} FROM ${table} ${whereClause} ORDER BY ${orderBy} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset]
  );
  return result.rows;
}

/**
 * Count rows
 */
async function count(table, where = {}) {
  const whereClause = Object.keys(where).length > 0 ? `WHERE ${buildWhere(where)}` : '';
  const values = Object.values(where);
  const result = await db.query(
    `SELECT COUNT(*) as count FROM ${table} ${whereClause}`,
    values
  );
  return parseInt(result.rows[0].count, 10);
}

/**
 * Insert a row and return the inserted row
 */
async function insert(table, data) {
  const keys = Object.keys(data);
  const cols = keys.join(', ');
  const paramPlaceholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const values = Object.values(data);
  const returning = keys.join(', ');
  const result = await db.query(
    `INSERT INTO ${table} (${cols}) VALUES (${paramPlaceholders}) RETURNING *`,
    values
  );
  return result.rows[0];
}

/**
 * Update a row by id
 */
async function update(table, id, data) {
  const keys = Object.keys(data);
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = [...Object.values(data), id];
  const result = await db.query(
    `UPDATE ${table} SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

/**
 * Soft delete a row
 */
async function softDelete(table, id) {
  const result = await db.query(
    `UPDATE ${table} SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Hard delete a row
 */
async function remove(table, id) {
  const result = await db.query(
    `DELETE FROM ${table} WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Build WHERE clause from object
 */
function buildWhere(where) {
  return Object.entries(where)
    .map(([key], i) => {
      if (key.includes('__gte')) return `${key.replace('__gte', '')} >= $${i + 1}`;
      if (key.includes('__lte')) return `${key.replace('__lte', '')} <= $${i + 1}`;
      if (key.includes('__gt')) return `${key.replace('__gt', '')} > $${i + 1}`;
      if (key.includes('__lt')) return `${key.replace('__lt', '')} < $${i + 1}`;
      if (key.includes('__like')) return `${key.replace('__like', '')} ILIKE $${i + 1}`;
      if (key.includes('__in')) return `${key.replace('__in', '')} = ANY($${i + 1})`;
      return `${key} = $${i + 1}`;
    })
    .join(' AND ');
}

module.exports = {
  query,
  transaction,
  findOne,
  findMany,
  count,
  insert,
  update,
  softDelete,
  remove,
  buildWhere,
};
