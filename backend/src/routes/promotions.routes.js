const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validator');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticateJWT } = require('../middleware/auth');
const { extractTenant } = require('../middleware/tenant');
const promotionService = require('../services/promotion.service');
const db = require('../utils/db');
const { ok, created, paginated, notFound } = require('../utils/response');

const router = express.Router();

const promoValidation = [
  body('title')
    .trim().notEmpty().withMessage('Judul promo wajib diisi.')
    .isLength({ max: 200 }).withMessage('Judul promo maksimal 200 karakter.'),
  body('type')
    .notEmpty().withMessage('Tipe promo wajib dipilih.')
    .isIn(['discount_percent', 'discount_fixed', 'buy_x_get_y', 'point_multiplier', 'free_item']).withMessage('Tipe promo tidak valid.'),
  body('value')
    .optional().isFloat({ min: 0 }).withMessage('Nilai promo harus angka positif.'),
  body('start_date')
    .notEmpty().withMessage('Tanggal mulai wajib diisi.')
    .isISO8601().withMessage('Format tanggal tidak valid.'),
  body('end_date')
    .optional().isISO8601().withMessage('Format tanggal tidak valid.'),
  body('min_order')
    .optional().isFloat({ min: 0 }).withMessage('Minimal order harus angka positif.'),
  body('max_discount')
    .optional().isFloat({ min: 0 }).withMessage('Max diskon harus angka positif.'),
  body('is_active')
    .optional().isBoolean().withMessage('is_active harus boolean.'),
  body('target_segment')
    .optional().isIn(['all', 'vip', 'loyal', 'regular', 'new', 'at_risk', 'churned']).withMessage('Target segment tidak valid.'),
  body('outlet_ids')
    .optional().isArray().withMessage('Outlet IDs harus array.'),
  body('image_url')
    .optional().trim().isURL().withMessage('URL gambar tidak valid.'),
];

/**
 * GET /api/v1/promotions
 */
router.get(
  '/',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, is_active, type, search } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [req.user.tenantId];
    let where = 'WHERE tenant_id = $1 AND deleted_at IS NULL';
    let idx = 2;

    if (is_active !== undefined) {
      where += ` AND is_active = $${idx}`;
      params.push(is_active === 'true');
      idx++;
    }
    if (type) {
      where += ` AND type = $${idx}`;
      params.push(type);
      idx++;
    }
    if (search) {
      where += ` AND (title ILIKE $${idx} OR description ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const countResult = await db.query(
      `SELECT COUNT(*) FROM promotions ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await db.query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM promotion_recipients pr WHERE pr.promotion_id = p.id) as recipient_count,
              (SELECT COUNT(*) FROM promotion_recipients pr WHERE pr.promotion_id = p.id AND pr.sent_at IS NOT NULL) as sent_count
       FROM promotions p
       ${where}
       ORDER BY p.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit, 10), offset]
    );

    return paginated(res, result.rows, { page: parseInt(page, 10), limit: parseInt(limit, 10), total });
  })
);

/**
 * POST /api/v1/promotions
 */
router.post(
  '/',
  authenticateJWT,
  extractTenant,
  promoValidation,
  validate,
  asyncHandler(async (req, res) => {
    const {
      title, type, value, description, start_date, end_date,
      min_order, max_discount, is_active = true, target_segment = 'all',
      outlet_ids, image_url
    } = req.body;

    const result = await db.insert('promotions', {
      tenant_id: req.user.tenantId,
      title,
      type,
      value: value || 0,
      description: description || null,
      start_date,
      end_date: end_date || null,
      min_order: min_order || 0,
      max_discount: max_discount || null,
      is_active,
      target_segment,
      outlet_ids: outlet_ids ? JSON.stringify(outlet_ids) : null,
      image_url: image_url || null,
      created_by: req.user.userId,
    });

    return created(res, result, 'Promosi berhasil dibuat.');
  })
);

/**
 * GET /api/v1/promotions/:id
 */
router.get(
  '/:id',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT p.*, u.name as created_by_name
       FROM promotions p
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.id = $1 AND p.tenant_id = $2`,
      [req.params.id, req.user.tenantId]
    );
    if (result.rows.length === 0) return notFound(res, 'Promosi tidak ditemukan.');
    return ok(res, result.rows[0]);
  })
);

/**
 * PUT /api/v1/promotions/:id
 */
router.put(
  '/:id',
  authenticateJWT,
  extractTenant,
  promoValidation,
  validate,
  asyncHandler(async (req, res) => {
    const {
      title, type, value, description, start_date, end_date,
      min_order, max_discount, is_active, target_segment, outlet_ids, image_url
    } = req.body;

    const updateData = {
      ...(title !== undefined && { title }),
      ...(type !== undefined && { type }),
      ...(value !== undefined && { value }),
      ...(description !== undefined && { description }),
      ...(start_date !== undefined && { start_date }),
      ...(end_date !== undefined && { end_date }),
      ...(min_order !== undefined && { min_order }),
      ...(max_discount !== undefined && { max_discount }),
      ...(is_active !== undefined && { is_active }),
      ...(target_segment !== undefined && { target_segment }),
      ...(outlet_ids !== undefined && { outlet_ids: JSON.stringify(outlet_ids) }),
      ...(image_url !== undefined && { image_url }),
    };

    const result = await db.query(
      `UPDATE promotions SET ${Object.keys(updateData).map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $${Object.keys(updateData).length + 2}
       RETURNING *`,
      [req.params.id, ...Object.values(updateData), req.user.tenantId]
    );

    if (result.rows.length === 0) return notFound(res, 'Promosi tidak ditemukan.');
    return ok(res, result.rows[0], 'Promosi berhasil diperbarui.');
  })
);

/**
 * DELETE /api/v1/promotions/:id
 */
router.delete(
  '/:id',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `UPDATE promotions SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, req.user.tenantId]
    );
    if (result.rows.length === 0) return notFound(res, 'Promosi tidak ditemukan.');
    return ok(res, null, 'Promosi berhasil dihapus.');
  })
);

/**
 * POST /api/v1/promotions/:id/send
 * Send promotion to recipients via WhatsApp
 */
router.post(
  '/:id/send',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const result = await promotionService.sendPromotion(req.params.id, req.user.tenantId, req.user.userId);
    return ok(res, result, 'Promosi berhasil dijadwalkan untuk dikirim.');
  })
);

/**
 * GET /api/v1/promotions/:id/recipients
 */
router.get(
  '/:id/recipients',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 50, sent } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [req.params.id, req.user.tenantId];
    let where = 'WHERE pr.promotion_id = $1 AND pr.tenant_id = $2';
    let idx = 3;

    if (sent === 'true') where += ' AND pr.sent_at IS NOT NULL';
    else if (sent === 'false') where += ' AND pr.sent_at IS NULL';

    const result = await db.query(
      `SELECT pr.*, c.name as customer_name, c.phone as customer_phone
       FROM promotion_recipients pr
       LEFT JOIN customers c ON c.id = pr.customer_id
       ${where}
       ORDER BY pr.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit, 10), offset]
    );

    return ok(res, result.rows);
  })
);

/**
 * GET /api/v1/promotions/:id/stats
 */
router.get(
  '/:id/stats',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const stats = await db.query(
      `SELECT
         COUNT(*) as total_recipients,
         COUNT(*) FILTER (WHERE pr.sent_at IS NOT NULL) as total_sent,
         COUNT(*) FILTER (WHERE pr.sent_at IS NULL) as total_pending,
         COUNT(*) FILTER (WHERE pr.opened_at IS NOT NULL) as total_opened,
         COUNT(*) FILTER (WHERE pr.converted_at IS NOT NULL) as total_converted
       FROM promotion_recipients pr
       WHERE pr.promotion_id = $1 AND pr.tenant_id = $2`,
      [req.params.id, req.user.tenantId]
    );

    const promo = await db.query(
      'SELECT * FROM promotions WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenantId]
    );

    if (promo.rows.length === 0) return notFound(res, 'Promosi tidak ditemukan.');

    return ok(res, {
      ...stats.rows[0],
      promo: promo.rows[0],
    });
  })
);

module.exports = router;
