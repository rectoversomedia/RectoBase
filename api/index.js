'use strict';

/**
 * RectoBase API — Single-file Vercel Serverless Handler
 * All routes: auth, products, orders, customers, promotions,
 * payments, reports, whatsapp, admin, tenant
 *
 * Key naming convention for HANDLERS:
 *   Static route: '/api/v1/health'
 *   With method:  '/api/v1/auth/login'
 *   Param routes: '/api/v1/products/:id'  (handles GET, DELETE for that path)
 *   Action routes: '/api/v1/orders/:id/status:PUT' (PUT /orders/:id/status)
 */

const HANDLERS = {};

// ── Backend service lazy-loader ─────────────────────────────────────────────────
// Prebuild copies backend/src → api/_src/ and patches internal require paths.
// During Vercel build: 'api/_src/...' resolves correctly.
const BACKEND_BASE = 'api/_src';

let _authSvc, _orderSvc, _customerSvc, _promoSvc, _paymentSvc;
let _whatsappSvc, _reportSvc, _loyaltySvc, _jwt, _db;

function loadBackend() {
  if (_db) return;
  try {
    _db       = require(`${BACKEND_BASE}/utils/db`);
    _jwt      = require(`${BACKEND_BASE}/config/jwt`);
    _authSvc  = require(`${BACKEND_BASE}/services/auth.service`);
    _orderSvc = require(`${BACKEND_BASE}/services/order.service`);
    _customerSvc = require(`${BACKEND_BASE}/services/customer.service`);
    _promoSvc = require(`${BACKEND_BASE}/services/promotion.service`);
    _paymentSvc = require(`${BACKEND_BASE}/services/payment.service`);
    _whatsappSvc = require(`${BACKEND_BASE}/services/whatsapp.service`);
    _reportSvc = require(`${BACKEND_BASE}/services/report.service`);
    _loyaltySvc = require(`${BACKEND_BASE}/services/loyalty.service`);
  } catch (e) {
    console.error('[api] loadBackend failed:', e.message);
  }
}

// ── Response helpers ───────────────────────────────────────────────────────────
function resOK(res, data, message) {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({ success: true, ...(message ? { message } : {}), data });
}
function resCreated(res, data, message) {
  res.setHeader('Content-Type', 'application/json');
  res.status(201).json({ success: true, ...(message ? { message } : {}), data });
}
function resError(res, status, message) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json({ success: false, message });
}
function resPaginated(res, data, meta) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Total-Count', String(meta.total));
  res.setHeader('X-Page-Count', String(meta.pages));
  res.status(200).json({ success: true, data, ...meta });
}
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
function nowISO() { return new Date().toISOString(); }
function rp(v) { return parseFloat(v || 0); }
function pi(v, def = 0) { const n = parseInt(v, 10); return isNaN(n) ? def : n; }
function puuid(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v || ''); }
function parseBody(req) {
  if (req.headers['content-type']?.includes('application/json')) {
    try { return req.body || {}; } catch { return {}; }
  }
  return {};
}

// ── Middleware ─────────────────────────────────────────────────────────────────
function authenticate(req, res, next) {
  loadBackend();
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer '))
    return resError(res, 401, 'Token authorization wajib diisi.');
  try {
    req.user = _jwt.verifyToken(auth.slice(7));
    req.tenantId = req.user.tenantId;
    next();
  } catch {
    return resError(res, 401, 'Token tidak valid atau sudah kadaluarsa.');
  }
}

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.cookies?.admin_token;
  const valid = process.env.ADMIN_SECRET || 'rb_admin_secret_change_this';
  if (token !== valid) return resError(res, 401, 'Unauthorized admin access.');
  next();
}

async function extractTenant(req, res, next) {
  loadBackend();
  try {
    const r = await _db.query(
      `SELECT * FROM tenants WHERE id=$1 AND deleted_at IS NULL`,
      [req.user.tenantId]
    );
    if (!r.rows[0]) return resError(res, 404, 'Tenant tidak ditemukan.');
    req.tenant = r.rows[0];
    next();
  } catch (e) {
    return resError(res, 500, 'Gagal mengambil data tenant.');
  }
}

// ── Route matching ────────────────────────────────────────────────────────────
function matchRoute(pathname, method) {
  // 1. Exact + method: 'GET /api/v1/products' or '/api/v1/auth/login'
  const exactKey = `${pathname}:${method}`;
  if (HANDLERS[exactKey]) return HANDLERS[exactKey];

  // 2. Exact path only (no method suffix — single-method handlers)
  if (HANDLERS[pathname]) return HANDLERS[pathname];

  // 3. Param routes — match against registered patterns
  //    Pattern format: '/api/v1/products/:id'
  const pathnameSegments = pathname.split('/');
  for (const [pattern, handler] of Object.entries(HANDLERS)) {
    if (!pattern.includes(':')) continue;
    if (!pattern.startsWith('/')) continue;

    const patternSegments = pattern.split('/');

    // Must have same segment count
    if (patternSegments.length !== pathnameSegments.length) continue;

    // All static segments must match exactly
    let isMatch = true;
    for (let i = 0; i < patternSegments.length; i++) {
      const ps = patternSegments[i];
      // Skip non-param segments (those starting with ':' are params)
      if (ps.startsWith(':')) continue;
      if (ps !== pathnameSegments[i]) { isMatch = false; break; }
    }
    if (isMatch) return handler;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════════
HANDLERS['/api/v1/auth/login'] = asyncHandler(async (req, res) => {
  loadBackend();
  const { email, password } = parseBody(req);
  if (!email || !password) return resError(res, 400, 'Email dan password wajib diisi.');
  const result = await _authSvc.login(email, password);
  res.setHeader('Set-Cookie',
    `refresh_token=${result.refreshToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7*24*3600}`);
  delete result.refreshToken;
  resOK(res, result, 'Login berhasil.');
});

HANDLERS['/api/v1/auth/register'] = asyncHandler(async (req, res) => {
  loadBackend();
  const { business_name, owner_name, email, password, phone } = parseBody(req);
  if (!business_name || !email || !password) return resError(res, 400, 'Nama bisnis, email, dan password wajib diisi.');
  if (password.length < 8) return resError(res, 400, 'Password minimal 8 karakter.');
  const result = await _authSvc.register({ business_name, owner_name, email, password, phone });
  resCreated(res, result, 'Registrasi berhasil. Silakan login.');
});

HANDLERS['/api/v1/auth/google-login'] = asyncHandler(async (req, res) => {
  loadBackend();
  const { id_token } = parseBody(req);
  if (!id_token) return resError(res, 400, 'Google ID token wajib diisi.');
  const result = await _authSvc.googleLogin(id_token);
  resOK(res, result, 'Login dengan Google berhasil.');
});

HANDLERS['/api/v1/auth/refresh'] = asyncHandler(async (req, res) => {
  loadBackend();
  const token = req.cookies?.refresh_token || parseBody(req).refresh_token;
  if (!token) return resError(res, 400, 'Refresh token wajib diisi.');
  const result = await _authSvc.refreshToken(token);
  res.setHeader('Set-Cookie',
    `refresh_token=${result.refreshToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7*24*3600}`);
  delete result.refreshToken;
  resOK(res, result);
});

HANDLERS['/api/v1/auth/forgot-password'] = asyncHandler(async (req, res) => {
  loadBackend();
  const { email } = parseBody(req);
  if (!email) return resError(res, 400, 'Email wajib diisi.');
  await _authSvc.forgotPassword(email);
  resOK(res, null, 'Jika email terdaftar, link reset password sudah dikirim.');
});

HANDLERS['/api/v1/auth/me'] = [
  authenticate,
  asyncHandler(async (req, res) => {
    loadBackend();
    const result = await _authSvc.getMe(req.user.userId);
    resOK(res, result);
  }),
];

// ═══════════════════════════════════════════════════════════════════════════════
// TENANT / OUTLETS / SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════
HANDLERS['/api/v1/tenant/outlets'] = [
  authenticate, extractTenant,
  asyncHandler(async (req, res) => {
    loadBackend();
    if (req.method === 'GET') {
      const r = await _db.query(
        `SELECT id, name, address, phone, qr_menu_enabled, is_active, created_at FROM outlets WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at`,
        [req.tenantId]
      );
      return resOK(res, r.rows);
    }
    const { name, address } = parseBody(req);
    if (!name) return resError(res, 400, 'Nama outlet wajib diisi.');
    const r = await _db.query(
      `INSERT INTO outlets (id, tenant_id, name, address) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING *`,
      [req.tenantId, name, address || '']
    );
    resCreated(res, r.rows[0], 'Outlet berhasil dibuat.');
  }),
];

HANDLERS['/api/v1/tenant/settings'] = [
  authenticate,
  asyncHandler(async (req, res) => {
    loadBackend();
    if (req.method === 'GET') {
      const r = await _db.query(`SELECT key, value, type FROM settings WHERE tenant_id=$1`, [req.tenantId]);
      return resOK(res, r.rows);
    }
    const { key, value } = parseBody(req);
    if (!key) return resError(res, 400, 'Key wajib diisi.');
    await _db.query(
      `INSERT INTO settings (id, tenant_id, key, value) VALUES (gen_random_uuid(), $1, $2, $3)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value=$3, updated_at=NOW()`,
      [req.tenantId, key, value]
    );
    resOK(res, null, 'Setting berhasil diperbarui.');
  }),
];

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════════════════════════════════════
HANDLERS['/api/v1/products'] = [
  authenticate,
  asyncHandler(async (req, res) => {
    loadBackend();
    const { search, category_id, page = 1, limit = 50 } = req.query;
    const offset = (pi(page) - 1) * pi(limit);
    const params = [req.user.tenantId];
    let where = 'p.tenant_id=$1 AND p.deleted_at IS NULL';
    let idx = 2;
    if (search) { where += ` AND (p.name ILIKE $${idx} OR p.sku ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (category_id) { where += ` AND p.category_id=$${idx}`; params.push(category_id); idx++; }
    const countR = await _db.query(`SELECT COUNT(*) FROM products p WHERE ${where}`, params);
    const total = parseInt(countR.rows[0].count, 10);
    params.push(pi(limit), offset);
    const r = await _db.query(
      `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE ${where} ORDER BY p.created_at DESC LIMIT $${idx} OFFSET $${idx+1}`,
      params
    );
    resPaginated(res, r.rows, { total, page: pi(page), limit: pi(limit), pages: Math.ceil(total / pi(limit)) });
  }),
];

HANDLERS['/api/v1/products:POST'] = [
  authenticate,
  asyncHandler(async (req, res) => {
    loadBackend();
    const { name, sku, price, category_id, stock_quantity, image_url } = parseBody(req);
    if (!name || price === undefined) return resError(res, 400, 'Nama dan harga produk wajib diisi.');
    const r = await _db.query(
      `INSERT INTO products (id, tenant_id, name, sku, price, category_id, stock_quantity, image_url)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.tenantId, name, sku || '', rp(price), category_id || null, pi(stock_quantity), image_url || null]
    );
    resCreated(res, r.rows[0], 'Produk berhasil ditambahkan.');
  }),
];

HANDLERS['/api/v1/products/:id'] = [
  authenticate,
  asyncHandler(async (req, res) => {
    loadBackend();
    const { id } = req.params;
    if (!puuid(id)) return resError(res, 400, 'ID produk tidak valid.');
    const r = await _db.query(
      `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=$1 AND p.tenant_id=$2 AND p.deleted_at IS NULL`,
      [id, req.user.tenantId]
    );
    if (!r.rows[0]) return resError(res, 404, 'Produk tidak ditemukan.');
    resOK(res, r.rows[0]);
  }),
];

HANDLERS['/api/v1/products/:id:PUT'] = [
  authenticate,
  asyncHandler(async (req, res) => {
    loadBackend();
    const { id } = req.params;
    const { name, sku, price, category_id, stock_quantity, image_url, is_available } = parseBody(req);
    const updates = [];
    const params = [];
    let idx = 1;
    if (name !== undefined) { updates.push(`name=$${idx++}`); params.push(name); }
    if (sku !== undefined) { updates.push(`sku=$${idx++}`); params.push(sku || ''); }
    if (price !== undefined) { updates.push(`price=$${idx++}`); params.push(rp(price)); }
    if (category_id !== undefined) { updates.push(`category_id=$${idx++}`); params.push(category_id || null); }
    if (stock_quantity !== undefined) { updates.push(`stock_quantity=$${idx++}`); params.push(pi(stock_quantity)); }
    if (image_url !== undefined) { updates.push(`image_url=$${idx++}`); params.push(image_url || null); }
    if (is_available !== undefined) { updates.push(`is_available=$${idx++}`); params.push(!!is_available); }
    updates.push('updated_at=NOW()');
    params.push(id, req.user.tenantId);
    const r = await _db.query(
      `UPDATE products SET ${updates.join(',')} WHERE id=$${idx++} AND tenant_id=$${idx} AND deleted_at IS NULL RETURNING *`,
      params
    );
    if (!r.rows[0]) return resError(res, 404, 'Produk tidak ditemukan.');
    resOK(res, r.rows[0], 'Produk berhasil diperbarui.');
  }),
];

HANDLERS['/api/v1/products/low-stock'] = [
  authenticate,
  asyncHandler(async (req, res) => {
    loadBackend();
    const r = await _db.query(
      `SELECT id, name, sku, stock_quantity, low_stock_threshold, price FROM products WHERE tenant_id=$1 AND deleted_at IS NULL AND stock_quantity <= low_stock_threshold ORDER BY stock_quantity ASC LIMIT 50`,
      [req.user.tenantId]
    );
    resOK(res, r.rows);
  }),
];

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════════
HANDLERS['/api/v1/categories'] = [
  authenticate,
  asyncHandler(async (req, res) => {
    loadBackend();
    if (req.method === 'GET') {
      const r = await _db.query(`SELECT * FROM categories WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY sort_order, name`, [req.user.tenantId]);
      return resOK(res, r.rows);
    }
    const { name, icon, sort_order } = parseBody(req);
    if (!name) return resError(res, 400, 'Nama kategori wajib diisi.');
    const r = await _db.query(
      `INSERT INTO categories (id, tenant_id, name, icon, sort_order) VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING *`,
      [req.user.tenantId, name, icon || '', pi(sort_order)]
    );
    resCreated(res, r.rows[0], 'Kategori berhasil dibuat.');
  }),
];

// ═══════════════════════════════════════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════════════════════════════════════
HANDLERS['/api/v1/orders'] = [
  authenticate, extractTenant,
  asyncHandler(async (req, res) => {
    loadBackend();
    const { status, date, outlet_id, page = 1, limit = 20 } = req.query;
    const params = [req.tenantId];
    let where = 'o.tenant_id=$1 AND o.deleted_at IS NULL';
    let idx = 2;
    if (status) { where += ` AND o.status=$${idx++}`; params.push(status); }
    if (date) { where += ` AND DATE(o.created_at)=$${idx++}`; params.push(date); }
    if (outlet_id) { where += ` AND o.outlet_id=$${idx++}`; params.push(outlet_id); idx++; }
    const offset = (pi(page) - 1) * pi(limit);
    const countR = await _db.query(`SELECT COUNT(*) FROM orders o WHERE ${where}`, params);
    const total = parseInt(countR.rows[0].count, 10);
    params.push(pi(limit), offset);
    const r = await _db.query(
      `SELECT o.*, c.name as customer_name FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE ${where} ORDER BY o.created_at DESC LIMIT $${idx} OFFSET $${idx+1}`,
      params
    );
    resPaginated(res, r.rows, { total, page: pi(page), limit: pi(limit), pages: Math.ceil(total / pi(limit)) });
  }),
];

HANDLERS['/api/v1/orders:POST'] = [
  authenticate, extractTenant,
  asyncHandler(async (req, res) => {
    loadBackend();
    const body = parseBody(req);
    const { outlet_id, customer_id, order_type = 'dine_in', items = [] } = body;
    if (!items.length) return resError(res, 400, 'Minimal 1 item wajib ditambahkan.');

    // Generate order number
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seqR = await _db.query(
      `SELECT COUNT(*)+1 as seq FROM orders WHERE tenant_id=$1 AND DATE(created_at)=CURRENT_DATE`,
      [req.tenantId]
    );
    const seq = String(seqR.rows[0].seq).padStart(4, '0');
    const orderNumber = `ORD-${dateStr}-${seq}`;

    // Calculate totals
    let subtotal = 0;
    for (const item of items) { subtotal += rp(item.unit_price || 0) * pi(item.quantity || 1); }
    const taxAmount = rp(body.tax_amount || 0);
    const discountAmount = rp(body.discount_amount || 0);
    const total = Math.max(0, subtotal + taxAmount - discountAmount);

    const order = await _db.transaction(async (client) => {
      const orderR = await client.query(
        `INSERT INTO orders (id, tenant_id, outlet_id, user_id, customer_id, order_number, order_type, status, subtotal, tax_amount, discount_amount, total, payment_status, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10, 'pending', NOW()) RETURNING *`,
        [req.tenantId, outlet_id || null, req.user.userId, customer_id || null, orderNumber, order_type, subtotal, taxAmount, discountAmount, total]
      );
      const o = orderR.rows[0];
      for (const item of items) {
        await client.query(
          `INSERT INTO order_items (id, tenant_id, order_id, product_id, product_name, quantity, unit_price, subtotal)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
          [req.tenantId, o.id, item.product_id, item.product_name || item.name, pi(item.quantity || 1), rp(item.unit_price), rp(item.unit_price) * pi(item.quantity || 1)]
        );
      }
      return o;
    });

    resCreated(res, order, 'Order berhasil dibuat.');
  }),
];

HANDLERS['/api/v1/orders/:id'] = [
  authenticate,
  asyncHandler(async (req, res) => {
    loadBackend();
    const { id } = req.params;
    const orderR = await _db.query(
      `SELECT o.*, c.name as customer_name FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.id=$1 AND o.tenant_id=$2`,
      [id, req.user.tenantId]
    );
    if (!orderR.rows[0]) return resError(res, 404, 'Order tidak ditemukan.');
    const itemsR = await _db.query(`SELECT * FROM order_items WHERE order_id=$1`, [id]);
    resOK(res, { ...orderR.rows[0], items: itemsR.rows });
  }),
];

HANDLERS['/api/v1/orders/:id/status:PUT'] = [
  authenticate,
  asyncHandler(async (req, res) => {
    loadBackend();
    const { id } = req.params;
    const { status } = parseBody(req);
    const valid = ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
    if (!valid.includes(status)) return resError(res, 400, `Status harus salah satu dari: ${valid.join(', ')}`);
    const completedAt = ['completed', 'ready'].includes(status) ? 'completed_at=NOW(),' : '';
    const r = await _db.query(
      `UPDATE orders SET status=$1, ${completedAt} updated_at=NOW() WHERE id=$2 AND tenant_id=$3 RETURNING *`,
      [status, id, req.user.tenantId]
    );
    if (!r.rows[0]) return resError(res, 404, 'Order tidak ditemukan.');
    resOK(res, r.rows[0], `Status order berhasil diupdate ke "${status}".`);
  }),
];

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMERS
// ═══════════════════════════════════════════════════════════════════════════════
HANDLERS['/api/v1/customers'] = [
  authenticate,
  asyncHandler(async (req, res) => {
    loadBackend();
    const { search, type, page = 1, limit = 50 } = req.query;
    const params = [req.user.tenantId];
    let where = 'tenant_id=$1 AND deleted_at IS NULL';
    let idx = 2;
    if (search) { where += ` AND (name ILIKE $${idx} OR phone ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (type) { where += ` AND customer_type=$${idx++}`; params.push(type); }
    const offset = (pi(page) - 1) * pi(limit);
    const countR = await _db.query(`SELECT COUNT(*) FROM customers WHERE ${where}`, params);
    const total = parseInt(countR.rows[0].count, 10);
    params.push(pi(limit), offset);
    const r = await _db.query(
      `SELECT id, name, phone, email, customer_type, lifetime_value, total_orders, last_order_at, created_at FROM customers WHERE ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx+1}`,
      params
    );
    resPaginated(res, r.rows, { total, page: pi(page), limit: pi(limit), pages: Math.ceil(total / pi(limit)) });
  }),
];

HANDLERS['/api/v1/customers:POST'] = [
  authenticate,
  asyncHandler(async (req, res) => {
    loadBackend();
    const { name, phone, email, birthday } = parseBody(req);
    if (!name) return resError(res, 400, 'Nama pelanggan wajib diisi.');
    const r = await _db.query(
      `INSERT INTO customers (id, tenant_id, name, phone, email, birthday, customer_type, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'new', NOW()) RETURNING *`,
      [req.user.tenantId, name, phone || '', email || '', birthday || null]
    );
    resCreated(res, r.rows[0], 'Pelanggan berhasil ditambahkan.');
  }),
];

HANDLERS['/api/v1/customers/:id'] = [
  authenticate,
  asyncHandler(async (req, res) => {
    loadBackend();
    const { id } = req.params;
    const r = await _db.query(
      `SELECT * FROM customers WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, req.user.tenantId]
    );
    if (!r.rows[0]) return resError(res, 404, 'Pelanggan tidak ditemukan.');
    resOK(res, r.rows[0]);
  }),
];

HANDLERS['/api/v1/customers/:id:PUT'] = [
  authenticate,
  asyncHandler(async (req, res) => {
    loadBackend();
    const { id } = req.params;
    const { name, phone, email, birthday, tags } = parseBody(req);
    const updates = [];
    const params = [];
    let idx = 1;
    if (name !== undefined) { updates.push(`name=$${idx++}`); params.push(name); }
    if (phone !== undefined) { updates.push(`phone=$${idx++}`); params.push(phone || ''); }
    if (email !== undefined) { updates.push(`email=$${idx++}`); params.push(email || ''); }
    if (birthday !== undefined) { updates.push(`birthday=$${idx++}`); params.push(birthday || null); }
    if (tags !== undefined) { updates.push(`tags=$${idx++}`); params.push(tags || []); }
    updates.push('updated_at=NOW()');
    params.push(id, req.user.tenantId);
    const r = await _db.query(
      `UPDATE customers SET ${updates.join(',')} WHERE id=$${idx++} AND tenant_id=$${idx} AND deleted_at IS NULL RETURNING *`,
      params
    );
    if (!r.rows[0]) return resError(res, 404, 'Pelanggan tidak ditemukan.');
    resOK(res, r.rows[0], 'Data pelanggan berhasil diperbarui.');
  }),
];

HANDLERS['/api/v1/customers/:id/orders'] = [
  authenticate,
  asyncHandler(async (req, res) => {
    loadBackend();
    const { id } = req.params;
    const r = await _db.query(
      `SELECT * FROM orders WHERE customer_id=$1 AND tenant_id=$2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20`,
      [id, req.user.tenantId]
    );
    resOK(res, r.rows);
  }),
];

// ═══════════════════════════════════════════════════════════════════════════════
// PROMOTIONS
// ═══════════════════════════════════════════════════════════════════════════════
HANDLERS['/api/v1/promotions'] = [
  authenticate,
  asyncHandler(async (req, res) => {
    loadBackend();
    if (req.method === 'GET') {
      const r = await _db.query(
        `SELECT * FROM promotions WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`,
        [req.user.tenantId]
      );
      return resOK(res, r.rows);
    }
    const { name, promo_type, discount_value, starts_at, ends_at, target_segment, min_order_value } = parseBody(req);
    if (!name) return resError(res, 400, 'Nama promo wajib diisi.');
    const r = await _db.query(
      `INSERT INTO promotions (id, tenant_id, name, promo_type, discount_value, starts_at, ends_at, target_segment, min_order_value, is_active, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, true, NOW()) RETURNING *`,
      [req.user.tenantId, name, promo_type || 'discount_percent', rp(discount_value || 0), starts_at || null, ends_at || null, target_segment || 'all', rp(min_order_value || 0)]
    );
    resCreated(res, r.rows[0], 'Promo berhasil dibuat.');
  }),
];

HANDLERS['/api/v1/promotions/:id:DELETE'] = [
  authenticate,
  asyncHandler(async (req, res) => {
    loadBackend();
    await _db.query(`UPDATE promotions SET deleted_at=NOW() WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.user.tenantId]);
    resOK(res, null, 'Promo berhasil dihapus.');
  }),
];

// ═══════════════════════════════════════════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════════════════════════════════════════
HANDLERS['/api/v1/payments/create:POST'] = [
  authenticate, extractTenant,
  asyncHandler(async (req, res) => {
    loadBackend();
    const { order_id, method } = parseBody(req);
    if (!order_id || !method) return resError(res, 400, 'Order ID dan metode pembayaran wajib diisi.');

    const orderR = await _db.query(`SELECT * FROM orders WHERE id=$1 AND tenant_id=$2`, [order_id, req.tenantId]);
    if (!orderR.rows[0]) return resError(res, 404, 'Order tidak ditemukan.');

    const result = await _paymentSvc.createTripayTransaction(orderR.rows[0], method, {}, req.tenant);
    resCreated(res, result, 'Transaksi pembayaran berhasil dibuat.');
  }),
];

HANDLERS['/api/v1/payments/callback:GET'] = asyncHandler(async (req, res) => {
  loadBackend();
  const { reference } = req.query;
  if (!reference) return resError(res, 400, 'Reference required');
  const result = await _paymentSvc.handleTripayCallback(req.query);
  res.status(200).json({ success: result.success, message: result.message || 'OK' });
});

HANDLERS['/api/v1/payments/callback:POST'] = asyncHandler(async (req, res) => {
  loadBackend();
  const result = await _paymentSvc.handleTripayCallback(req.body);
  res.status(200).json({ success: result.success, message: result.message || 'OK' });
});

HANDLERS['/api/v1/payments/:id'] = [
  authenticate,
  asyncHandler(async (req, res) => {
    loadBackend();
    const r = await _db.query(`SELECT * FROM payments WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.user.tenantId]);
    if (!r.rows[0]) return resError(res, 404, 'Pembayaran tidak ditemukan.');
    resOK(res, r.rows[0]);
  }),
];

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════════════════════════
HANDLERS['/api/v1/reports/daily'] = [
  authenticate, extractTenant,
  asyncHandler(async (req, res) => {
    loadBackend();
    const { start, end, outlet_id } = req.query;
    const params = [req.tenantId];
    let where = 'tenant_id=$1 AND deleted_at IS NULL';
    let idx = 2;
    if (start) { where += ` AND DATE(created_at)>=$${idx++}`; params.push(start); }
    if (end) { where += ` AND DATE(created_at)<=$${idx++}`; params.push(end); }
    if (outlet_id) { where += ` AND outlet_id=$${idx++}`; params.push(outlet_id); }
    const r = await _db.query(
      `SELECT DATE(created_at) as date, COUNT(*) as total_orders, SUM(total) as revenue, AVG(total) as avg_order_value
       FROM orders WHERE ${where} GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 90`,
      params
    );
    resOK(res, r.rows);
  }),
];

HANDLERS['/api/v1/reports/summary'] = [
  authenticate, extractTenant,
  asyncHandler(async (req, res) => {
    loadBackend();
    const today = new Date().toISOString().slice(0, 10);
    const r = await _db.query(
      `SELECT
        COUNT(*) FILTER (WHERE DATE(created_at)=$$2) as orders_today,
        COALESCE(SUM(total) FILTER (WHERE DATE(created_at)=$$2), 0) as revenue_today,
        COUNT(*) FILTER (WHERE customer_id IS NOT NULL AND DATE(created_at)=$$2) as customers_today,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as orders_week,
        COALESCE(SUM(total) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0) as revenue_week,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as orders_month,
        COALESCE(SUM(total) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0) as revenue_month
      FROM orders WHERE tenant_id=$1 AND deleted_at IS NULL`,
      [req.tenantId, today]
    );
    resOK(res, r.rows[0]);
  }),
];

HANDLERS['/api/v1/reports/products'] = [
  authenticate, extractTenant,
  asyncHandler(async (req, res) => {
    loadBackend();
    const { start, end, limit = 10 } = req.query;
    const params = [req.tenantId];
    let where = 'oi.tenant_id=$1';
    let idx = 2;
    if (start) { where += ` AND DATE(o.created_at)>=$${idx++}`; params.push(start); }
    if (end) { where += ` AND DATE(o.created_at)<=$${idx++}`; params.push(end); }
    params.push(pi(limit));
    const r = await _db.query(
      `SELECT oi.product_name, SUM(oi.quantity) as total_sold, SUM(oi.subtotal) as total_revenue, COUNT(DISTINCT o.id) as order_count
       FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE ${where} AND o.deleted_at IS NULL
       GROUP BY oi.product_name ORDER BY total_revenue DESC LIMIT $${idx}`,
      params
    );
    resOK(res, r.rows);
  }),
];

HANDLERS['/api/v1/reports/customers'] = [
  authenticate, extractTenant,
  asyncHandler(async (req, res) => {
    loadBackend();
    const r = await _db.query(
      `SELECT customer_type, COUNT(*) as count, COALESCE(SUM(lifetime_value), 0) as total_value, AVG(lifetime_value) as avg_value
       FROM customers WHERE tenant_id=$1 AND deleted_at IS NULL GROUP BY customer_type`,
      [req.tenantId]
    );
    resOK(res, r.rows);
  }),
];

// ═══════════════════════════════════════════════════════════════════════════════
// WHATSAPP
// ═══════════════════════════════════════════════════════════════════════════════
HANDLERS['/api/v1/whatsapp/send:POST'] = [
  authenticate, extractTenant,
  asyncHandler(async (req, res) => {
    loadBackend();
    const { to, message } = parseBody(req);
    if (!to || !message) return resError(res, 400, 'Nomor tujuan dan pesan wajib diisi.');
    const result = await _whatsappSvc.sendMessage(
      req.tenant.whatsapp_instance_id,
      req.tenant.whatsapp_api_url,
      to,
      message
    );
    resOK(res, result, result.success ? 'Pesan berhasil dikirim.' : 'Gagal kirim pesan.');
  }),
];

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════════════════════════════════════════
HANDLERS['/api/v1/admin/stats'] = [
  adminAuth,
  asyncHandler(async (req, res) => {
    loadBackend();
    const r = await _db.query(`
      SELECT
        COUNT(*) FILTER (WHERE deleted_at IS NULL) as total_tenants,
        COUNT(*) FILTER (WHERE subscription_status='active' AND deleted_at IS NULL) as active_subscriptions,
        COUNT(*) FILTER (WHERE subscription_status='trial' AND deleted_at IS NULL) as trial_tenants,
        COUNT(*) FILTER (WHERE subscription_status='expired' AND deleted_at IS NULL) as expired_tenants,
        COUNT(*) FILTER (WHERE subscription_status='suspended' AND deleted_at IS NULL) as suspended_tenants
      FROM tenants
    `);
    resOK(res, r.rows[0]);
  }),
];

HANDLERS['/api/v1/admin/merchants'] = [
  adminAuth,
  asyncHandler(async (req, res) => {
    loadBackend();
    const { page = 1, limit = 20, search, plan, status } = req.query;
    const params = [];
    let where = 't.deleted_at IS NULL';
    let idx = 1;
    if (search) { where += ` AND t.name ILIKE $${idx++}`; params.push(`%${search}%`); }
    if (plan) { where += ` AND t.plan=$${idx++}`; params.push(plan); }
    if (status) { where += ` AND t.subscription_status=$${idx++}`; params.push(status); }
    const offset = (pi(page) - 1) * pi(limit);
    const countR = await _db.query(`SELECT COUNT(*) FROM tenants t WHERE ${where}`, params);
    const total = parseInt(countR.rows[0].count, 10);
    params.push(pi(limit), offset);
    const r = await _db.query(
      `SELECT t.id, t.name, t.slug, t.plan, t.subscription_status, t.trial_ends_at, t.subscription_expires_at, t.created_at,
              COUNT(DISTINCT o.id) as outlet_count,
              COUNT(DISTINCT u.id) as staff_count
       FROM tenants t LEFT JOIN outlets o ON o.tenant_id=t.id LEFT JOIN users u ON u.tenant_id=t.id
       WHERE ${where} GROUP BY t.id ORDER BY t.created_at DESC LIMIT $${idx} OFFSET $${idx+1}`,
      params
    );
    resPaginated(res, r.rows, { total, page: pi(page), limit: pi(limit), pages: Math.ceil(total / pi(limit)) });
  }),
];

HANDLERS['/api/v1/admin/merchants/:id'] = [
  adminAuth,
  asyncHandler(async (req, res) => {
    loadBackend();
    const { id } = req.params;
    const tenantR = await _db.query(`SELECT * FROM tenants WHERE id=$1 AND deleted_at IS NULL`, [id]);
    if (!tenantR.rows[0]) return resError(res, 404, 'Merchant tidak ditemukan.');
    const [outletsR, usersR, statsR] = await Promise.all([
      _db.query(`SELECT * FROM outlets WHERE tenant_id=$1 AND deleted_at IS NULL`, [id]),
      _db.query(`SELECT id, name, email, role, is_active, last_login_at FROM users WHERE tenant_id=$1 AND deleted_at IS NULL`, [id]),
      _db.query(`SELECT COUNT(*) as total_orders, COALESCE(SUM(total), 0) as lifetime_revenue FROM orders WHERE tenant_id=$1 AND deleted_at IS NULL`, [id]),
    ]);
    resOK(res, { ...tenantR.rows[0], outlets: outletsR.rows, users: usersR.rows, stats: statsR.rows[0] });
  }),
];

HANDLERS['/api/v1/admin/merchants/:id:PUT'] = [
  adminAuth,
  asyncHandler(async (req, res) => {
    loadBackend();
    const { id } = req.params;
    const { plan, subscription_status, subscription_expires_at } = parseBody(req);
    const updates = [];
    const params = [];
    let idx = 1;
    if (plan !== undefined) { updates.push(`plan=$${idx++}`); params.push(plan); }
    if (subscription_status !== undefined) { updates.push(`subscription_status=$${idx++}`); params.push(subscription_status); }
    if (subscription_expires_at !== undefined) { updates.push(`subscription_expires_at=$${idx++}`); params.push(subscription_expires_at); }
    updates.push('updated_at=NOW()');
    params.push(id);
    const r = await _db.query(
      `UPDATE tenants SET ${updates.join(',')} WHERE id=$${idx} RETURNING *`,
      params
    );
    if (!r.rows[0]) return resError(res, 404, 'Merchant tidak ditemukan.');
    resOK(res, r.rows[0], 'Merchant berhasil diperbarui.');
  }),
];

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════════════
HANDLERS['/api/v1/health'] = asyncHandler(async (req, res) => {
  loadBackend();
  try {
    await _db.query('SELECT 1');
    resOK(res, { status: 'healthy', db: 'connected', timestamp: nowISO() });
  } catch (e) {
    resError(res, 503, 'Database unavailable: ' + e.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// VERCEL SERVERLESS HANDLER
// ═══════════════════════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  const url = req.url || '/';
  const pathname = url.split('?')[0];
  const method = req.method.toUpperCase();

  const fn = matchRoute(pathname, method);

  if (!fn) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(404).json({ success: false, message: `Route ${method} ${pathname} tidak ditemukan.` });
  }

  try {
    if (Array.isArray(fn)) {
      let idx = 0;
      const next = () => { idx++; if (idx < fn.length) fn[idx - 1](req, res, next); };
      fn[0](req, res, next);
    } else {
      fn(req, res);
    }
  } catch (err) {
    console.error('[api] Handler error:', err.message, err.stack);
    res.setHeader('Content-Type', 'application/json');
    res.status(err.statusCode || err.status || 500)
       .json({ success: false, message: err.expose ? err.message : 'Internal server error' });
  }
};
