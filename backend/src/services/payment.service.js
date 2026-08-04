const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

const TRIPAY_BASE_URL = process.env.TRIPAY_MODE === 'production'
  ? 'https://tripay.co.id/api'
  : 'https://tripay.co.id/api-sandbox';

/**
 * Create a Tripay payment transaction
 */
async function createTripayTransaction(order, method, customer, tenant) {
  const apiKey = process.env.TRIPAY_API_KEY;
  if (!apiKey) {
    const err = new Error('Tripay API belum dikonfigurasi.');
    err.statusCode = 503;
    throw err;
  }

  const merchantCode = process.env.TRIPAY_MERCHANT_CODE;
  const privateKey = process.env.TRIPAY_PRIVATE_KEY;

  // Build callback URL
  const callbackUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/api/v1/payments/callback`;

  // Generate merchant ref
  const merchantRef = `RB-${order.order_number}-${Date.now()}`;

  // Build customer data
  const customerObj = {
    name: customer.name || 'Pelanggan RectoBase',
    email: customer.email || '',
    phone: customer.phone || '',
  };

  // Item details
  const items = [
    {
      sku: order.order_number,
      name: `Order #${order.order_number}`,
      price: parseFloat(order.total),
      quantity: 1,
    },
  ];

  // Add discount if any
  if (parseFloat(order.discount_amount) > 0) {
    items.push({
      sku: 'DISC',
      name: 'Diskon',
      price: -parseFloat(order.discount_amount),
      quantity: 1,
    });
  }

  const payload = {
    method: method,
    merchant_ref: merchantRef,
    customer_obj: customerObj,
    callback_url: callbackUrl,
    order_items: items,
    amount: parseFloat(order.total),
  };

  // Sign the request
  const signature = signTripayRequest(merchantCode, merchantRef, parseFloat(order.total), privateKey);

  let tripayResponse;
  try {
    tripayResponse = await axios.post(`${TRIPAY_BASE_URL}/transaction`, payload, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Signature': signature,
      },
      timeout: 15000,
    });
  } catch (err) {
    console.error('Tripay API error:', err.response?.data || err.message);
    const error = new Error('Gagal membuat transaksi payment. Silakan coba lagi.');
    error.statusCode = 502;
    throw error;
  }

  const tripayData = tripayResponse.data;

  if (tripayData.success !== true) {
    const error = new Error(tripayData.message || 'Tripay returned an error.');
    error.statusCode = 400;
    throw error;
  }

  // Store payment record — BOTH reference (Tripay's) and merchant_ref (ours)
  // Tripay callbacks with their own `reference` field, NOT our merchant_ref
  const tripayRef = tripayData.data.reference;
  const paymentId = uuidv4();
  await db.query(
    `INSERT INTO payments (id, tenant_id, order_id, method, amount, reference, merchant_ref, payment_gateway, tripay_data, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'tripay', $8, 'pending')`,
    [paymentId, tenant.id, order.id, method, parseFloat(order.total), tripayRef, merchantRef, JSON.stringify(tripayData.data)]
  );

  return {
    payment_id: paymentId,
    reference: tripayRef,    // Tripay's own reference — used in callbacks
    merchant_ref: merchantRef,
    amount: parseFloat(order.total),
    status: 'pending',
    payment_url: tripayData.data.payment_url,
    qr_url: tripayData.data.qr_url,
    qr_string: tripayData.data.qr_string,
    instructions: tripayData.data.instructions,
    expires_at: tripayData.data.expired_time,
  };
}

/**
 * Handle Tripay webhook callback
 */
async function handleTripayCallback(payload) {
  const { reference, status, amount } = payload;

  if (!reference) {
    return { success: false, message: 'Reference is required' };
  }

  // Verify signature if available
  const signature = payload.signature || payload.x_signature;
  if (signature && !verifyTripayCallback(payload)) {
    console.error('Invalid Tripay callback signature');
    return { success: false, message: 'Invalid signature' };
  }

  try {
    // Find payment record
    const paymentResult = await db.query(
      `SELECT p.*, o.tenant_id, o.customer_id, o.order_number
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.reference = $1`,
      [reference]
    );

    if (paymentResult.rows.length === 0) {
      return { success: false, message: 'Payment not found' };
    }

    const payment = paymentResult.rows[0];

    // Map Tripay status to our status
    const STATUS_MAP = {
      'PAID': 'paid',
      'SUCCESS': 'paid',
      'pending': 'pending',
      'EXPIRED': 'expired',
      'FAILED': 'failed',
      'REFUND': 'refunded',
    };

    const newStatus = STATUS_MAP[status] || status.toLowerCase();

    // Update payment status
    await db.query(
      `UPDATE payments SET status = $1, updated_at = NOW()
       WHERE reference = $2`,
      [newStatus, reference]
    );

    // Update order if paid
    if (['paid', 'success'].includes(newStatus) && payment.order_id) {
      await db.query(
        `UPDATE orders SET payment_status = 'paid', status = 'completed', updated_at = NOW()
         WHERE id = $1`,
        [payment.order_id]
      );

      // Update customer stats
      if (payment.customer_id) {
        await db.query(
          `UPDATE customers SET
             total_orders = total_orders + 1,
             lifetime_value = lifetime_value + $1,
             last_order_at = NOW(),
             updated_at = NOW()
           WHERE id = $2`,
          [parseFloat(amount) || 0, payment.customer_id]
        );
      }

      // Activate subscription for the tenant on successful payment
      if (payment.tenant_id) {
        const days = 30; // monthly billing
        const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        await db.query(
          `UPDATE tenants SET
             subscription_status = 'active',
             subscription_expires_at = $1,
             updated_at = NOW()
           WHERE id = $2`,
          [expiresAt, payment.tenant_id]
        );
        console.log(`Subscription activated for tenant ${payment.tenant_id}, expires ${expiresAt.toISOString()}`);
      }
    }

    // Handle expired
    if (['expired', 'failed'].includes(newStatus)) {
      await db.query(
        `UPDATE orders SET payment_status = $1, updated_at = NOW()
         WHERE id = $2 AND payment_status != 'paid'`,
        [newStatus, payment.order_id]
      );
    }

    console.log(`Tripay callback processed: reference=${reference}, status=${newStatus}`);
    return { success: true, status: newStatus, order_id: payment.order_id };
  } catch (err) {
    console.error('Error processing Tripay callback:', err);
    return { success: false, message: err.message };
  }
}

/**
 * Verify payment status by querying Tripay API
 */
async function verifyPayment(reference, tenantId) {
  const apiKey = process.env.TRIPAY_API_KEY;
  if (!apiKey) {
    const err = new Error('Tripay API belum dikonfigurasi.');
    err.statusCode = 503;
    throw err;
  }

  // Get local payment record
  const localResult = await db.query(
    `SELECT p.*, o.order_number FROM payments p
     JOIN orders o ON o.id = p.order_id
     WHERE p.reference = $1 AND p.tenant_id = $2`,
    [reference, tenantId]
  );

  if (localResult.rows.length === 0) return null;

  try {
    const response = await axios.get(`${TRIPAY_BASE_URL}/transaction/detail?reference=${reference}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000,
    });

    const tripayData = response.data.data;

    if (tripayData) {
      const newStatus = tripayData.status?.toLowerCase() || 'pending';

      await db.query(
        `UPDATE payments SET status = $1, tripay_data = $2, updated_at = NOW()
         WHERE reference = $3 AND tenant_id = $4`,
        [newStatus, JSON.stringify(tripayData), reference, tenantId]
      );

      // Sync order status if paid
      if (newStatus === 'paid') {
        const payment = localResult.rows[0];
        await db.query(
          `UPDATE orders SET payment_status = 'paid', status = 'completed', updated_at = NOW()
           WHERE id = $1 AND payment_status != 'paid'`,
          [payment.order_id]
        );
      }
    }

    return {
      reference,
      status: tripayData?.status || localResult.rows[0].status,
      amount: parseFloat(tripayData?.amount || localResult.rows[0].amount),
      paid_at: tripayData?.paid_at || null,
      order_number: localResult.rows[0].order_number,
    };
  } catch (err) {
    console.error('Tripay verify error:', err.response?.data || err.message);
    // Return local data
    return localResult.rows[0];
  }
}

/**
 * Sign a Tripay API request
 */
function signTripayRequest(merchantCode, merchantRef, amount, privateKey) {
  const crypto = require('crypto');
  const signaturePayload = `${merchantCode}${merchantRef}${amount}`;
  return crypto.createHmac('sha256', privateKey).update(signaturePayload).digest('hex');
}

/**
 * Verify Tripay callback signature
 */
function verifyTripayCallback(payload) {
  const privateKey = process.env.TRIPAY_PRIVATE_KEY;
  const signature = payload.signature || payload.x_signature;
  if (!signature || !privateKey) return false;

  const crypto = require('crypto');
  const signatureData = `${payload.reference}${payload.amount}${payload.status}`;
  const expectedSignature = crypto.createHmac('sha256', privateKey).update(signatureData).digest('hex');

  return signature === expectedSignature;
}

module.exports = {
  createTripayTransaction,
  handleTripayCallback,
  verifyPayment,
};
