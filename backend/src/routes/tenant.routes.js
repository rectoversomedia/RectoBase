const express = require('express');
const { body, param, query: queryValidator } = require('express-validator');
const { validate } = require('../middleware/validator');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticateJWT, requireRole } = require('../middleware/auth');
const { extractTenant } = require('../middleware/tenant');
const { tenantRateLimiter } = require('../middleware/rateLimiter');
const db = require('../utils/db');
const { ok, created, error, paginated, notFound } = require('../utils/response');

const router = express.Router();

// Validation rules
const outletValidation = [
  body('name')
    .trim().notEmpty().withMessage('Nama outlet wajib diisi.')
    .isLength({ max: 100 }).withMessage('Nama outlet maksimal 100 karakter.'),
  body('code')
    .trim().notEmpty().withMessage('Kode outlet wajib diisi.')
    .isLength({ min: 2, max: 10 }).withMessage('Kode outlet 2-10 karakter.')
    .matches(/^[A-Z0-9]+$/).withMessage('Kode outlet hanya huruf kapital dan angka.'),
  body('address')
    .optional().trim().isLength({ max: 255 }).withMessage('Alamat maksimal 255 karakter.'),
  body('phone')
    .optional().trim().matches(/^[\d\s\+\-\(\)]{8,20}$/).withMessage('Format nomor telepon tidak valid.'),
  body('is_active')
    .optional().isBoolean().withMessage('is_active harus boolean.'),
];

const settingsValidation = [
  body('key')
    .trim().notEmpty().withMessage('Key pengaturan wajib diisi.')
    .isLength({ max: 100 }).withMessage('Key maksimal 100 karakter.'),
  body('value')
    .optional(),
  body('type')
    .optional().isIn(['string', 'number', 'boolean', 'json']).withMessage('Tipe value tidak valid.'),
];

const bulkSettingsValidation = [
  body('settings')
    .isArray({ min: 1 }).withMessage('Settings harus array dengan minimal 1 item.'),
  body('settings.*.key')
    .trim().notEmpty().withMessage('Key pengaturan wajib diisi.'),
  body('settings.*.value')
    .optional(),
];

/**
 * GET /api/v1/tenant/outlets
 * List all outlets for this tenant
 */
router.get(
  '/outlets',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    let whereClause = 'WHERE tenant_id = $1';
    const params = [req.user.tenantId];
    let paramIdx = 2;

    if (search) {
      whereClause += ` AND (name ILIKE $${paramIdx} OR code ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    const countResult = await db.query(
      `SELECT COUNT(*) FROM outlets ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await db.query(
      `SELECT id, name, code, address, phone, is_active, created_at, updated_at
       FROM outlets ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, parseInt(limit, 10), offset]
    );

    return paginated(res, result.rows, { page: parseInt(page, 10), limit: parseInt(limit, 10), total });
  })
);

/**
 * POST /api/v1/tenant/outlets
 * Create new outlet
 */
router.post(
  '/outlets',
  authenticateJWT,
  extractTenant,
  tenantRateLimiter(50),
  outletValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { name, code, address, phone, is_active = true } = req.body;

    // Check code uniqueness within tenant
    const existing = await db.query(
      'SELECT id FROM outlets WHERE tenant_id = $1 AND code = $2',
      [req.user.tenantId, code.toUpperCase()]
    );
    if (existing.rows.length > 0) {
      return error(res, 409, 'Kode outlet sudah digunakan.');
    }

    const result = await db.insert('outlets', {
      tenant_id: req.user.tenantId,
      name,
      code: code.toUpperCase(),
      address: address || null,
      phone: phone || null,
      is_active,
    });

    return created(res, result, 'Outlet berhasil dibuat.');
  })
);

/**
 * GET /api/v1/tenant/outlets/:id
 * Get outlet by ID
 */
router.get(
  '/outlets/:id',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const result = await db.findOne(
      'outlets',
      { id: req.params.id, tenant_id: req.user.tenantId }
    );
    if (!result) return notFound(res, 'Outlet tidak ditemukan.');
    return ok(res, result);
  })
);

/**
 * PUT /api/v1/tenant/outlets/:id
 * Update outlet
 */
router.put(
  '/outlets/:id',
  authenticateJWT,
  extractTenant,
  outletValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { name, code, address, phone, is_active } = req.body;

    // Check code uniqueness if changing
    if (code) {
      const existing = await db.query(
        'SELECT id FROM outlets WHERE tenant_id = $1 AND code = $2 AND id != $3',
        [req.user.tenantId, code.toUpperCase(), req.params.id]
      );
      if (existing.rows.length > 0) {
        return error(res, 409, 'Kode outlet sudah digunakan.');
      }
    }

    const result = await db.update('outlets', req.params.id, {
      ...(name && { name }),
      ...(code && { code: code.toUpperCase() }),
      ...(address !== undefined && { address }),
      ...(phone !== undefined && { phone }),
      ...(is_active !== undefined && { is_active }),
    });

    if (!result) return notFound(res, 'Outlet tidak ditemukan.');
    return ok(res, result, 'Outlet berhasil diperbarui.');
  })
);

/**
 * DELETE /api/v1/tenant/outlets/:id
 * Soft delete outlet
 */
router.delete(
  '/outlets/:id',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `UPDATE outlets SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND id !=
         (SELECT main_outlet_id FROM tenants WHERE id = $2)
       RETURNING id`,
      [req.params.id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return error(res, 400, 'Tidak dapat menghapus outlet utama atau outlet tidak ditemukan.');
    }
    return ok(res, { id: req.params.id }, 'Outlet berhasil dihapus.');
  })
);

/**
 * GET /api/v1/tenant/settings
 * Get all settings for tenant
 */
router.get(
  '/settings',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT key, value, type FROM tenant_settings WHERE tenant_id = $1`,
      [req.user.tenantId]
    );
    // Convert array to key-value object
    const settings = {};
    for (const row of result.rows) {
      try {
        settings[row.key] = row.type === 'json' ? JSON.parse(row.value) : row.value;
      } catch {
        settings[row.key] = row.value;
      }
    }
    return ok(res, settings);
  })
);

/**
 * PUT /api/v1/tenant/settings
 * Upsert a single setting
 */
router.put(
  '/settings',
  authenticateJWT,
  extractTenant,
  settingsValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { key, value, type = 'string' } = req.body;
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

    await db.query(
      `INSERT INTO tenant_settings (tenant_id, key, value, type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = $3, type = $4, updated_at = NOW()`,
      [req.user.tenantId, key, stringValue, type]
    );

    return ok(res, { key, value, type }, 'Pengaturan berhasil disimpan.');
  })
);

/**
 * POST /api/v1/tenant/settings/bulk
 * Upsert multiple settings at once
 */
router.post(
  '/settings/bulk',
  authenticateJWT,
  extractTenant,
  bulkSettingsValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { settings } = req.body;

    await db.transaction(async (client) => {
      for (const item of settings) {
        const stringValue = typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value || '');
        await client.query(
          `INSERT INTO tenant_settings (tenant_id, key, value, type)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, key) DO UPDATE SET value = $3, type = $4, updated_at = NOW()`,
          [req.user.tenantId, item.key, stringValue, item.type || 'string']
        );
      }
    });

    return ok(res, { count: settings.length }, `${settings.length} pengaturan berhasil disimpan.`);
  })
);

module.exports = router;
