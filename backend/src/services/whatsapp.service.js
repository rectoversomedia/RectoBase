const axios = require('axios');
const db = require('../config/database');

const ULTRAMSG_API_URL = process.env.ULTRAMSG_API_URL || 'https://api.ultramsg.com';
const ULTRAMSG_INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
const ULTRAMSG_TOKEN = process.env.ULTRAMSG_TOKEN;

/**
 * Get the configured instance ID and token
 */
function getConfig() {
  return {
    instanceId: ULTRAMSG_INSTANCE_ID,
    token: ULTRAMSG_TOKEN,
    apiUrl: ULTRAMSG_API_URL,
  };
}

/**
 * Validate phone number format for WhatsApp (Indonesian format)
 */
function formatPhoneNumber(phone) {
  // Remove all non-digit characters
  let digits = phone.replace(/\D/g, '');

  // If starts with 0, replace with 62 (Indonesian country code)
  if (digits.startsWith('0')) {
    digits = '62' + digits.substring(1);
  }
  // If doesn't start with 62, add it
  if (!digits.startsWith('62')) {
    digits = '62' + digits;
  }

  return digits + '@c.us';
}

/**
 * Build message from template
 */
function buildTemplateMessage(template, data = {}) {
  const templates = {
    order_confirmation: `Halo ${data.customer_name || 'Pelanggan'}! 🎉

Pesanan Anda sudah kami terima:
📋 No. Order: ${data.order_number}
🏪 Outlet: ${data.outlet_name}
💰 Total: Rp ${(data.total || 0).toLocaleString('id-ID')}

Pesanan sedang kami proses. Terima kasih! 🙏`,

    order_ready: `Halo ${data.customer_name || 'Pelanggan'}! 🎉

Pesanan Anda sudah siap!
📋 No. Order: ${data.order_number}
🏪 Outlet: ${data.outlet_name}

Silakan diambil di outlet. Terima kasih! 🙏`,

    payment_reminder: `Halo ${data.customer_name || 'Pelanggan'}! ⏰

Pengingat untuk order #${data.order_number}:
💰 Total: Rp ${(data.amount || 0).toLocaleString('id-ID')}
📅 Batas Bayar: ${data.due_date || 'hari ini'}

Segera selesaikan pembayaran Anda. Terima kasih! 🙏`,

    promo_birthday: `Selamat Ulang Tahun, ${data.customer_name}! 🎂🎉

Semoga hari Anda menyenangkan! Sebagai hadiah, kami berikan:
🎁 Diskon ${data.discount_percent || 10}% untuk pembelian hari ini
📋 Kode Promo: ${data.promo_code || 'HBD2024'}

Kunjungi kami dan tunjukkan pesan ini. Selamat ulang tahun! 🎊`,

    promo_general: `Halo ${data.customer_name || 'Pelanggan'}! 👋

📢 ${data.promo_title || 'Promo Spesial'}

${data.promo_value ? `🎉 ${data.promo_value}` : ''}
${data.description || ''}

Berlaku sampai: ${data.valid_until || 'segera'}
Min. order: ${data.min_order || 'tanpa minimum'}

Ayo kunjungi kami! 🛒`,

    winback: `Halo ${data.customer_name || 'Pelanggan'}! Kami rindu Anda! 🥺

Sudah lama tidak visit kami. Kami kangen Anda!
${data.special_offer || 'Sebagai apresiasi, kami berikan harga spesial untuk Anda hari ini!'}

Kunjungi kami lagi ya! Ada kejutan menanti. 🎁
- Tim ${data.business_name || 'RectoBase'}`,

    receipt: `🧾 *STRUK PEMBELIAN*
RectoBase - ${data.outlet_name || ''}

No. Order : ${data.order_number}
Tanggal   : ${data.date || new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}

────────────────────
${data.items || 'Item purchased'}
────────────────────
Subtotal  : Rp ${(data.subtotal || 0).toLocaleString('id-ID')}
Diskon    : Rp ${(data.discount || 0).toLocaleString('id-ID')}
Pajak     : Rp ${(data.tax || 0).toLocaleString('id-ID')}
────────────────────
*TOTAL    : Rp ${(data.total || 0).toLocaleString('id-ID')}*

Terima kasih atas kunjungan Anda! 🙏
*Kunjungi kami lagi ya!*`,
  };

  return templates[template] || templates.promo_general;
}

/**
 * Send a WhatsApp message via Ultramsg API
 */
async function sendMessage(to, template, data = {}, tenantId, userId) {
  const config = getConfig();

  if (!config.instanceId || !config.token) {
    // In dev mode, log and return mock
    console.log(`[DEV] WhatsApp message to ${to}:`, { template, data });
    return {
      success: true,
      messageId: `dev_${Date.now()}`,
      status: 'dev',
    };
  }

  const message = buildTemplateMessage(template, data);
  const formattedTo = formatPhoneNumber(to);

  try {
    const response = await axios.post(
      `${config.apiUrl}/${config.instanceId}/messages/chat`,
      {
        token: config.token,
        to: formattedTo,
        body: message,
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
      }
    );

    const result = response.data;

    // Log the message
    await db.insert('whatsapp_messages', {
      tenant_id: tenantId,
      recipient: to,
      template,
      payload: JSON.stringify(data),
      message_content: message,
      status: result.sent ? 'sent' : 'failed',
      sent_by: userId || null,
      wa_message_id: result.id || null,
    });

    return {
      success: result.sent || result.success,
      messageId: result.id || null,
      status: result.sent ? 'sent' : 'failed',
      error: result.error || null,
    };
  } catch (err) {
    console.error('Ultramsg API error:', err.response?.data || err.message);

    // Log failed message
    try {
      await db.insert('whatsapp_messages', {
        tenant_id: tenantId,
        recipient: to,
        template,
        payload: JSON.stringify(data),
        message_content: message,
        status: 'failed',
        sent_by: userId || null,
        error_message: err.message,
      });
    } catch {}

    return {
      success: false,
      status: 'failed',
      error: err.message,
    };
  }
}

/**
 * Broadcast a message to multiple customers
 */
async function broadcastMessage(customers, template, data = {}, tenantId, userId) {
  let sent = 0;
  let failed = 0;
  const results = [];

  for (const customer of customers) {
    if (!customer.phone) {
      failed++;
      results.push({ customer_id: customer.id, success: false, error: 'No phone number' });
      continue;
    }

    const msgData = { ...data, customer_name: customer.name };
    const result = await sendMessage(customer.phone, template, msgData, tenantId, userId);

    if (result.success) {
      sent++;
      results.push({ customer_id: customer.id, success: true, messageId: result.messageId });
    } else {
      failed++;
      results.push({ customer_id: customer.id, success: false, error: result.error });
    }

    // Rate limiting: 1 message per second to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return { sent, failed, total: customers.length, results };
}

/**
 * Schedule birthday messages for customers with birthdays today
 */
async function scheduleBirthdayMessages(tenantId, options = {}) {
  const { promo_code, discount_percent = 10, message_template } = options;

  // Find customers with birthday today
  const customers = await db.query(
    `SELECT id, name, phone, birthdate
     FROM customers
     WHERE tenant_id = $1
       AND deleted_at IS NULL
       AND phone IS NOT NULL
       AND birthdate IS NOT NULL
       AND EXTRACT(MONTH FROM birthdate) = EXTRACT(MONTH FROM CURRENT_DATE)
       AND EXTRACT(DAY FROM birthdate) = EXTRACT(DAY FROM CURRENT_DATE)`,
    [tenantId]
  );

  if (customers.rows.length === 0) {
    return { scheduled: 0, message: 'Tidak ada pelanggan yang berulang tahun hari ini.' };
  }

  let scheduled = 0;
  const message = message_template || buildTemplateMessage('promo_birthday', {
    discount_percent,
    promo_code,
  });

  for (const customer of customers.rows) {
    const result = await sendMessage(
      customer.phone,
      'promo_birthday',
      {
        customer_name: customer.name,
        promo_code,
        discount_percent,
      },
      tenantId,
      null
    );

    if (result.success) scheduled++;

    await db.insert('whatsapp_messages', {
      tenant_id: tenantId,
      recipient: customer.phone,
      template: 'promo_birthday',
      payload: JSON.stringify({ customer_id: customer.id, promo_code, discount_percent }),
      message_content: message,
      status: result.success ? 'sent' : 'failed',
      scheduled_type: 'birthday',
      error_message: result.error || null,
    });
  }

  return { scheduled, total_customers: customers.rows.length };
}

/**
 * Schedule win-back messages for churned customers
 */
async function scheduleWinbackMessages(tenantId, userId, options = {}) {
  const { min_days_inactive = 60, message_template, include_promo = false } = options;

  const customers = await db.query(
    `SELECT c.id, c.name, c.phone, c.last_order_at,
            EXTRACT(DAY FROM (NOW() - COALESCE(c.last_order_at, c.created_at))) as days_inactive
     FROM customers c
     WHERE c.tenant_id = $1
       AND c.deleted_at IS NULL
       AND c.phone IS NOT NULL
       AND c.customer_type IN ('at_risk', 'churned')
       AND EXTRACT(DAY FROM (NOW() - COALESCE(c.last_order_at, c.created_at))) >= $2
     ORDER BY c.churn_score DESC, c.last_order_at ASC
     LIMIT 100`,
    [tenantId, min_days_inactive]
  );

  if (customers.rows.length === 0) {
    return { sent: 0, message: 'Tidak ada pelanggan churned yang memenuhi kriteria.' };
  }

  let sent = 0;
  for (const customer of customers.rows) {
    const msgData = {
      customer_name: customer.name,
      special_offer: include_promo ? 'Diskon spesial hanya untuk Anda hari ini!' : null,
    };

    const result = await sendMessage(customer.phone, 'winback', msgData, tenantId, userId);

    await db.insert('whatsapp_messages', {
      tenant_id: tenantId,
      recipient: customer.phone,
      template: 'winback',
      payload: JSON.stringify({ customer_id: customer.id, days_inactive: customer.days_inactive }),
      message_content: message_template || buildTemplateMessage('winback', msgData),
      status: result.success ? 'sent' : 'failed',
      scheduled_type: 'winback',
      sent_by: userId,
      error_message: result.error || null,
    });

    if (result.success) sent++;
  }

  return { sent, total_churned: customers.rows.length };
}

module.exports = {
  sendMessage,
  broadcastMessage,
  scheduleBirthdayMessages,
  scheduleWinbackMessages,
  buildTemplateMessage,
  formatPhoneNumber,
};
