const db = require('../config/database');
const { format, parseISO, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth } = require('date-fns');
const { toZonedTime } = require('date-fns-tz');

const TIMEZONE = 'Asia/Jakarta';

/**
 * Get daily sales report
 */
async function getDailyReport(tenantId, startDate, endDate, outletId) {
  const params = [tenantId];
  let idx = 2;
  let outletFilter = '';

  if (outletId) {
    outletFilter = ` AND o.outlet_id = $${idx}`;
    params.push(outletId);
    idx++;
  }

  if (startDate) {
    outletFilter += ` AND o.created_at >= $${idx}`;
    params.push(startDate);
    idx++;
  }
  if (endDate) {
    outletFilter += ` AND o.created_at <= $${idx}`;
    params.push(endDate);
    idx++;
  }

  // Main metrics
  const metrics = await db.query(
    `SELECT
       COUNT(o.id) as total_orders,
       COUNT(o.id) FILTER (WHERE o.status = 'completed') as completed_orders,
       COUNT(o.id) FILTER (WHERE o.status = 'cancelled') as cancelled_orders,
       COALESCE(SUM(o.total) FILTER (WHERE o.status = 'completed'), 0) as total_revenue,
       COALESCE(SUM(o.subtotal) FILTER (WHERE o.status = 'completed'), 0) as total_sales,
       COALESCE(SUM(o.discount_amount) FILTER (WHERE o.status = 'completed'), 0) as total_discounts,
       COALESCE(AVG(o.total) FILTER (WHERE o.status = 'completed'), 0) as avg_order_value
     FROM orders o
     WHERE o.tenant_id = $1${outletFilter}`,
    params
  );

  // By outlet breakdown
  const byOutlet = await db.query(
    `SELECT out.id, out.name, out.code,
            COUNT(o.id) as total_orders,
            COALESCE(SUM(o.total) FILTER (WHERE o.status = 'completed'), 0) as revenue,
            COALESCE(AVG(o.total) FILTER (WHERE o.status = 'completed'), 0) as avg_order
     FROM outlets out
     LEFT JOIN orders o ON o.outlet_id = out.id AND o.status = 'completed'${outletFilter.replace('o.tenant_id', 'o.tenant_id')}
     WHERE out.tenant_id = $1 AND out.deleted_at IS NULL
     GROUP BY out.id
     ORDER BY revenue DESC`,
    [tenantId]
  );

  // By payment method
  const byPayment = await db.query(
    `SELECT o.payment_method,
            COUNT(o.id) as order_count,
            COALESCE(SUM(o.total), 0) as total
     FROM orders o
     WHERE o.tenant_id = $1 AND o.status = 'completed'${outletFilter}
     GROUP BY o.payment_method`,
    params
  );

  // Hourly breakdown for today
  const hourly = await db.query(
    `SELECT EXTRACT(HOUR FROM o.created_at AT TIME ZONE 'Asia/Jakarta') as hour,
            COUNT(o.id) as orders,
            COALESCE(SUM(o.total), 0) as revenue
     FROM orders o
     WHERE o.tenant_id = $1
       AND DATE(o.created_at AT TIME ZONE 'Asia/Jakarta') = CURRENT_DATE
       AND o.status = 'completed'${outletFilter}
     GROUP BY EXTRACT(HOUR FROM o.created_at AT TIME ZONE 'Asia/Jakarta')
     ORDER BY hour`,
    params
  );

  return {
    summary: metrics.rows[0],
    byOutlet: byOutlet.rows,
    byPayment: byPayment.rows,
    hourly: hourly.rows,
  };
}

/**
 * Get summary report for today/week/month
 */
async function getSummaryReport(tenantId, period) {
  let dateFilter;
  if (period === 'today') {
    dateFilter = "AND DATE(o.created_at AT TIME ZONE 'Asia/Jakarta') = CURRENT_DATE";
  } else if (period === 'week') {
    dateFilter = "AND o.created_at >= DATE_TRUNC('week', CURRENT_DATE)";
  } else {
    dateFilter = "AND o.created_at >= DATE_TRUNC('month', CURRENT_DATE)";
  }

  const result = await db.query(
    `SELECT
       COUNT(o.id) as total_orders,
       COUNT(o.id) FILTER (WHERE o.status = 'completed') as completed_orders,
       COALESCE(SUM(o.total) FILTER (WHERE o.status = 'completed'), 0) as total_revenue,
       COALESCE(SUM(o.discount_amount) FILTER (WHERE o.status = 'completed'), 0) as total_discounts,
       COALESCE(AVG(o.total) FILTER (WHERE o.status = 'completed'), 0) as avg_order_value,
       COUNT(DISTINCT o.customer_id) FILTER (WHERE o.customer_id IS NOT NULL) as unique_customers
     FROM orders o
     WHERE o.tenant_id = $1 ${dateFilter}`,
    [tenantId]
  );

  // Compare with previous period
  let prevDateFilter;
  if (period === 'today') {
    prevDateFilter = "AND DATE(o.created_at AT TIME ZONE 'Asia/Jakarta') = CURRENT_DATE - INTERVAL '1 day'";
  } else if (period === 'week') {
    prevDateFilter = "AND o.created_at >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '1 week' AND o.created_at < DATE_TRUNC('week', CURRENT_DATE)";
  } else {
    prevDateFilter = "AND o.created_at >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month' AND o.created_at < DATE_TRUNC('month', CURRENT_DATE)";
  }

  const prev = await db.query(
    `SELECT
       COUNT(o.id) as total_orders,
       COALESCE(SUM(o.total) FILTER (WHERE o.status = 'completed'), 0) as total_revenue
     FROM orders o
     WHERE o.tenant_id = $1 ${prevDateFilter}`,
    [tenantId]
  );

  const current = result.rows[0];
  const previous = prev.rows[0];

  const revenueChange = previous.total_revenue > 0
    ? ((parseFloat(current.total_revenue) - parseFloat(previous.total_revenue)) / parseFloat(previous.total_revenue)) * 100
    : 0;

  return {
    current: {
      ...current,
      revenue_change_percent: Math.round(revenueChange * 10) / 10,
    },
    previous: previous.rows ? previous.rows[0] : previous,
    period,
  };
}

/**
 * Customer acquisition and retention report
 */
async function getCustomerReport(tenantId, { segment, start, end }) {
  const params = [tenantId];
  let idx = 2;
  let dateFilter = '';

  if (segment) {
    dateFilter += ` AND c.customer_type = $${idx}`;
    params.push(segment);
    idx++;
  }
  if (start) {
    dateFilter += ` AND c.created_at >= $${idx}`;
    params.push(start);
    idx++;
  }
  if (end) {
    dateFilter += ` AND c.created_at <= $${idx}`;
    params.push(end);
    idx++;
  }

  const bySegment = await db.query(
    `SELECT customer_type,
            COUNT(*) as count,
            COALESCE(SUM(total_spent), 0) as total_revenue,
            COALESCE(AVG(total_spent), 0) as avg_revenue,
            COALESCE(AVG(churn_score), 0) as avg_churn_score
     FROM customers c
     WHERE c.tenant_id = $1 AND c.deleted_at IS NULL${dateFilter}
     GROUP BY customer_type
     ORDER BY count DESC`,
    params
  );

  // New customers this month
  const newCustomers = await db.query(
    `SELECT COUNT(*) as count
     FROM customers c
     WHERE c.tenant_id = $1
       AND c.deleted_at IS NULL
       AND c.created_at >= DATE_TRUNC('month', CURRENT_DATE)`,
    [tenantId]
  );

  // Returning customers (ordered more than once)
  const returning = await db.query(
    `SELECT COUNT(*) as count
     FROM customers c
     WHERE c.tenant_id = $1
       AND c.deleted_at IS NULL
       AND c.total_orders > 1`,
    [tenantId]
  );

  // Top customers by revenue
  const topCustomers = await db.query(
    `SELECT c.id, c.name, c.phone, c.customer_type,
            c.total_spent, c.total_orders, c.last_order_at, c.churn_score
     FROM customers c
     WHERE c.tenant_id = $1 AND c.deleted_at IS NULL${dateFilter}
     ORDER BY c.total_spent DESC
     LIMIT 10`,
    params
  );

  return {
    bySegment: bySegment.rows,
    newThisMonth: parseInt(newCustomers.rows[0].count, 10),
    returning: parseInt(returning.rows[0].count, 10),
    topCustomers: topCustomers.rows,
  };
}

/**
 * Product performance report
 */
async function getProductReport(tenantId, { start, end, limit, category_id, sort }) {
  const params = [tenantId];
  let idx = 2;
  let dateFilter = '';
  let sortCol = sort === 'revenue' ? 'total_revenue DESC' : 'total_quantity DESC';

  if (start) {
    dateFilter += ` AND oi.created_at >= $${idx}`;
    params.push(start);
    idx++;
  }
  if (end) {
    dateFilter += ` AND oi.created_at <= $${idx}`;
    params.push(end);
    idx++;
  }
  if (category_id) {
    dateFilter += ` AND p.category_id = $${idx}`;
    params.push(category_id);
    idx++;
  }

  const topProducts = await db.query(
    `SELECT p.id, p.name, p.sku, p.price, p.category_id,
            c.name as category_name,
            SUM(oi.quantity) as total_quantity,
            SUM(oi.subtotal) as total_revenue,
            COALESCE(AVG(oi.subtotal), 0) as avg_price,
            COUNT(DISTINCT o.id) as order_count
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE oi.tenant_id = $1 AND o.status = 'completed'${dateFilter}
     GROUP BY p.id, p.name, p.sku, p.price, p.category_id, c.name
     ORDER BY ${sortCol}
     LIMIT $${idx}`,
    [...params, limit]
  );

  // Bottom products (least sold)
  const bottomProducts = await db.query(
    `SELECT p.id, p.name, p.stock, p.min_stock,
            COALESCE(SUM(oi.quantity), 0) as total_sold
     FROM products p
     LEFT JOIN order_items oi ON oi.product_id = p.id
     LEFT JOIN orders o ON o.id = oi.order_id AND o.status = 'completed'
     WHERE p.tenant_id = $1 AND p.deleted_at IS NULL AND p.is_active = true
     GROUP BY p.id
     ORDER BY total_sold ASC
     LIMIT 5`,
    [tenantId]
  );

  return {
    topProducts: topProducts.rows,
    bottomProducts: bottomProducts.rows,
  };
}

/**
 * Revenue report grouped by day/week/month
 */
async function getRevenueReport(tenantId, { start, end, group, outlet }) {
  let groupBy;
  if (group === 'week') groupBy = "DATE_TRUNC('week', o.created_at AT TIME ZONE 'Asia/Jakarta')";
  else if (group === 'month') groupBy = "DATE_TRUNC('month', o.created_at AT TIME ZONE 'Asia/Jakarta')";
  else groupBy = "DATE(o.created_at AT TIME ZONE 'Asia/Jakarta')";

  const params = [tenantId];
  let idx = 2;
  let where = 'o.tenant_id = $1 AND o.status = $2';
  params.push('completed');
  let outletFilter = '';

  if (outlet) {
    outletFilter = ` AND o.outlet_id = $${idx}`;
    params.push(outlet);
    idx++;
  }
  if (start) {
    outletFilter += ` AND o.created_at >= $${idx}`;
    params.push(start);
    idx++;
  }
  if (end) {
    outletFilter += ` AND o.created_at <= $${idx}`;
    params.push(end);
    idx++;
  }

  const result = await db.query(
    `SELECT ${groupBy} as period,
            COUNT(o.id) as order_count,
            COALESCE(SUM(o.total), 0) as revenue,
            COALESCE(SUM(o.discount_amount), 0) as discounts,
            COALESCE(AVG(o.total), 0) as avg_order_value,
            COUNT(DISTINCT o.customer_id) as unique_customers
     FROM orders o
     WHERE ${where}${outletFilter}
     GROUP BY ${groupBy}
     ORDER BY period DESC
     LIMIT 90`,
    params
  );

  // Cumulative revenue
  let cumulative = 0;
  const withCumulative = result.rows.map((row) => {
    cumulative += parseFloat(row.revenue);
    return { ...row, cumulative_revenue: cumulative };
  });

  return { timeSeries: withCumulative.reverse() };
}

/**
 * Payment method breakdown
 */
async function getPaymentReport(tenantId, { start, end, outlet }) {
  const params = [tenantId];
  let idx = 2;
  let dateFilter = '';

  if (outlet) {
    dateFilter += ` AND o.outlet_id = $${idx}`;
    params.push(outlet);
    idx++;
  }
  if (start) {
    dateFilter += ` AND o.created_at >= $${idx}`;
    params.push(start);
    idx++;
  }
  if (end) {
    dateFilter += ` AND o.created_at <= $${idx}`;
    params.push(end);
    idx++;
  }

  const result = await db.query(
    `SELECT o.payment_method,
            COUNT(o.id) as transaction_count,
            COALESCE(SUM(o.total), 0) as total_amount,
            COALESCE(AVG(o.total), 0) as avg_amount,
            (COUNT(o.id) * 100.0 / NULLIF(SUM(COUNT(o.id)) OVER(), 0)) as percentage
     FROM orders o
     WHERE o.tenant_id = $1 AND o.status = 'completed'${dateFilter}
     GROUP BY o.payment_method
     ORDER BY total_amount DESC`,
    params
  );

  return { byMethod: result.rows };
}

/**
 * Customer churn analysis
 */
async function getChurnReport(tenantId, { start, end }) {
  const params = [tenantId];
  let dateFilter = '';
  let idx = 2;

  if (start) {
    dateFilter += ` AND created_at >= $${idx}`;
    params.push(start);
    idx++;
  }
  if (end) {
    dateFilter += ` AND created_at <= $${idx}`;
    params.push(end);
    idx++;
  }

  const result = await db.query(
    `SELECT
       customer_type,
       COUNT(*) as customer_count,
       COALESCE(SUM(total_spent), 0) as total_revenue,
       COALESCE(AVG(churn_score), 0) as avg_churn_score,
       COUNT(*) FILTER (WHERE churn_score >= 70) as high_risk,
       COUNT(*) FILTER (WHERE churn_score >= 40 AND churn_score < 70) as medium_risk,
       COUNT(*) FILTER (WHERE churn_score < 40) as low_risk
     FROM customers
     WHERE tenant_id = $1 AND deleted_at IS NULL${dateFilter}
     GROUP BY customer_type
     ORDER BY customer_count DESC`,
    params
  );

  // Trend: customers who churned vs reactivated
  const churnTrend = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE customer_type = 'churned') as churned_count,
       COUNT(*) FILTER (WHERE customer_type IN ('loyal', 'vip')) as loyal_count
     FROM customers
     WHERE tenant_id = $1 AND deleted_at IS NULL${dateFilter}`,
    params
  );

  return {
    bySegment: result.rows,
    churnTrend: churnTrend.rows[0],
  };
}

module.exports = {
  getDailyReport,
  getSummaryReport,
  getCustomerReport,
  getProductReport,
  getRevenueReport,
  getPaymentReport,
  getChurnReport,
};
