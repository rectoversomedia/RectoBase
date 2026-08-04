const { format } = require('date-fns');
const { toZonedTime } = require('date-fns-tz');
const db = require('../config/database');

const TIMEZONE = 'Asia/Jakarta';

/**
 * Generate a unique order number for a given tenant and outlet
 * Format: {OUTLET_CODE}-{YYYYMMDD}-{XXXX}
 * @param {string} tenantId
 * @param {string} outletId
 * @returns {Promise<string>}
 */
async function generateOrderNumber(tenantId, outletId) {
  // Get outlet code
  const outletResult = await db.query(
    'SELECT code FROM outlets WHERE id = $1 AND tenant_id = $2',
    [outletId, tenantId]
  );

  if (outletResult.rows.length === 0) {
    throw new Error('Outlet tidak ditemukan');
  }

  const outletCode = (outletResult.rows[0].code || 'XX').toUpperCase().substring(0, 4);

  // Get current date in Jakarta timezone
  const now = toZonedTime(new Date(), TIMEZONE);
  const dateStr = format(now, 'yyyyMMdd');

  // Get next sequence number for this outlet + date
  const counterKey = `order_seq:${tenantId}:${outletId}:${dateStr}`;

  // Use Redis INCR for atomic counter
  let seqNum = 1;
  try {
    const Redis = require('ioredis');
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      lazyConnect: true,
    });
    await redis.connect().catch(() => {});
    seqNum = await redis.incr(counterKey);
    if (seqNum === 1) {
      // Set expiry for end of day + 1 hour buffer
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);
      const ttl = Math.ceil((endOfDay.getTime() - now.getTime()) / 1000) + 3600;
      await redis.expire(counterKey, ttl);
    }
    await redis.quit().catch(() => {});
  } catch {
    // Fallback: use DB sequence
    const seqResult = await db.query(
      `SELECT COUNT(*) + 1 as seq
       FROM orders
       WHERE tenant_id = $1
         AND outlet_id = $2
         AND DATE(created_at AT TIME ZONE 'Asia/Jakarta') = CURRENT_DATE`
    );
    seqNum = parseInt(seqResult.rows[0].seq, 10);
  }

  const seqStr = String(seqNum).padStart(4, '0');
  return `${outletCode}-${dateStr}-${seqStr}`;
}

/**
 * Parse an order number back to its components
 * @param {string} orderNumber
 * @returns {{ outletCode: string, date: string, sequence: string }}
 */
function parseOrderNumber(orderNumber) {
  const parts = orderNumber.split('-');
  if (parts.length !== 3) {
    throw new Error('Format nomor order tidak valid');
  }
  return {
    outletCode: parts[0],
    date: parts[1],
    sequence: parts[2],
  };
}

module.exports = {
  generateOrderNumber,
  parseOrderNumber,
};
