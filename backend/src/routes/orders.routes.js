const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validator');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticateJWT } = require('../middleware/auth');
const { extractTenant } = require('../middleware/tenant');
const orderService = require('../services/order.service');
const db = require('../utils/db');
const { ok, created, error, paginated, notFound } = require('../utils/response');

const router = express.Router();

// Validation
const createOrderValidation = [
  body('outlet_id')
    .notEmpty().withMessage('Outlet wajib dipilih.')
    .isUUID().withMessage('ID outlet tidak valid.'),
  body('customer_id')
    .optional().isUUID().withMessage('ID customer tidak valid.'),
  body('items')
    .isArray({ min: 1 }).withMessage('Minimal 1 item wajib dipilih.'),
  body('items.*.product_id')
    .notEmpty().withMessage('ID produk wajib diisi.'),
  body('items.*.quantity')
    .notEmpty().isInt({ min: 1 }).withMessage('Jumlah harus minimal 1.'),
  body('items.*.price')
    .notEmpty().isFloat({ min: 0 }).withMessage('Harga harus angka positif.'),
  body('items.*.variant_id')
    .optional().isUUID().withMessage('ID variant tidak valid.'),
  body('payment_method')
    .optional().isIn(['cash', 'qris', 'ewallet', 'bank_transfer', 'mixed']).withMessage('Metode pembayaran tidak valid.'),
  body('notes')
    .optional().trim().isLength({ max: 500 }).withMessage('Catatan maksimal 500 karakter.'),
];

const addItemValidation = [
  body('product_id')
    .notEmpty().withMessage('ID produk wajib diisi.'),
  body('quantity')
    .notEmpty().isInt({ min: 1 }).withMessage('Jumlah harus minimal 1.'),
  body('price')
    .notEmpty().isFloat({ min: 0 }).withMessage('Harga harus angka positif.'),
  body('variant_id')
    .optional().isUUID().withMessage('ID variant tidak valid.'),
];

const updateStatusValidation = [
  body('status')
    .notEmpty().withMessage('Status wajib diisi.')
    .isIn(['pending', 'preparing', 'ready', 'completed', 'cancelled']).withMessage('Status tidak valid.'),
];

const cancelOrderValidation = [
  body('reason')
    .optional().trim().isLength({ max: 255 }).withMessage('Alasan pembatalan maksimal 255 karakter.'),
];

const paymentValidation = [
  body('method')
    .notEmpty().withMessage('Metode pembayaran wajib dipilih.')
    .isIn(['cash', 'qris', 'ewallet', 'bank_transfer']).withMessage('Metode pembayaran tidak valid.'),
  body('amount_paid')
    .notEmpty().isFloat({ min: 0 }).withMessage('Jumlah bayar harus angka positif.'),
];

/**
 * GET /api/v1/orders
 * List orders with filters
 */
router.get(
  '/',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const {
      page = 1, limit = 20, status, outlet_id, customer_id,
      start_date, end_date, search
    } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [req.user.tenantId];
    let where = 'WHERE o.tenant_id = $1';
    let idx = 2;

    if (status) {
      where += ` AND o.status = $${idx}`;
      params.push(status);
      idx++;
    }
    if (outlet_id) {
      where += ` AND o.outlet_id = $${idx}`;
      params.push(outlet_id);
      idx++;
    }
    if (customer_id) {
      where += ` AND o.customer_id = $${idx}`;
      params.push(customer_id);
      idx++;
    }
    if (start_date) {
      where += ` AND o.created_at >= $${idx}`;
      params.push(start_date);
      idx++;
    }
    if (end_date) {
      where += ` AND o.created_at <= $${idx}`;
      params.push(end_date);
      idx++;
    }
    if (search) {
      where += ` AND (o.order_number ILIKE $${idx} OR c.name ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const countResult = await db.query(
      `SELECT COUNT(*) FROM orders o LEFT JOIN customers c ON c.id = o.customer_id ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await db.query(
      `SELECT o.*, c.name as customer_name, c.phone as customer_phone,
              u.name as cashier_name,
              out.name as outlet_name
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users u ON u.id = o.created_by
       LEFT JOIN outlets out ON out.id = o.outlet_id
       ${where}
       ORDER BY o.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit, 10), offset]
    );

    return paginated(res, result.rows, { page: parseInt(page, 10), limit: parseInt(limit, 10), total });
  })
);

/**
 * POST /api/v1/orders
 * Create new order
 */
router.post(
  '/',
  authenticateJWT,
  extractTenant,
  createOrderValidation,
  validate,
  asyncHandler(async (req, res) => {
    const {
      outlet_id, customer_id, items, payment_method = 'cash',
      notes, discount_amount = 0, tax_rate = 0
    } = req.body;

    const order = await orderService.createOrder({
      tenantId: req.user.tenantId,
      userId: req.user.userId,
      outletId: outlet_id,
      customerId: customer_id,
      items,
      paymentMethod: payment_method,
      notes,
      discountAmount: discount_amount,
      taxRate: tax_rate,
    });

    return created(res, order, 'Order berhasil dibuat.');
  })
);

/**
 * GET /api/v1/orders/:id
 * Get order details
 */
router.get(
  '/:id',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
              u.name as cashier_name, out.name as outlet_name, out.code as outlet_code
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users u ON u.id = o.created_by
       LEFT JOIN outlets out ON out.id = o.outlet_id
       WHERE o.id = $1 AND o.tenant_id = $2`,
      [req.params.id, req.user.tenantId]
    );

    if (result.rows.length === 0) return notFound(res, 'Order tidak ditemukan.');

    const items = await db.query(
      `SELECT oi.*, p.name as product_name, p.sku as product_sku,
              pv.name as variant_name, pv.sku as variant_sku
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       LEFT JOIN product_variants pv ON pv.id = oi.variant_id
       WHERE oi.order_id = $1`,
      [req.params.id]
    );

    const order = result.rows[0];
    order.items = items.rows;

    return ok(res, order);
  })
);

/**
 * PUT /api/v1/orders/:id/status
 * Update order status
 */
router.put(
  '/:id/status',
  authenticateJWT,
  extractTenant,
  updateStatusValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    const result = await orderService.updateOrderStatus(req.params.id, req.user.tenantId, status);
    if (!result) return notFound(res, 'Order tidak ditemukan.');
    return ok(res, result, `Status order berhasil diubah ke "${status}".`);
  })
);

/**
 * PUT /api/v1/orders/:id/cancel
 * Cancel order
 */
router.put(
  '/:id/cancel',
  authenticateJWT,
  extractTenant,
  cancelOrderValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { reason } = req.body;
    const result = await orderService.cancelOrder(req.params.id, req.user.tenantId, reason);
    if (!result) return notFound(res, 'Order tidak ditemukan.');
    return ok(res, result, 'Order berhasil dibatalkan.');
  })
);

/**
 * POST /api/v1/orders/:id/items
 * Add item to existing order
 */
router.post(
  '/:id/items',
  authenticateJWT,
  extractTenant,
  addItemValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { product_id, variant_id, quantity, price, notes } = req.body;

    // Verify order exists and is not completed/cancelled
    const orderCheck = await db.query(
      'SELECT id, status FROM orders WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenantId]
    );
    if (orderCheck.rows.length === 0) return notFound(res, 'Order tidak ditemukan.');
    if (['completed', 'cancelled'].includes(orderCheck.rows[0].status)) {
      return error(res, 400, 'Tidak dapat menambahkan item ke order yang sudah selesai atau dibatalkan.');
    }

    const result = await db.query(
      `INSERT INTO order_items (tenant_id, order_id, product_id, variant_id, quantity, price, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.tenantId, req.params.id, product_id, variant_id || null, quantity, price, notes || null]
    );

    // Recalculate totals
    const totals = await db.query(
      `SELECT SUM(quantity * price) as subtotal
       FROM order_items WHERE order_id = $1`,
      [req.params.id]
    );
    await db.query(
      'UPDATE orders SET subtotal = $1, total = subtotal WHERE id = $2',
      [totals.rows[0].subtotal || 0, req.params.id]
    );

    return created(res, result.rows[0], 'Item berhasil ditambahkan.');
  })
);

/**
 * DELETE /api/v1/orders/:id/items/:itemId
 * Remove item from order
 */
router.delete(
  '/:id/items/:itemId',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const orderCheck = await db.query(
      'SELECT id, status FROM orders WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenantId]
    );
    if (orderCheck.rows.length === 0) return notFound(res, 'Order tidak ditemukan.');
    if (['completed', 'cancelled'].includes(orderCheck.rows[0].status)) {
      return error(res, 400, 'Tidak dapat menghapus item dari order yang sudah selesai atau dibatalkan.');
    }

    const result = await db.query(
      `DELETE FROM order_items WHERE id = $1 AND order_id = $2 AND tenant_id = $3 RETURNING id`,
      [req.params.itemId, req.params.id, req.user.tenantId]
    );
    if (result.rows.length === 0) return notFound(res, 'Item tidak ditemukan.');

    // Recalculate totals
    const totals = await db.query(
      `SELECT SUM(quantity * price) as subtotal
       FROM order_items WHERE order_id = $1`,
      [req.params.id]
    );
    await db.query(
      'UPDATE orders SET subtotal = $1, total = subtotal WHERE id = $2',
      [totals.rows[0].subtotal || 0, req.params.id]
    );

    return ok(res, null, 'Item berhasil dihapus.');
  })
);

/**
 * POST /api/v1/orders/:id/pay
 * Process payment for an order
 */
router.post(
  '/:id/pay',
  authenticateJWT,
  extractTenant,
  paymentValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { method, amount_paid, reference } = req.body;
    const result = await orderService.processPayment(req.params.id, req.user.tenantId, {
      method,
      amountPaid: amount_paid,
      reference,
      userId: req.user.userId,
    });
    if (!result) return notFound(res, 'Order tidak ditemukan.');
    return created(res, result, 'Pembayaran berhasil diproses.');
  })
);

module.exports = router;
