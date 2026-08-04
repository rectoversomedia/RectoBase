const db = require('../config/database');

/**
 * Get loyalty program for a tenant
 */
async function getLoyaltyProgram(tenantId) {
  const result = await db.query(
    `SELECT * FROM loyalty_programs WHERE tenant_id = $1 AND is_active = true LIMIT 1`,
    [tenantId]
  );
  return result.rows[0] || null;
}

/**
 * Earn points from a purchase
 */
async function earnPoints(tenantId, customerId, orderTotal, orderId) {
  const program = await getLoyaltyProgram(tenantId);
  if (!program) return null;

  const points = Math.floor(orderTotal / program.points_per_rupiah);
  if (points <= 0) return { points: 0, balance: 0 };

  return db.transaction(async (client) => {
    const customerResult = await client.query(
      'SELECT points_balance FROM customers WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [customerId, tenantId]
    );

    if (customerResult.rows.length === 0) return null;

    const currentBalance = parseInt(customerResult.rows[0].points_balance, 10) || 0;
    const newBalance = currentBalance + points;

    await client.query(
      'UPDATE customers SET points_balance = $1 WHERE id = $2',
      [newBalance, customerId]
    );

    await client.query(
      `INSERT INTO points_history (tenant_id, customer_id, points, balance_after, type, reason, reference_id)
       VALUES ($1, $2, $3, $4, 'earn', 'Pembelian', $5)`,
      [tenantId, customerId, points, newBalance, orderId]
    );

    return { points, balance: newBalance, program_name: program.name };
  });
}

/**
 * Redeem points for a reward
 */
async function redeemPoints(tenantId, customerId, pointsToRedeem, reason, userId) {
  const program = await getLoyaltyProgram(tenantId);
  if (!program) {
    const err = new Error('Program loyalty tidak ditemukan.');
    err.statusCode = 404;
    throw err;
  }

  return db.transaction(async (client) => {
    const customerResult = await client.query(
      'SELECT id, points_balance FROM customers WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [customerId, tenantId]
    );

    if (customerResult.rows.length === 0) {
      const err = new Error('Pelanggan tidak ditemukan.');
      err.statusCode = 404;
      throw err;
    }

    const currentBalance = parseInt(customerResult.rows[0].points_balance, 10) || 0;

    if (currentBalance < pointsToRedeem) {
      const err = new Error(`Poin tidak cukup. Saldo Anda: ${currentBalance} poin. Butuh: ${pointsToRedeem} poin.`);
      err.statusCode = 400;
      throw err;
    }

    const newBalance = currentBalance - pointsToRedeem;
    const rewardValue = Math.floor(pointsToRedeem / program.redemption_rate);

    await client.query(
      'UPDATE customers SET points_balance = $1 WHERE id = $2',
      [newBalance, customerId]
    );

    await client.query(
      `INSERT INTO points_history (tenant_id, customer_id, points, balance_after, type, reason, created_by)
       VALUES ($1, $2, $3, $4, 'redeem', $5, $6)`,
      [tenantId, customerId, -pointsToRedeem, newBalance, reason || 'Penukaran poin', userId]
    );

    // Log activity
    await client.query(
      `INSERT INTO customer_activities (tenant_id, customer_id, type, description)
       VALUES ($1, $2, 'points_redeemed', $3)`,
      [tenantId, customerId, `Menukarkan ${pointsToRedeem} poin untuk ${rewardValue > 0 ? `Rp ${rewardValue.toLocaleString('id-ID')}` : 'reward'}`]
    );

    return {
      points_redeemed: pointsToRedeem,
      new_balance: newBalance,
      reward_value: rewardValue,
      program_name: program.name,
    };
  });
}

/**
 * Get points history for a customer
 */
async function getPointsHistory(tenantId, customerId, { page = 1, limit = 20 } = {}) {
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  const result = await db.query(
    `SELECT ph.*, u.name as created_by_name
     FROM points_history ph
     LEFT JOIN users u ON u.id = ph.created_by
     WHERE ph.tenant_id = $1 AND ph.customer_id = $2
     ORDER BY ph.created_at DESC
     LIMIT $3 OFFSET $4`,
    [tenantId, customerId, parseInt(limit, 10), offset]
  );

  const totalResult = await db.query(
    'SELECT COUNT(*) FROM points_history WHERE tenant_id = $1 AND customer_id = $2',
    [tenantId, customerId]
  );

  const balanceResult = await db.query(
    'SELECT points_balance FROM customers WHERE id = $1 AND tenant_id = $2',
    [customerId, tenantId]
  );

  return {
    history: result.rows,
    total: parseInt(totalResult.rows[0].count, 10),
    current_balance: parseInt(balanceResult.rows[0]?.points_balance, 10) || 0,
  };
}

/**
 * Get available rewards for redemption
 */
async function getRewards(tenantId) {
  const result = await db.query(
    `SELECT * FROM loyalty_rewards WHERE tenant_id = $1 AND is_active = true ORDER BY points_required ASC`,
    [tenantId]
  );
  return result.rows;
}

/**
 * Create a loyalty reward
 */
async function createReward(tenantId, data) {
  const { name, description, points_required, reward_type, reward_value, is_active = true } = data;

  const result = await db.insert('loyalty_rewards', {
    tenant_id: tenantId,
    name,
    description: description || null,
    points_required,
    reward_type: reward_type || 'fixed',
    reward_value: reward_value || 0,
    is_active,
  });

  return result;
}

/**
 * Update loyalty program settings
 */
async function updateProgram(tenantId, data) {
  const { name, points_per_rupiah, redemption_rate, min_points_redeem, is_active } = data;

  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (points_per_rupiah !== undefined) updateData.points_per_rupiah = points_per_rupiah;
  if (redemption_rate !== undefined) updateData.redemption_rate = redemption_rate;
  if (min_points_redeem !== undefined) updateData.min_points_redeem = min_points_redeem;
  if (is_active !== undefined) updateData.is_active = is_active;

  const result = await db.query(
    `UPDATE loyalty_programs SET ${Object.keys(updateData).map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW()
     WHERE tenant_id = $1 RETURNING *`,
    [tenantId, ...Object.values(updateData)]
  );

  return result.rows[0] || null;
}

/**
 * Calculate customer tier based on lifetime value
 */
async function calculateTier(tenantId, customerId) {
  const result = await db.query(
    `SELECT total_spent, total_orders, last_order_at FROM customers WHERE id = $1 AND tenant_id = $2`,
    [customerId, tenantId]
  );

  if (result.rows.length === 0) return null;

  const c = result.rows[0];
  const spent = parseFloat(c.total_spent) || 0;

  let tier;
  if (spent >= 10000000) tier = 'platinum';
  else if (spent >= 5000000) tier = 'gold';
  else if (spent >= 1000000) tier = 'silver';
  else tier = 'bronze';

  await db.query('UPDATE customers SET loyalty_tier = $1 WHERE id = $2', [tier, customerId]);

  return { customer_id: customerId, tier };
}

module.exports = {
  getLoyaltyProgram,
  earnPoints,
  redeemPoints,
  getPointsHistory,
  getRewards,
  createReward,
  updateProgram,
  calculateTier,
};
