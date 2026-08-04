const db = require('../config/database');
const { generateOrderNumber } = require('../utils/orderNumber');

/**
 * Create a new order
 */
async function createOrder({ tenantId, userId, outletId, customerId, items, paymentMethod, notes, discountAmount, taxRate }) {
  return db.transaction(async (client) => {
    // Verify outlet
    const outletResult = await client.query(
      'SELECT id, name, code FROM outlets WHERE id = $1 AND tenant_id = $2 AND is_active = true',
      [outletId, tenantId]
    );
    if (outletResult.rows.length === 0) {
      const err = new Error('Outlet tidak ditemukan atau tidak aktif.');
      err.statusCode = 404;
      throw err;
    }

    // Generate order number
    const orderNumber = await generateOrderNumber(tenantId, outletId);

    // Calculate totals
    const { subtotal, tax, discount, total } = calculateOrderTotals(items, discountAmount, taxRate);

    // Create order
    const orderResult = await client.query(
      `INSERT INTO orders (tenant_id, order_number, outlet_id, customer_id, created_by, payment_method, payment_status,
                           subtotal, tax_amount, discount_amount, total, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10, $11, 'pending')
       RETURNING *`,
      [tenantId, orderNumber, outletId, customerId || null, userId, paymentMethod, subtotal, tax, discountAmount || 0, total, notes || null]
    );
    const order = orderResult.rows[0];

    // Insert order items
    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (tenant_id, order_id, product_id, variant_id, product_name, quantity, price, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tenantId, order.id, item.product_id,
          item.variant_id || null,
          item.product_name || null,
          item.quantity, item.price,
          item.quantity * item.price,
        ]
      );

      // Deduct stock
      if (item.variant_id) {
        await client.query(
          `UPDATE product_variants SET stock = stock - $1, updated_at = NOW()
           WHERE id = $2 AND stock >= $1`,
          [item.quantity, item.variant_id]
        );
      } else {
        await client.query(
          `UPDATE products SET stock = stock - $1, updated_at = NOW()
           WHERE id = $2 AND stock >= $1`,
          [item.quantity, item.product_id]
        );
      }
    }

    // Add loyalty points if customer
    if (customerId) {
      const points = Math.floor(total / 1000); // 1 point per 1000 spent
      if (points > 0) {
        await client.query(
          `UPDATE customers SET points_balance = points_balance + $1, updated_at = NOW()
           WHERE id = $2`,
          [points, customerId]
        );
        await client.query(
          `INSERT INTO points_history (tenant_id, customer_id, points, type, reason, created_by)
           VALUES ($1, $2, $3, 'earn', 'Pembelian order #${orderNumber}', $4)`,
          [tenantId, customerId, points, userId]
        );
      }
    }

    return order;
  });
}

/**
 * Calculate order totals from items
 */
function calculateOrderTotals(items, discountAmount = 0, taxRate = 0) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const tax = Math.round(afterDiscount * taxRate);
  const total = afterDiscount + tax;
  return { subtotal, tax, discount: discountAmount, total };
}

/**
 * Update order status with validation
 */
async function updateOrderStatus(orderId, tenantId, newStatus) {
  const VALID_TRANSITIONS = {
    pending: ['preparing', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ready: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  };

  return db.transaction(async (client) => {
    const orderResult = await client.query(
      'SELECT * FROM orders WHERE id = $1 AND tenant_id = $2',
      [orderId, tenantId]
    );

    if (orderResult.rows.length === 0) return null;

    const order = orderResult.rows[0];
    const allowed = VALID_TRANSITIONS[order.status] || [];

    if (!allowed.includes(newStatus)) {
      const err = new Error(`Tidak dapat mengubah status dari "${order.status}" ke "${newStatus}".`);
      err.statusCode = 400;
      throw err;
    }

    const updateResult = await client.query(
      `UPDATE orders SET status = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [newStatus, orderId, tenantId]
    );

    // Log status change
    await client.query(
      `INSERT INTO order_status_history (order_id, tenant_id, old_status, new_status)
       VALUES ($1, $2, $3, $4)`,
      [orderId, tenantId, order.status, newStatus]
    );

    // Update customer stats when completed
    if (newStatus === 'completed' && order.customer_id) {
      await updateCustomerStats(client, order.customer_id, tenantId);
    }

    // Reverse stock if cancelled
    if (newStatus === 'cancelled' && order.status !== 'cancelled') {
      const items = await client.query(
        'SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1',
        [orderId]
      );
      for (const item of items.rows) {
        if (item.variant_id) {
          await client.query(
            'UPDATE product_variants SET stock = stock + $1 WHERE id = $2',
            [item.quantity, item.variant_id]
          );
        } else {
          await client.query(
            'UPDATE products SET stock = stock + $1 WHERE id = $2',
            [item.quantity, item.product_id]
          );
        }
      }
    }

    return updateResult.rows[0];
  });
}

/**
 * Cancel an order
 */
async function cancelOrder(orderId, tenantId, reason) {
  return db.transaction(async (client) => {
    const orderResult = await client.query(
      'SELECT * FROM orders WHERE id = $1 AND tenant_id = $2',
      [orderId, tenantId]
    );

    if (orderResult.rows.length === 0) return null;

    const order = orderResult.rows[0];
    if (['completed', 'cancelled'].includes(order.status)) {
      const err = new Error(`Order dengan status "${order.status}" tidak dapat dibatalkan.`);
      err.statusCode = 400;
      throw err;
    }

    const updateResult = await client.query(
      `UPDATE orders SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [orderId, tenantId]
    );

    // Log cancellation
    await client.query(
      `INSERT INTO order_status_history (order_id, tenant_id, old_status, new_status)
       VALUES ($1, $2, $3, 'cancelled')`,
      [orderId, tenantId, order.status]
    );

    // Reverse stock
    const items = await client.query(
      'SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1',
      [orderId]
    );
    for (const item of items.rows) {
      if (item.variant_id) {
        await client.query(
          'UPDATE product_variants SET stock = stock + $1 WHERE id = $2',
          [item.quantity, item.variant_id]
        );
      } else {
        await client.query(
          'UPDATE products SET stock = stock + $1 WHERE id = $2',
          [item.quantity, item.product_id]
        );
      }
    }

    // Reverse loyalty points if customer
    if (order.customer_id) {
      const points = Math.floor(order.total / 1000);
      if (points > 0) {
        await client.query(
          `UPDATE customers SET points_balance = points_balance - $1 WHERE id = $2`,
          [points, order.customer_id]
        );
        await client.query(
          `INSERT INTO points_history (tenant_id, customer_id, points, type, reason)
           VALUES ($1, $2, $3, 'redeem', 'Order #${order.order_number} dibatalkan')`,
          [tenantId, order.customer_id, points]
        );
      }
    }

    // Log cancellation reason
    if (reason) {
      await client.query(
        `UPDATE orders SET notes = CONCAT(COALESCE(notes, ''), ' | Cancelled: ', $1)
         WHERE id = $2`,
        [reason, orderId]
      );
    }

    return updateResult.rows[0];
  });
}

/**
 * Process payment for an order
 */
async function processPayment(orderId, tenantId, { method, amountPaid, reference, userId }) {
  return db.transaction(async (client) => {
    const orderResult = await client.query(
      'SELECT * FROM orders WHERE id = $1 AND tenant_id = $2',
      [orderId, tenantId]
    );

    if (orderResult.rows.length === 0) return null;

    const order = orderResult.rows[0];
    if (order.payment_status === 'paid') {
      const err = new Error('Order sudah dibayar.');
      err.statusCode = 400;
      throw err;
    }

    const total = parseFloat(order.total);
    const paid = parseFloat(amountPaid);
    const change = Math.max(0, paid - total);

    const newPaymentStatus = paid >= total ? 'paid' : 'partial';
    const newStatus = paid >= total ? 'completed' : order.status;

    await client.query(
      `UPDATE orders SET payment_method = $1, payment_status = $2, status = $3, updated_at = NOW()
       WHERE id = $4`,
      [method, newPaymentStatus, newStatus, orderId]
    );

    // Record payment
    await client.query(
      `INSERT INTO payments (tenant_id, order_id, method, amount, change_amount, reference, paid_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, orderId, method, paid, change, reference || null, userId]
    );

    // Update customer stats if completed
    if (newStatus === 'completed' && order.customer_id) {
      await updateCustomerStats(client, order.customer_id, tenantId);
    }

    return {
      order_id: orderId,
      payment_status: newPaymentStatus,
      status: newStatus,
      amount_paid: paid,
      change: change,
      total: total,
    };
  });
}

/**
 * Update customer statistics after order completion
 */
async function updateCustomerStats(client, customerId, tenantId) {
  await client.query(
    `UPDATE customers SET
       total_orders = total_orders + 1,
       total_spent = total_spent + (SELECT COALESCE(SUM(total), 0) FROM orders WHERE customer_id = $1 AND status = 'completed' AND tenant_id = $2),
       last_order_at = NOW(),
       updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2`,
    [customerId, tenantId]
  );
}

module.exports = {
  createOrder,
  calculateOrderTotals,
  updateOrderStatus,
  cancelOrder,
  processPayment,
  updateCustomerStats,
};
