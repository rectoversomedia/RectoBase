const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validator');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticateJWT } = require('../middleware/auth');
const { extractTenant } = require('../middleware/tenant');
const customerService = require('../services/customer.service');
const db = require('../utils/db');
const { ok, created, error, paginated, notFound } = require('../utils/response');

const router = express.Router();

const customerValidation = [
  body('name')
    .trim().notEmpty().withMessage('Nama wajib diisi.')
    .isLength({ max: 100 }).withMessage('Nama maksimal 100 karakter.'),
  body('phone')
    .optional().trim().matches(/^[\d\s\+\-\(\)]{8,20}$/).withMessage('Format nomor telepon tidak valid.'),
  body('email')
    .optional().trim().isEmail().withMessage('Format email tidak valid.').normalizeEmail(),
  body('birthdate')
    .optional().isISO8601().withMessage('Format tanggal lahir tidak valid.'),
  body('gender')
    .optional().isIn(['male', 'female', 'other']).withMessage('Jenis kelamin tidak valid.'),
  body('address')
    .optional().trim().isLength({ max: 255 }).withMessage('Alamat maksimal 255 karakter.'),
  body('customer_type')
    .optional().isIn(['new', 'regular', 'loyal', 'vip', 'at_risk', 'churned']).withMessage('Tipe customer tidak valid.'),
  body('tags')
    .optional().isArray().withMessage('Tags harus array.'),
];

const pointsValidation = [
  body('points')
    .notEmpty().isInt().withMessage('Jumlah poin wajib diisi.'),
  body('type')
    .notEmpty().isIn(['add', 'deduct']).withMessage('Tipe poin tidak valid.'),
  body('reason')
    .optional().trim().isLength({ max: 255 }).withMessage('Alasan maksimal 255 karakter.'),
  body('reference_id')
    .optional().isUUID().withMessage('ID referensi tidak valid.'),
];

const tagsValidation = [
  body('tags')
    .isArray({ min: 1 }).withMessage('Tags harus array dengan minimal 1 item.'),
  body('tags.*')
    .trim().notEmpty().isLength({ max: 50 }).withMessage('Tag maksimal 50 karakter.'),
];

/**
 * GET /api/v1/customers
 * List customers with filters
 */
router.get(
  '/',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const {
      page = 1, limit = 20, search, type, start_date, end_date,
      min_spend, max_spend, sort = 'created_at'
    } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [req.user.tenantId];
    let where = 'WHERE c.tenant_id = $1 AND c.deleted_at IS NULL';
    let idx = 2;

    if (search) {
      where += ` AND (c.name ILIKE $${idx} OR c.phone ILIKE $${idx} OR c.email ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }
    if (type) {
      where += ` AND c.customer_type = $${idx}`;
      params.push(type);
      idx++;
    }
    if (start_date) {
      where += ` AND c.created_at >= $${idx}`;
      params.push(start_date);
      idx++;
    }
    if (end_date) {
      where += ` AND c.created_at <= $${idx}`;
      params.push(end_date);
      idx++;
    }
    if (min_spend) {
      where += ` AND COALESCE(c.total_spent, 0) >= $${idx}`;
      params.push(parseFloat(min_spend));
      idx++;
    }
    if (max_spend) {
      where += ` AND COALESCE(c.total_spent, 0) <= $${idx}`;
      params.push(parseFloat(max_spend));
      idx++;
    }

    const countResult = await db.query(
      `SELECT COUNT(*) FROM customers c ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const allowedSorts = ['name', 'total_spent', 'total_orders', 'last_order_at', 'created_at', 'points_balance'];
    const orderCol = allowedSorts.includes(sort) ? `c.${sort}` : 'c.created_at';

    const result = await db.query(
      `SELECT c.*,
              COALESCE(SUM(o.total), 0) as lifetime_value,
              COUNT(o.id) as total_orders
       FROM customers c
       LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'completed'
       ${where}
       GROUP BY c.id
       ORDER BY ${orderCol} DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit, 10), offset]
    );

    return paginated(res, result.rows, { page: parseInt(page, 10), limit: parseInt(limit, 10), total });
  })
);

/**
 * POST /api/v1/customers
 * Create new customer
 */
router.post(
  '/',
  authenticateJWT,
  extractTenant,
  customerValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { name, phone, email, birthdate, gender, address, customer_type = 'new', tags = [], notes } = req.body;

    // Check duplicate phone
    if (phone) {
      const existing = await db.query(
        'SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2 AND deleted_at IS NULL',
        [req.user.tenantId, phone]
      );
      if (existing.rows.length > 0) {
        return error(res, 409, 'Nomor telepon sudah terdaftar.');
      }
    }

    if (email) {
      const existingEmail = await db.query(
        'SELECT id FROM customers WHERE tenant_id = $1 AND email = $2 AND deleted_at IS NULL',
        [req.user.tenantId, email]
      );
      if (existingEmail.rows.length > 0) {
        return error(res, 409, 'Email sudah terdaftar.');
      }
    }

    const result = await db.transaction(async (client) => {
      const customer = await client.query(
        `INSERT INTO customers (tenant_id, name, phone, email, birthdate, gender, address, customer_type, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [req.user.tenantId, name, phone || null, email || null, birthdate || null, gender || null, address || null, customer_type, notes || null]
      );

      const inserted = customer.rows[0];

      // Add tags if provided
      if (tags.length > 0) {
        for (const tag of tags) {
          await client.query(
            `INSERT INTO customer_tags (tenant_id, customer_id, tag)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [req.user.tenantId, inserted.id, tag]
          );
        }
      }

      return inserted;
    });

    return created(res, result, 'Pelanggan berhasil dibuat.');
  })
);

/**
 * GET /api/v1/customers/:id
 * Get customer details with recent orders and activities
 */
router.get(
  '/:id',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT c.* FROM customers c WHERE c.id = $1 AND c.tenant_id = $2 AND c.deleted_at IS NULL`,
      [req.params.id, req.user.tenantId]
    );
    if (result.rows.length === 0) return notFound(res, 'Pelanggan tidak ditemukan.');

    const customer = result.rows[0];

    // Recent orders
    const recentOrders = await db.query(
      `SELECT o.id, o.order_number, o.total, o.status, o.created_at,
              out.name as outlet_name
       FROM orders o
       LEFT JOIN outlets out ON out.id = o.outlet_id
       WHERE o.customer_id = $1 AND o.tenant_id = $2
       ORDER BY o.created_at DESC LIMIT 10`,
      [req.params.id, req.user.tenantId]
    );

    // Activities
    const activities = await db.query(
      `SELECT * FROM customer_activities
       WHERE customer_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC LIMIT 20`,
      [req.params.id, req.user.tenantId]
    );

    // Tags
    const tagsResult = await db.query(
      `SELECT tag FROM customer_tags WHERE customer_id = $1 AND tenant_id = $2`,
      [req.params.id, req.user.tenantId]
    );

    // Points history
    const pointsHistory = await db.query(
      `SELECT ph.*, u.name as created_by_name
       FROM points_history ph
       LEFT JOIN users u ON u.id = ph.created_by
       WHERE ph.customer_id = $1 AND ph.tenant_id = $2
       ORDER BY ph.created_at DESC LIMIT 20`,
      [req.params.id, req.user.tenantId]
    );

    customer.recent_orders = recentOrders.rows;
    customer.activities = activities.rows;
    customer.tags = tagsResult.rows.map((r) => r.tag);
    customer.points_history = pointsHistory.rows;

    return ok(res, customer);
  })
);

/**
 * PUT /api/v1/customers/:id
 * Update customer
 */
router.put(
  '/:id',
  authenticateJWT,
  extractTenant,
  customerValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { name, phone, email, birthdate, gender, address, customer_type, notes } = req.body;

    if (phone) {
      const existing = await db.query(
        'SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2 AND id != $3 AND deleted_at IS NULL',
        [req.user.tenantId, phone, req.params.id]
      );
      if (existing.rows.length > 0) {
        return error(res, 409, 'Nomor telepon sudah terdaftar.');
      }
    }

    if (email) {
      const existingEmail = await db.query(
        'SELECT id FROM customers WHERE tenant_id = $1 AND email = $2 AND id != $3 AND deleted_at IS NULL',
        [req.user.tenantId, email, req.params.id]
      );
      if (existingEmail.rows.length > 0) {
        return error(res, 409, 'Email sudah terdaftar.');
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (birthdate !== undefined) updateData.birthdate = birthdate;
    if (gender !== undefined) updateData.gender = gender;
    if (address !== undefined) updateData.address = address;
    if (customer_type !== undefined) updateData.customer_type = customer_type;
    if (notes !== undefined) updateData.notes = notes;

    const result = await db.query(
      `UPDATE customers SET ${Object.keys(updateData).map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $${Object.keys(updateData).length + 2} AND deleted_at IS NULL
       RETURNING *`,
      [req.params.id, ...Object.values(updateData), req.user.tenantId]
    );

    if (result.rows.length === 0) return notFound(res, 'Pelanggan tidak ditemukan.');
    return ok(res, result.rows[0], 'Pelanggan berhasil diperbarui.');
  })
);

/**
 * DELETE /api/v1/customers/:id
 * Soft delete customer
 */
router.delete(
  '/:id',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `UPDATE customers SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
      [req.params.id, req.user.tenantId]
    );
    if (result.rows.length === 0) return notFound(res, 'Pelanggan tidak ditemukan.');
    return ok(res, null, 'Pelanggan berhasil dihapus.');
  })
);

/**
 * GET /api/v1/customers/:id/activities
 * Get customer activity log
 */
router.get(
  '/:id/activities',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const result = await db.query(
      `SELECT * FROM customer_activities
       WHERE customer_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [req.params.id, req.user.tenantId, parseInt(limit, 10), offset]
    );

    return ok(res, result.rows);
  })
);

/**
 * GET /api/v1/customers/:id/orders
 * Get customer's order history
 */
router.get(
  '/:id/orders',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [req.params.id, req.user.tenantId];
    let where = 'WHERE o.customer_id = $1 AND o.tenant_id = $2';
    let idx = 3;

    if (status) {
      where += ` AND o.status = $${idx}`;
      params.push(status);
      idx++;
    }

    const result = await db.query(
      `SELECT o.*, out.name as outlet_name
       FROM orders o
       LEFT JOIN outlets out ON out.id = o.outlet_id
       ${where}
       ORDER BY o.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit, 10), offset]
    );

    return ok(res, result.rows);
  })
);

/**
 * POST /api/v1/customers/:id/points
 * Add or deduct loyalty points
 */
router.post(
  '/:id/points',
  authenticateJWT,
  extractTenant,
  pointsValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { points, type, reason, reference_id } = req.body;

    const result = await customerService.adjustPoints(
      req.params.id,
      req.user.tenantId,
      parseInt(points, 10),
      type,
      reason || null,
      req.user.userId,
      reference_id || null
    );

    if (!result) return notFound(res, 'Pelanggan tidak ditemukan.');
    return ok(res, result, `Poin berhasil ${type === 'add' ? 'ditambahkan' : 'dikurangkan'}.`);
  })
);

/**
 * POST /api/v1/customers/:id/tags
 * Update customer tags
 */
router.post(
  '/:id',
  authenticateJWT,
  extractTenant,
  tagsValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { tags } = req.body;

    await db.transaction(async (client) => {
      // Remove existing tags
      await client.query(
        'DELETE FROM customer_tags WHERE customer_id = $1 AND tenant_id = $2',
        [req.params.id, req.user.tenantId]
      );

      // Add new tags
      for (const tag of tags) {
        await client.query(
          `INSERT INTO customer_tags (tenant_id, customer_id, tag) VALUES ($1, $2, $3)`,
          [req.user.tenantId, req.params.id, tag]
        );
      }

      // Log activity
      await client.query(
        `INSERT INTO customer_activities (tenant_id, customer_id, type, description)
         VALUES ($1, $2, 'tag_updated', $3)`,
        [req.user.tenantId, req.params.id, `Tags diupdate: ${tags.join(', ')}`]
      );
    });

    return ok(res, { tags }, 'Tag berhasil diupdate.');
  })
);

/**
 * POST /api/v1/customers/:id/segment
 * Manually trigger customer segmentation
 */
router.post(
  '/:id/segment',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const result = await customerService.segmentCustomer(req.params.id, req.user.tenantId);
    if (!result) return notFound(res, 'Pelanggan tidak ditemukan.');
    return ok(res, result, 'Segmentasi pelanggan berhasil diperbarui.');
  })
);

module.exports = router;
