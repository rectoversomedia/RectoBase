const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validator');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticateJWT } = require('../middleware/auth');
const { extractTenant } = require('../middleware/tenant');
const paymentService = require('../services/payment.service');
const db = require('../utils/db');
const { ok, created, error, notFound } = require('../utils/response');

const router = express.Router();

const createPaymentValidation = [
  body('order_id')
    .notEmpty().withMessage('Order ID wajib diisi.')
    .isUUID().withMessage('Format Order ID tidak valid.'),
  body('method')
    .notEmpty().withMessage('Metode pembayaran wajib dipilih.')
    .isIn(['BRIVA', 'MANDIRI', 'BNI', 'BRI', 'BSI', 'ALFAMART', 'ALFAMIDI', 'DAN+DAN', 'OVO', 'DANA', 'LINKAJA', 'SHOOPEPAY']).withMessage('Metode pembayaran tidak valid.'),
];

/**
 * POST /api/v1/payments/create
 * Create a Tripay payment transaction
 */
router.post(
  '/create',
  authenticateJWT,
  extractTenant,
  createPaymentValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { order_id, method } = req.body;

    // Get order details
    const orderResult = await db.query(
      `SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.id = $1 AND o.tenant_id = $2`,
      [order_id, req.user.tenantId]
    );

    if (orderResult.rows.length === 0) {
      return notFound(res, 'Order tidak ditemukan.');
    }

    const order = orderResult.rows[0];

    if (order.status === 'completed' || order.status === 'cancelled') {
      return error(res, 400, 'Tidak dapat membuat pembayaran untuk order yang sudah selesai atau dibatalkan.');
    }

    if (order.payment_status === 'paid') {
      return error(res, 400, 'Order sudah dibayar.');
    }

    const customer = {
      name: order.customer_name || 'Pelanggan',
      phone: order.customer_phone || '',
      email: order.customer_email || '',
    };

    const result = await paymentService.createTripayTransaction(order, method, customer, req.tenant);

    return created(res, result, 'Transaksi pembayaran berhasil dibuat.');
  })
);

/**
 * GET /api/v1/payments/:id
 * Get payment details
 */
router.get(
  '/:id',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT p.*, o.order_number
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.id = $1 AND p.tenant_id = $2`,
      [req.params.id, req.user.tenantId]
    );

    if (result.rows.length === 0) return notFound(res, 'Pembayaran tidak ditemukan.');
    return ok(res, result.rows[0]);
  })
);

/**
 * GET /api/v1/payments/callback
 * Tripay webhook callback (no auth - uses signature verification)
 */
router.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const { reference, status, amount } = req.query;

    if (!reference) {
      return res.status(400).json({ success: false, message: 'Reference required' });
    }

    console.log('Tripay callback received:', { reference, status, amount });

    try {
      const result = await paymentService.handleTripayCallback({
        reference,
        status,
        amount,
        ...req.query,
      });

      if (result.success) {
        return res.status(200).json({ success: true, message: 'Callback processed' });
      } else {
        return res.status(400).json({ success: false, message: result.message });
      }
    } catch (err) {
      console.error('Tripay callback error:', err);
      return res.status(500).json({ success: false, message: 'Internal error' });
    }
  })
);

/**
 * POST /api/v1/payments/callback
 * Tripay webhook callback (POST variant)
 */
router.post(
  '/callback',
  asyncHandler(async (req, res) => {
    const payload = req.body;
    const signature = req.headers['x-callback-signature'];

    console.log('Tripay POST callback received:', payload);

    try {
      const result = await paymentService.handleTripayCallback(payload);

      if (result.success) {
        return res.status(200).json({ success: true, message: 'Callback processed' });
      } else {
        return res.status(400).json({ success: false, message: result.message });
      }
    } catch (err) {
      console.error('Tripay callback error:', err);
      return res.status(500).json({ success: false, message: 'Internal error' });
    }
  })
);

/**
 * POST /api/v1/payments/verify/:reference
 * Verify payment status with Tripay
 */
router.post(
  '/verify/:reference',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const { reference } = req.params;
    const result = await paymentService.verifyPayment(reference, req.user.tenantId);
    if (!result) return notFound(res, 'Pembayaran tidak ditemukan.');
    return ok(res, result, 'Status pembayaran berhasil diverifikasi.');
  })
);

module.exports = router;
