const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validator');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticateJWT, requireRole } = require('../middleware/auth');
const db = require('../utils/db');
const { ok, created, paginated, notFound } = require('../utils/response');

const router = express.Router();

/**
 * GET /api/v1/admin/merchants
 * List all tenants with stats (admin only)
 */
router.get(
  '/merchants',
  authenticateJWT,
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, status, plan, search } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [];
    let where = '';
    let idx = 1;

    if (status) {
      where += `${where ? ' AND' : ''} t.status = $${idx}`;
      params.push(status);
      idx++;
    }
    if (plan) {
      where += `${where ? ' AND' : ''} t.plan = $${idx}`;
      params.push(plan);
      idx++;
    }
    if (search) {
      where += `${where ? ' AND' : ''} (t.name ILIKE $${idx} OR u.email ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const whereClause = where ? `WHERE ${where}` : '';

    const countResult = await db.query(
      `SELECT COUNT(*) FROM tenants t LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'owner' ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await db.query(
      `SELECT t.id, t.name, t.plan, t.status, t.created_at,
              u.email as owner_email, u.name as owner_name,
              (SELECT COUNT(*) FROM outlets WHERE tenant_id = t.id AND deleted_at IS NULL) as outlet_count,
              (SELECT COUNT(*) FROM customers WHERE tenant_id = t.id AND deleted_at IS NULL) as customer_count,
              (SELECT COUNT(*) FROM orders WHERE tenant_id = t.id AND status = 'completed') as order_count,
              (SELECT COALESCE(SUM(total), 0) FROM orders WHERE tenant_id = t.id AND status = 'completed') as total_revenue
       FROM tenants t
       LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'owner'
       ${whereClause}
       ORDER BY t.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit, 10), offset]
    );

    return paginated(res, result.rows, { page: parseInt(page, 10), limit: parseInt(limit, 10), total });
  })
);

/**
 * GET /api/v1/admin/merchants/:id
 * Get tenant details
 */
router.get(
  '/merchants/:id',
  authenticateJWT,
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT t.*,
              u.email as owner_email, u.name as owner_name, u.phone as owner_phone
       FROM tenants t
       LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'owner'
       WHERE t.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) return notFound(res, 'Merchant tidak ditemukan.');

    const tenant = result.rows[0];

    // Additional stats
    const stats = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM outlets WHERE tenant_id = $1 AND deleted_at IS NULL) as outlets,
         (SELECT COUNT(*) FROM products WHERE tenant_id = $1 AND deleted_at IS NULL) as products,
         (SELECT COUNT(*) FROM customers WHERE tenant_id = $1 AND deleted_at IS NULL) as customers,
         (SELECT COUNT(*) FROM orders WHERE tenant_id = $1) as total_orders,
         (SELECT COUNT(*) FROM orders WHERE tenant_id = $1 AND status = 'completed') as completed_orders,
         (SELECT COALESCE(SUM(total), 0) FROM orders WHERE tenant_id = $1 AND status = 'completed') as total_revenue,
         (SELECT COALESCE(SUM(total), 0) FROM orders WHERE tenant_id = $1 AND status = 'completed' AND created_at >= DATE_TRUNC('month', CURRENT_DATE)) as monthly_revenue`,
      [req.params.id]
    );

    tenant.stats = stats.rows[0];
    return ok(res, tenant);
  })
);

/**
 * PUT /api/v1/admin/merchants/:id
 * Update tenant (activate/suspend/update plan)
 */
router.put(
  '/merchants/:id',
  authenticateJWT,
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const { status, plan, name, logo_url, settings } = req.body;

    const updateData = {};
    if (status !== undefined) updateData.status = status;
    if (plan !== undefined) updateData.plan = plan;
    if (name !== undefined) updateData.name = name;
    if (logo_url !== undefined) updateData.logo_url = logo_url;

    if (Object.keys(updateData).length === 0) {
      // Only update settings
      if (settings) {
        await db.transaction(async (client) => {
          for (const [key, value] of Object.entries(settings)) {
            const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
            await client.query(
              `INSERT INTO tenant_settings (tenant_id, key, value)
               VALUES ($1, $2, $3)
               ON CONFLICT (tenant_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
              [req.params.id, key, stringValue]
            );
          }
        });
      }
      return ok(res, null, 'Pengaturan berhasil disimpan.');
    }

    const result = await db.query(
      `UPDATE tenants SET ${Object.keys(updateData).map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id, ...Object.values(updateData)]
    );

    if (result.rows.length === 0) return notFound(res, 'Merchant tidak ditemukan.');

    return ok(res, result.rows[0], 'Merchant berhasil diperbarui.');
  })
);

/**
 * GET /api/v1/admin/revenue
 * Aggregated revenue across all merchants
 */
router.get(
  '/revenue',
  authenticateJWT,
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const { start, end, period = 'day' } = req.query;

    let groupBy = "DATE_TRUNC('day', o.created_at)";
    if (period === 'week') groupBy = "DATE_TRUNC('week', o.created_at)";
    if (period === 'month') groupBy = "DATE_TRUNC('month', o.created_at)";

    let dateFilter = '';
    const params = [];
    let idx = 1;

    if (start) {
      dateFilter += `${dateFilter ? ' AND' : ''} o.created_at >= $${idx}`;
      params.push(start);
      idx++;
    }
    if (end) {
      dateFilter += `${dateFilter ? ' AND' : ''} o.created_at <= $${idx}`;
      params.push(end);
      idx++;
    }

    const whereClause = dateFilter ? `WHERE ${dateFilter}` : '';

    const result = await db.query(
      `SELECT ${groupBy} as period,
              COUNT(DISTINCT o.tenant_id) as merchant_count,
              COUNT(o.id) as order_count,
              COALESCE(SUM(o.total), 0) as total_revenue,
              COALESCE(AVG(o.total), 0) as avg_order_value
       FROM orders o
       ${whereClause}
       WHERE o.status = 'completed'
       GROUP BY ${groupBy}
       ORDER BY period DESC
       LIMIT 90`,
      params
    );

    const totals = await db.query(
      `SELECT COUNT(id) as total_orders, COALESCE(SUM(total), 0) as total_revenue
       FROM orders o ${whereClause} WHERE o.status = 'completed'`,
      params
    );

    return ok(res, {
      timeSeries: result.rows,
      totals: totals.rows[0],
    });
  })
);

/**
 * POST /api/v1/admin/send-notification
 * Send notification to merchants
 */
router.post(
  '/send-notification',
  authenticateJWT,
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const { tenant_id, title, message, type = 'info' } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: 'Title dan message wajib diisi.',
      });
    }

    await db.insert('admin_notifications', {
      tenant_id: tenant_id || null,
      title,
      message,
      type,
      sent_by: req.user.userId,
    });

    return created(res, null, 'Notifikasi berhasil dikirim.');
  })
);

/**
 * GET /api/v1/admin/stats
 * Dashboard stats for admin
 */
router.get(
  '/stats',
  authenticateJWT,
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const stats = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM tenants WHERE status = 'active') as active_merchants,
        (SELECT COUNT(*) FROM tenants WHERE status = 'suspended') as suspended_merchants,
        (SELECT COUNT(*) FROM tenants WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)) as new_merchants_this_month,
        (SELECT COUNT(*) FROM users WHERE role = 'owner') as total_owners,
        (SELECT COUNT(*) FROM orders WHERE created_at >= DATE_TRUNC('day', CURRENT_DATE)) as orders_today,
        (SELECT COUNT(*) FROM orders WHERE created_at >= DATE_TRUNC('day', CURRENT_DATE) AND status = 'completed') as completed_today,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE created_at >= DATE_TRUNC('day', CURRENT_DATE) AND status = 'completed') as revenue_today,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE) AND status = 'completed') as revenue_this_month
    `);

    return ok(res, stats.rows[0]);
  })
);

module.exports = router;
