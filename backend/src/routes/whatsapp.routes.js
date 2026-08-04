const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validator');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticateJWT } = require('../middleware/auth');
const { extractTenant } = require('../middleware/tenant');
const whatsappService = require('../services/whatsapp.service');
const db = require('../utils/db');
const { ok, created, paginated } = require('../utils/response');

const router = express.Router();

const sendValidation = [
  body('to')
    .notEmpty().withMessage('Nomor tujuan wajib diisi.')
    .matches(/^[\d\s\+\-]{8,20}$/).withMessage('Format nomor telepon tidak valid.'),
  body('template')
    .notEmpty().withMessage('Template pesan wajib dipilih.'),
  body('data')
    .optional().isObject().withMessage('Data harus object.'),
];

const broadcastValidation = [
  body('customer_ids')
    .isArray({ min: 1 }).withMessage('Minimal 1 customer wajib dipilih.'),
  body('template')
    .notEmpty().withMessage('Template pesan wajib dipilih.'),
  body('data')
    .optional().isObject().withMessage('Data harus object.'),
];

const birthdayTemplateValidation = [
  body('promo_code')
    .optional().trim().isLength({ max: 50 }).withMessage('Kode promo maksimal 50 karakter.'),
  body('discount_percent')
    .optional().isInt({ min: 0, max: 100 }).withMessage('Persen diskon harus 0-100.'),
  body('message_template')
    .optional().trim().isLength({ max: 500 }).withMessage('Template pesan maksimal 500 karakter.'),
];

const winbackValidation = [
  body('min_days_inactive')
    .optional().isInt({ min: 30 }).withMessage('Minimal 30 hari.'),
  body('message_template')
    .optional().trim().isLength({ max: 500 }).withMessage('Template pesan maksimal 500 karakter.'),
  body('include_promo')
    .optional().isBoolean().withMessage('include_promo harus boolean.'),
];

/**
 * POST /api/v1/whatsapp/send
 * Send ad-hoc WhatsApp message
 */
router.post(
  '/send',
  authenticateJWT,
  extractTenant,
  sendValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { to, template, data = {}, session = 'default' } = req.body;

    const result = await whatsappService.sendMessage(
      to,
      template,
      data,
      req.user.tenantId,
      req.user.userId
    );

    // Log message
    await db.insert('whatsapp_messages', {
      tenant_id: req.user.tenantId,
      recipient: to,
      template,
      payload: JSON.stringify(data),
      status: result.status || 'sent',
      sent_by: req.user.userId,
    });

    return created(res, result, 'Pesan berhasil dikirim.');
  })
);

/**
 * POST /api/v1/whatsapp/broadcast
 * Send promotional message to multiple customers
 */
router.post(
  '/broadcast',
  authenticateJWT,
  extractTenant,
  broadcastValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { customer_ids, template, data = {} } = req.body;

    // Get customer phone numbers
    const customers = await db.query(
      `SELECT id, name, phone FROM customers
       WHERE id = ANY($1) AND tenant_id = $2 AND deleted_at IS NULL AND phone IS NOT NULL`,
      [customer_ids, req.user.tenantId]
    );

    if (customers.rows.length === 0) {
      return ok(res, { sent: 0, failed: customer_ids.length }, 'Tidak ada pelanggan dengan nomor telepon yang valid.');
    }

    const results = await whatsappService.broadcastMessage(
      customers.rows,
      template,
      data,
      req.user.tenantId,
      req.user.userId
    );

    return created(res, results, `${results.sent} pesan berhasil dijadwalkan, ${results.failed} gagal.`);
  })
);

/**
 * GET /api/v1/whatsapp/messages
 * Get WhatsApp message history
 */
router.get(
  '/messages',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 50, recipient, status, template } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [req.user.tenantId];
    let where = 'WHERE tenant_id = $1';
    let idx = 2;

    if (recipient) {
      where += ` AND recipient ILIKE $${idx}`;
      params.push(`%${recipient}%`);
      idx++;
    }
    if (status) {
      where += ` AND status = $${idx}`;
      params.push(status);
      idx++;
    }
    if (template) {
      where += ` AND template = $${idx}`;
      params.push(template);
      idx++;
    }

    const countResult = await db.query(
      `SELECT COUNT(*) FROM whatsapp_messages ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await db.query(
      `SELECT wm.*, u.name as sent_by_name
       FROM whatsapp_messages wm
       LEFT JOIN users u ON u.id = wm.sent_by
       ${where}
       ORDER BY wm.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit, 10), offset]
    );

    return paginated(res, result.rows, { page: parseInt(page, 10), limit: parseInt(limit, 10), total });
  })
);

/**
 * POST /api/v1/whatsapp/templates/birthday
 * Schedule birthday messages
 */
router.post(
  '/templates/birthday',
  authenticateJWT,
  extractTenant,
  birthdayTemplateValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { promo_code, discount_percent = 0, message_template } = req.body;

    const result = await whatsappService.scheduleBirthdayMessages(
      req.user.tenantId,
      {
        promo_code,
        discount_percent,
        message_template,
      }
    );

    return created(res, result, `${result.scheduled} pesan ulang tahun berhasil dijadwalkan.`);
  })
);

/**
 * POST /api/v1/whatsapp/templates/winback
 * Win-back churned customers
 */
router.post(
  '/templates/winback',
  authenticateJWT,
  extractTenant,
  winbackValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { min_days_inactive = 60, message_template, include_promo = false } = req.body;

    const result = await whatsappService.scheduleWinbackMessages(
      req.user.tenantId,
      req.user.userId,
      {
        min_days_inactive,
        message_template,
        include_promo,
      }
    );

    return created(res, result, `${result.sent} pesan win-back berhasil dikirim.`);
  })
);

/**
 * GET /api/v1/whatsapp/templates
 * Get available message templates
 */
router.get(
  '/templates',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const templates = [
      {
        id: 'order_confirmation',
        name: 'Konfirmasi Pesanan',
        description: 'Kirim setelah order dibuat',
        variables: ['order_number', 'total', 'outlet_name'],
      },
      {
        id: 'order_ready',
        name: 'Pesanan Siap',
        description: 'Kirim saat pesanan selesai',
        variables: ['order_number', 'outlet_name'],
      },
      {
        id: 'payment_reminder',
        name: 'Pengingat Pembayaran',
        description: 'Kirim pengingat payment',
        variables: ['order_number', 'amount', 'due_date'],
      },
      {
        id: 'promo_birthday',
        name: 'Promo Ulang Tahun',
        description: 'Kirim otomatis di hari ulang tahun',
        variables: ['customer_name', 'promo_code', 'discount_percent'],
      },
      {
        id: 'promo_general',
        name: 'Promo Umum',
        description: 'Promo/promosi umum',
        variables: ['customer_name', 'promo_title', 'promo_value', 'valid_until'],
      },
      {
        id: 'winback',
        name: 'Win Back',
        description: 'ajak pelanggan churned kembali',
        variables: ['customer_name', 'special_offer'],
      },
      {
        id: 'receipt',
        name: 'Struk Digital',
        description: 'Kirim struk setelah pembayaran',
        variables: ['order_number', 'items', 'total', 'outlet_name', 'date'],
      },
    ];
    return ok(res, templates);
  })
);

module.exports = router;
