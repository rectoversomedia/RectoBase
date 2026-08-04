const db = require('../config/database');
const whatsappService = require('./whatsapp.service');

/**
 * Build promotion message from template
 */
function buildPromoMessage(promotion, customerName, customData = {}) {
  const data = {
    customer_name: customerName,
    promo_title: promotion.title,
    promo_value: promotion.value,
    promo_type: promotion.type,
    valid_until: promotion.end_date ? new Date(promotion.end_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Tidak terbatas',
    min_order: promotion.min_order ? `Rp ${promotion.min_order.toLocaleString('id-ID')}` : 'Tanpa minimum',
    ...customData,
  };

  let message = `Halo, ${data.customer_name}! 👋\n\n`;
  message += `Ada promo spesial untuk Anda:\n`;
  message += `📢 *${data.promo_title}*\n\n`;

  if (promotion.type === 'discount_percent') {
    message += `Diskon *${promotion.value}%* \n`;
  } else if (promotion.type === 'discount_fixed') {
    message += `Potongan harga *Rp ${promotion.value.toLocaleString('id-ID')}*\n`;
  } else if (promotion.type === 'point_multiplier') {
    message += `Poin belanja ${promotion.value}x lipat!\n`;
  } else if (promotion.type === 'free_item') {
    message += `Gratis 1 item惊喜!\n`;
  }

  if (promotion.description) {
    message += `${promotion.description}\n`;
  }

  message += `\nBerlaku sampai: ${data.valid_until}\n`;
  message += `Min. order: ${data.min_order}\n\n`;
  message += `Ayo visit kami dan manfaatkan promonya! 🛒`;

  return message;
}

/**
 * Generate promotion recipients based on targeting rules
 */
async function generateRecipients(promotionId, tenantId) {
  const promoResult = await db.query(
    `SELECT * FROM promotions WHERE id = $1 AND tenant_id = $2`,
    [promotionId, tenantId]
  );

  if (promoResult.rows.length === 0) return null;

  const promo = promoResult.rows[0];

  let query = `
    SELECT c.id, c.name, c.phone, c.email, c.customer_type
    FROM customers c
    WHERE c.tenant_id = $1
      AND c.deleted_at IS NULL
      AND c.phone IS NOT NULL
  `;
  const params = [tenantId];

  if (promo.target_segment && promo.target_segment !== 'all') {
    query += ` AND c.customer_type = $2`;
    params.push(promo.target_segment);
  }

  if (promo.outlet_ids) {
    const outletIds = JSON.parse(promo.outlet_ids);
    if (outletIds.length > 0) {
      query += ` AND EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.outlet_id = ANY($${params.length + 1}))`;
      params.push(outletIds);
    }
  }

  const customers = await db.query(query, params);
  return customers.rows;
}

/**
 * Send promotion to recipients via WhatsApp queue
 */
async function sendPromotion(promotionId, tenantId, userId) {
  return db.transaction(async (client) => {
    const promoResult = await client.query(
      `SELECT * FROM promotions WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [promotionId, tenantId]
    );

    if (promoResult.rows.length === 0) {
      const err = new Error('Promosi tidak ditemukan.');
      err.statusCode = 404;
      throw err;
    }

    const promo = promoResult.rows[0];

    if (!promo.is_active) {
      const err = new Error('Promosi tidak aktif.');
      err.statusCode = 400;
      throw err;
    }

    // Check date validity
    const now = new Date();
    if (promo.start_date && new Date(promo.start_date) > now) {
      const err = new Error('Promosi belum dimulai.');
      err.statusCode = 400;
      throw err;
    }
    if (promo.end_date && new Date(promo.end_date) < now) {
      const err = new Error('Promosi sudah berakhir.');
      err.statusCode = 400;
      throw err;
    }

    // Generate recipients
    const recipients = await generateRecipients(promotionId, tenantId);

    if (!recipients || recipients.length === 0) {
      return { sent: 0, failed: 0, message: 'Tidak ada penerima yang memenuhi kriteria.' };
    }

    // Queue messages
    let sent = 0;
    let failed = 0;
    const failedList = [];

    for (const customer of recipients) {
      try {
        const message = buildPromoMessage(promo, customer.name);

        // Insert into queue
        await client.query(
          `INSERT INTO promotion_recipients (tenant_id, promotion_id, customer_id, message, status)
           VALUES ($1, $2, $3, $4, 'pending')`,
          [tenantId, promotionId, customer.id, message]
        );

        // Send immediately via WhatsApp
        const waResult = await whatsappService.sendMessage(
          customer.phone,
          'promo_general',
          { customer_name: customer.name, promo_title: promo.title, promo_value: promo.value, valid_until: promo.end_date },
          tenantId,
          userId
        );

        // Mark as sent
        await client.query(
          `UPDATE promotion_recipients SET status = 'sent', sent_at = NOW(), wa_message_id = $1
           WHERE promotion_id = $2 AND customer_id = $3`,
          [waResult.messageId || null, promotionId, customer.id]
        );

        sent++;
      } catch (err) {
        failed++;
        failedList.push({ customer_id: customer.id, error: err.message });
        await client.query(
          `UPDATE promotion_recipients SET status = 'failed'
           WHERE promotion_id = $1 AND customer_id = $2`,
          [promotionId, customer.id]
        );
      }
    }

    // Update promotion stats
    await client.query(
      `UPDATE promotions SET
         total_sent = total_sent + $1,
         total_failed = total_failed + $2,
         last_sent_at = NOW()
       WHERE id = $3`,
      [sent, failed, promotionId]
    );

    return { sent, failed, failed_list: failedList, total_recipients: recipients.length };
  });
}

/**
 * Get promotion by ID
 */
async function getPromotionById(promotionId, tenantId) {
  const result = await db.query(
    `SELECT * FROM promotions WHERE id = $1 AND tenant_id = $2`,
    [promotionId, tenantId]
  );
  return result.rows[0] || null;
}

module.exports = {
  sendPromotion,
  generateRecipients,
  buildPromoMessage,
  getPromotionById,
};
