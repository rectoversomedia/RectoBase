const db = require('../config/database');

/**
 * Segment a customer based on their behavior
 * Categories: VIP, Loyal, At Risk, Churned, New, Regular
 */
async function segmentCustomer(customerId, tenantId) {
  const customerResult = await db.query(
    `SELECT c.*,
            COUNT(o.id) as order_count,
            COALESCE(SUM(o.total), 0) as lifetime_value,
            MAX(o.created_at) as last_order_date,
            EXTRACT(DAY FROM (NOW() - MAX(o.created_at))) as days_since_last_order
     FROM customers c
     LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'completed'
     WHERE c.id = $1 AND c.tenant_id = $2
     GROUP BY c.id`,
    [customerId, tenantId]
  );

  if (customerResult.rows.length === 0) return null;

  const c = customerResult.rows[0];
  const orderCount = parseInt(c.order_count, 10) || 0;
  const lifetimeValue = parseFloat(c.lifetime_value) || 0;
  const daysSinceLastOrder = parseInt(c.days_since_last_order, 10) || 999;
  const accountAgeDays = Math.ceil((Date.now() - new Date(c.created_at).getTime()) / (1000 * 60 * 60 * 24));

  let newType = c.customer_type;

  // VIP: lifetime value > 1M OR top 10% by spend
  if (lifetimeValue > 1000000) {
    newType = 'vip';
  } else {
    // Check if top 10% by spend
    const percentileResult = await db.query(
      `SELECT PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY COALESCE(SUM(o.total), 0)) as p90
       FROM customers c2
       LEFT JOIN orders o ON o.customer_id = c2.id AND o.status = 'completed'
       WHERE c2.tenant_id = $1 AND c2.deleted_at IS NULL
       GROUP BY c2.id`,
      [tenantId]
    );
    if (percentileResult.rows.length > 0) {
      const p90 = parseFloat(percentileResult.rows[0].p90) || 0;
      if (lifetimeValue >= p90 && orderCount >= 3) {
        newType = 'vip';
      }
    }
  }

  // Loyal: 5+ orders, avg > 100k, last order < 30 days
  if (newType !== 'vip' && orderCount >= 5) {
    const avgOrderValue = lifetimeValue / orderCount;
    if (avgOrderValue > 100000 && daysSinceLastOrder < 30) {
      newType = 'loyal';
    }
  }

  // At Risk: last order 30-60 days, declining frequency
  if (newType !== 'vip' && newType !== 'loyal' && daysSinceLastOrder >= 30 && daysSinceLastOrder <= 60) {
    newType = 'at_risk';
  }

  // Churned: last order > 60 days
  if (newType !== 'vip' && newType !== 'loyal' && daysSinceLastOrder > 60) {
    newType = 'churned';
  }

  // New: account < 30 days, orders <= 2
  if (accountAgeDays <= 30 && orderCount <= 2) {
    newType = 'new';
  }

  // Regular: everything else
  if (['vip', 'loyal', 'at_risk', 'churned', 'new'].indexOf(newType) === -1) {
    newType = 'regular';
  }

  // Update only if changed
  if (newType !== c.customer_type) {
    await db.query(
      `UPDATE customers SET customer_type = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [newType, customerId, tenantId]
    );

    // Log activity
    await db.query(
      `INSERT INTO customer_activities (tenant_id, customer_id, type, description)
       VALUES ($1, $2, 'segment_changed', $3)`,
      [tenantId, customerId, `Segment berubah dari "${c.customer_type}" menjadi "${newType}"`]
    );
  }

  return { id: customerId, customer_type: newType, order_count: orderCount, lifetime_value: lifetimeValue };
}

/**
 * Calculate and update churn score (0-100)
 * Higher score = more likely to churn
 */
async function updateChurnScore(customerId, tenantId) {
  const customerResult = await db.query(
    `SELECT c.*,
            COUNT(o.id) FILTER (WHERE o.created_at >= NOW() - INTERVAL '30 days') as recent_orders,
            COUNT(o.id) FILTER (WHERE o.created_at >= NOW() - INTERVAL '60 days' AND o.created_at < NOW() - INTERVAL '30 days') as prev_orders,
            COALESCE(SUM(o.total) FILTER (WHERE o.created_at >= NOW() - INTERVAL '30 days'), 0) as recent_spend,
            MAX(o.created_at) as last_order_date
     FROM customers c
     LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'completed'
     WHERE c.id = $1 AND c.tenant_id = $2
     GROUP BY c.id`,
    [customerId, tenantId]
  );

  if (customerResult.rows.length === 0) return null;

  const c = customerResult.rows[0];
  const recentOrders = parseInt(c.recent_orders, 10) || 0;
  const prevOrders = parseInt(c.prev_orders, 10) || 0;
  const recentSpend = parseFloat(c.recent_spend) || 0;
  const daysSinceLastOrder = c.last_order_date
    ? Math.ceil((Date.now() - new Date(c.last_order_date).getTime()) / (1000 * 60 * 60 * 24))
    : 999;

  let score = 0;

  // Days since last order (max 40 points)
  if (daysSinceLastOrder <= 7) score += 0;
  else if (daysSinceLastOrder <= 14) score += 10;
  else if (daysSinceLastOrder <= 30) score += 25;
  else if (daysSinceLastOrder <= 60) score += 35;
  else score += 40;

  // Order frequency decline (max 30 points)
  if (prevOrders > 0) {
    const declineRatio = (prevOrders - recentOrders) / prevOrders;
    if (declineRatio > 0.5) score += 30;
    else if (declineRatio > 0.3) score += 20;
    else if (declineRatio > 0) score += 10;
  } else if (recentOrders === 0) {
    score += 15; // Never ordered in recent window
  }

  // Spend decline (max 20 points)
  const avgSpend = c.total_orders > 0 ? c.total_spent / c.total_orders : 0;
  if (avgSpend > 0 && recentSpend < avgSpend * 0.5) {
    score += 20;
  } else if (avgSpend > 0 && recentSpend < avgSpend * 0.8) {
    score += 10;
  }

  // Low engagement (max 10 points)
  if (c.total_orders <= 2) score += 10;
  else if (c.total_orders <= 5) score += 5;

  // Update churn score
  await db.query(
    `UPDATE customers SET churn_score = $1, updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3`,
    [score, customerId, tenantId]
  );

  return { id: customerId, churn_score: score };
}

/**
 * Adjust loyalty points for a customer
 */
async function adjustPoints(customerId, tenantId, points, type, reason, userId, referenceId) {
  return db.transaction(async (client) => {
    const customerResult = await client.query(
      'SELECT id, points_balance FROM customers WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE',
      [customerId, tenantId]
    );

    if (customerResult.rows.length === 0) return null;

    const currentBalance = parseInt(customerResult.rows[0].points_balance, 10) || 0;
    const newBalance = type === 'add' ? currentBalance + Math.abs(points) : Math.max(0, currentBalance - Math.abs(points));

    await client.query(
      'UPDATE customers SET points_balance = $1, updated_at = NOW() WHERE id = $2',
      [newBalance, customerId]
    );

    await client.query(
      `INSERT INTO points_history (tenant_id, customer_id, points, balance_after, type, reason, reference_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tenantId, customerId, type === 'add' ? Math.abs(points) : -Math.abs(points), newBalance, type, reason, referenceId, userId]
    );

    // Log activity
    await client.query(
      `INSERT INTO customer_activities (tenant_id, customer_id, type, description)
       VALUES ($1, $2, 'points_${type}', $3)`,
      [
        tenantId,
        customerId,
        type === 'add'
          ? `Mendapat ${Math.abs(points)} poin. ${reason ? `Alasan: ${reason}` : ''}`
          : `Menukarkan ${Math.abs(points)} poin. ${reason ? `Alasan: ${reason}` : ''}`,
      ]
    );

    return { customer_id: customerId, points, type, balance: newBalance, reason };
  });
}

/**
 * Get customer segments summary
 */
async function getSegmentsSummary(tenantId) {
  const result = await db.query(
    `SELECT customer_type, COUNT(*) as count,
            COALESCE(SUM(total_spent), 0) as total_revenue,
            COALESCE(AVG(total_spent), 0) as avg_revenue,
            COALESCE(AVG(churn_score), 0) as avg_churn_score
     FROM customers
     WHERE tenant_id = $1 AND deleted_at IS NULL
     GROUP BY customer_type`,
    [tenantId]
  );

  return result.rows;
}

module.exports = {
  segmentCustomer,
  updateChurnScore,
  adjustPoints,
  getSegmentsSummary,
};
