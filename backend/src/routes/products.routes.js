const express = require('express');
const { body, param, query: queryValidator } = require('express-validator');
const multer = require('multer');
const { validate } = require('../middleware/validator');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticateJWT } = require('../middleware/auth');
const { extractTenant } = require('../middleware/tenant');
const { tenantRateLimiter } = require('../middleware/rateLimiter');
const db = require('../utils/db');
const { ok, created, error, paginated, notFound, noContent } = require('../utils/response');

const router = express.Router();

// Multer config for CSV import
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter(req, file, cb) {
    if (!file.originalname.match(/\.(csv|xlsx)$/i)) {
      return cb(new Error('Hanya file CSV dan XLSX yang diizinkan.'));
    }
    cb(null, true);
  },
});

// Validation
const categoryValidation = [
  body('name')
    .trim().notEmpty().withMessage('Nama kategori wajib diisi.')
    .isLength({ max: 100 }).withMessage('Nama kategori maksimal 100 karakter.'),
  body('description')
    .optional().trim().isLength({ max: 255 }).withMessage('Deskripsi maksimal 255 karakter.'),
  body('color')
    .optional().trim().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Format warna hex tidak valid.'),
];

const productValidation = [
  body('name')
    .trim().notEmpty().withMessage('Nama produk wajib diisi.')
    .isLength({ max: 200 }).withMessage('Nama produk maksimal 200 karakter.'),
  body('category_id')
    .optional().isUUID().withMessage('ID kategori tidak valid.'),
  body('sku')
    .optional().trim().isLength({ max: 50 }).withMessage('SKU maksimal 50 karakter.'),
  body('barcode')
    .optional().trim().isLength({ max: 50 }).withMessage('Barcode maksimal 50 karakter.'),
  body('price')
    .optional().isFloat({ min: 0 }).withMessage('Harga harus angka positif.'),
  body('cost_price')
    .optional().isFloat({ min: 0 }).withMessage('Harga modal harus angka positif.'),
  body('stock')
    .optional().isInt({ min: 0 }).withMessage('Stok harus angka bulat positif.'),
  body('min_stock')
    .optional().isInt({ min: 0 }).withMessage('Minimal stok harus angka bulat positif.'),
  body('is_active')
    .optional().isBoolean().withMessage('is_active harus boolean.'),
  body('is_variant')
    .optional().isBoolean().withMessage('is_variant harus boolean.'),
  body('image_url')
    .optional().trim().isURL().withMessage('URL gambar tidak valid.'),
];

const variantValidation = [
  body('name')
    .trim().notEmpty().withMessage('Nama variant wajib diisi.')
    .isLength({ max: 100 }).withMessage('Nama variant maksimal 100 karakter.'),
  body('sku')
    .optional().trim().isLength({ max: 50 }).withMessage('SKU maksimal 50 karakter.'),
  body('price')
    .optional().isFloat({ min: 0 }).withMessage('Harga harus angka positif.'),
  body('stock')
    .optional().isInt({ min: 0 }).withMessage('Stok harus angka bulat positif.'),
];

const stockAdjustmentValidation = [
  body('quantity')
    .notEmpty().withMessage('Jumlah penyesuaian wajib diisi.')
    .isInt().withMessage('Jumlah harus angka bulat.'),
  body('type')
    .notEmpty().withMessage('Tipe penyesuaian wajib diisi.')
    .isIn(['add', 'subtract', 'set']).withMessage('Tipe tidak valid.'),
  body('reason')
    .optional().trim().isLength({ max: 255 }).withMessage('Alasan maksimal 255 karakter.'),
  body('outlet_id')
    .optional().isUUID().withMessage('ID outlet tidak valid.'),
];

// ======================== CATEGORIES ========================

/**
 * GET /api/v1/products/categories
 */
router.get(
  '/categories',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const { search, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [req.user.tenantId];
    let where = 'WHERE tenant_id = $1';
    let idx = 2;

    if (search) {
      where += ` AND name ILIKE $${idx}`;
      params.push(`%${search}%`);
      idx++;
    }

    const countResult = await db.query(
      `SELECT COUNT(*) FROM categories ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await db.query(
      `SELECT c.*, COUNT(p.id) as product_count
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id AND p.deleted_at IS NULL
       ${where}
       GROUP BY c.id
       ORDER BY c.sort_order ASC, c.name ASC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit, 10), offset]
    );

    return paginated(res, result.rows, { page: parseInt(page, 10), limit: parseInt(limit, 10), total });
  })
);

/**
 * POST /api/v1/products/categories
 */
router.post(
  '/categories',
  authenticateJWT,
  extractTenant,
  tenantRateLimiter(20),
  categoryValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { name, description, color, sort_order = 0 } = req.body;
    const result = await db.insert('categories', {
      tenant_id: req.user.tenantId,
      name,
      description: description || null,
      color: color || '#6366F1',
      sort_order,
    });
    return created(res, result, 'Kategori berhasil dibuat.');
  })
);

/**
 * PUT /api/v1/products/categories/:id
 */
router.put(
  '/categories/:id',
  authenticateJWT,
  extractTenant,
  categoryValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { name, description, color, sort_order } = req.body;
    const result = await db.update('categories', req.params.id, {
      ...(name && { name }),
      ...(description !== undefined && { description }),
      ...(color && { color }),
      ...(sort_order !== undefined && { sort_order }),
    });
    if (!result) return notFound(res, 'Kategori tidak ditemukan.');
    return ok(res, result, 'Kategori berhasil diperbarui.');
  })
);

/**
 * DELETE /api/v1/products/categories/:id
 */
router.delete(
  '/categories/:id',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    // Check if category has products
    const check = await db.query(
      'SELECT COUNT(*) FROM products WHERE category_id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    if (parseInt(check.rows[0].count, 10) > 0) {
      return error(res, 400, 'Kategori tidak dapat dihapus karena masih memiliki produk. Pindahkan atau hapus produk terlebih dahulu.');
    }
    const result = await db.softDelete('categories', req.params.id);
    if (!result) return notFound(res, 'Kategori tidak ditemukan.');
    return ok(res, null, 'Kategori berhasil dihapus.');
  })
);

// ======================== PRODUCTS ========================

/**
 * GET /api/v1/products
 */
router.get(
  '/',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const { search, category_id, is_active, page = 1, limit = 50, sort = 'name' } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [req.user.tenantId];
    let where = 'WHERE p.tenant_id = $1';
    let idx = 2;

    if (search) {
      where += ` AND (p.name ILIKE $${idx} OR p.sku ILIKE $${idx} OR p.barcode ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }
    if (category_id) {
      where += ` AND p.category_id = $${idx}`;
      params.push(category_id);
      idx++;
    }
    if (is_active !== undefined) {
      where += ` AND p.is_active = $${idx}`;
      params.push(is_active === 'true');
      idx++;
    }

    const countResult = await db.query(
      `SELECT COUNT(*) FROM products p ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const allowedSorts = ['name', 'price', 'stock', 'created_at'];
    const orderCol = allowedSorts.includes(sort) ? sort : 'name';

    const result = await db.query(
      `SELECT p.*, c.name as category_name,
              COALESCE(SUM(pv.stock), p.stock) as total_stock
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
       ${where}
       GROUP BY p.id, c.name
       ORDER BY p.${orderCol} ASC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit, 10), offset]
    );

    return paginated(res, result.rows, { page: parseInt(page, 10), limit: parseInt(limit, 10), total });
  })
);

/**
 * POST /api/v1/products
 */
router.post(
  '/',
  authenticateJWT,
  extractTenant,
  tenantRateLimiter(50),
  productValidation,
  validate,
  asyncHandler(async (req, res) => {
    const {
      name, category_id, sku, barcode, price, cost_price,
      stock = 0, min_stock = 0, is_active = true, is_variant = false,
      description, image_url, unit = 'pcs'
    } = req.body;

    // Check SKU uniqueness within tenant
    if (sku) {
      const existingSku = await db.query(
        'SELECT id FROM products WHERE tenant_id = $1 AND sku = $2 AND deleted_at IS NULL',
        [req.user.tenantId, sku]
      );
      if (existingSku.rows.length > 0) {
        return error(res, 409, 'SKU sudah digunakan oleh produk lain.');
      }
    }

    const result = await db.insert('products', {
      tenant_id: req.user.tenantId,
      name,
      category_id: category_id || null,
      sku: sku || null,
      barcode: barcode || null,
      price: price || 0,
      cost_price: cost_price || 0,
      stock: is_variant ? 0 : stock,
      min_stock: is_variant ? 0 : min_stock,
      is_active,
      is_variant,
      description: description || null,
      image_url: image_url || null,
      unit: unit || 'pcs',
    });

    return created(res, result, 'Produk berhasil dibuat.');
  })
);

/**
 * GET /api/v1/products/:id
 */
router.get(
  '/:id',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT p.*, c.name as category_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id = $1 AND p.tenant_id = $2`,
      [req.params.id, req.user.tenantId]
    );
    if (result.rows.length === 0) return notFound(res, 'Produk tidak ditemukan.');
    return ok(res, result.rows[0]);
  })
);

/**
 * PUT /api/v1/products/:id
 */
router.put(
  '/:id',
  authenticateJWT,
  extractTenant,
  productValidation,
  validate,
  asyncHandler(async (req, res) => {
    const {
      name, category_id, sku, barcode, price, cost_price,
      min_stock, is_active, description, image_url, unit
    } = req.body;

    if (sku) {
      const existingSku = await db.query(
        'SELECT id FROM products WHERE tenant_id = $1 AND sku = $2 AND id != $3 AND deleted_at IS NULL',
        [req.user.tenantId, sku, req.params.id]
      );
      if (existingSku.rows.length > 0) {
        return error(res, 409, 'SKU sudah digunakan oleh produk lain.');
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (category_id !== undefined) updateData.category_id = category_id;
    if (sku !== undefined) updateData.sku = sku;
    if (barcode !== undefined) updateData.barcode = barcode;
    if (price !== undefined) updateData.price = price;
    if (cost_price !== undefined) updateData.cost_price = cost_price;
    if (min_stock !== undefined) updateData.min_stock = min_stock;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (description !== undefined) updateData.description = description;
    if (image_url !== undefined) updateData.image_url = image_url;
    if (unit !== undefined) updateData.unit = unit;

    const result = await db.query(
      `UPDATE products SET ${Object.keys(updateData).map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $${Object.keys(updateData).length + 2}
       RETURNING *`,
      [req.params.id, ...Object.values(updateData), req.user.tenantId]
    );

    if (result.rows.length === 0) return notFound(res, 'Produk tidak ditemukan.');
    return ok(res, result.rows[0], 'Produk berhasil diperbarui.');
  })
);

/**
 * DELETE /api/v1/products/:id
 */
router.delete(
  '/:id',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `UPDATE products SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, req.user.tenantId]
    );
    if (result.rows.length === 0) return notFound(res, 'Produk tidak ditemukan.');
    return ok(res, null, 'Produk berhasil dihapus.');
  })
);

/**
 * POST /api/v1/products/import
 * Bulk import products via CSV/XLSX
 */
router.post(
  '/import',
  authenticateJWT,
  extractTenant,
  tenantRateLimiter(5),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return error(res, 400, 'File belum diupload.');
    }

    // Parse CSV manually (simple parser)
    const content = req.file.buffer.toString('utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    if (lines.length < 2) {
      return error(res, 400, 'File tidak memiliki data.');
    }

    const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, '').toLowerCase());
    const rows = lines.slice(1);
    const results = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const values = rows[i].split(',').map((v) => v.trim().replace(/"/g, ''));
      const row = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] || '';
      });

      if (!row.name || !row.price) {
        results.failed++;
        results.errors.push({ baris: i + 2, error: 'Nama dan harga wajib diisi.' });
        continue;
      }

      try {
        await db.insert('products', {
          tenant_id: req.user.tenantId,
          name: row.name,
          sku: row.sku || null,
          barcode: row.barcode || null,
          category_id: row.category_id || null,
          price: parseFloat(row.price) || 0,
          cost_price: parseFloat(row.cost_price) || 0,
          stock: parseInt(row.stock, 10) || 0,
          min_stock: parseInt(row.min_stock, 10) || 0,
          is_active: row.is_active !== 'false',
          unit: row.unit || 'pcs',
        });
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push({ baris: i + 2, error: err.message });
      }
    }

    return created(res, results, `Import selesai. ${results.success} berhasil, ${results.failed} gagal.`);
  })
);

// ======================== VARIANTS ========================

/**
 * GET /api/v1/products/:id/variants
 */
router.get(
  '/:id/variants',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT pv.*, ps.stock as outlet_stock
       FROM product_variants pv
       LEFT JOIN product_stock ps ON ps.variant_id = pv.id AND ps.outlet_id = $3
       WHERE pv.product_id = $1 AND pv.tenant_id = $2`,
      [req.params.id, req.user.tenantId, req.query.outlet_id || null]
    );
    return ok(res, result.rows);
  })
);

/**
 * POST /api/v1/products/:id/variants
 */
router.post(
  '/:id/variants',
  authenticateJWT,
  extractTenant,
  variantValidation,
  validate,
  asyncHandler(async (req, res) => {
    // Verify product exists
    const product = await db.findOne('products', { id: req.params.id, tenant_id: req.user.tenantId });
    if (!product) return notFound(res, 'Produk tidak ditemukan.');

    const { name, sku, barcode, price, stock = 0 } = req.body;

    if (sku) {
      const existingSku = await db.query(
        'SELECT id FROM product_variants WHERE tenant_id = $1 AND sku = $2 AND deleted_at IS NULL',
        [req.user.tenantId, sku]
      );
      if (existingSku.rows.length > 0) {
        return error(res, 409, 'SKU sudah digunakan.');
      }
    }

    const result = await db.insert('product_variants', {
      tenant_id: req.user.tenantId,
      product_id: req.params.id,
      name,
      sku: sku || null,
      barcode: barcode || null,
      price: price || product.price,
      stock,
    });

    // Mark parent as variant product
    if (!product.is_variant) {
      await db.query('UPDATE products SET is_variant = true WHERE id = $1', [req.params.id]);
    }

    return created(res, result, 'Variant berhasil dibuat.');
  })
);

/**
 * PUT /api/v1/products/:id/variants/:variantId
 */
router.put(
  '/:id/variants/:variantId',
  authenticateJWT,
  extractTenant,
  variantValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { name, sku, barcode, price, stock } = req.body;
    const result = await db.query(
      `UPDATE product_variants SET
        ${Object.entries({ name, sku, barcode, price, stock })
          .filter(([, v]) => v !== undefined)
          .map(([k], i) => `${k} = $${i + 1}`)
          .join(', ')}
        , updated_at = NOW()
       WHERE id = $${Object.keys({ name, sku, barcode, price, stock }).filter((k) => req.body[k] !== undefined).length + 1}
         AND product_id = $${Object.keys({ name, sku, barcode, price, stock }).filter((k) => req.body[k] !== undefined).length + 2}
         AND tenant_id = $${Object.keys({ name, sku, barcode, price, stock }).filter((k) => req.body[k] !== undefined).length + 3}
       RETURNING *`,
      [...Object.values({ name, sku, barcode, price, stock }).filter((v) => v !== undefined), req.params.variantId, req.params.id, req.user.tenantId]
    );
    if (result.rows.length === 0) return notFound(res, 'Variant tidak ditemukan.');
    return ok(res, result.rows[0], 'Variant berhasil diperbarui.');
  })
);

/**
 * DELETE /api/v1/products/:id/variants/:variantId
 */
router.delete(
  '/:id/variants/:variantId',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `UPDATE product_variants SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND product_id = $2 AND tenant_id = $3 RETURNING id`,
      [req.params.variantId, req.params.id, req.user.tenantId]
    );
    if (result.rows.length === 0) return notFound(res, 'Variant tidak ditemukan.');
    return ok(res, null, 'Variant berhasil dihapus.');
  })
);

// ======================== STOCK ========================

/**
 * PUT /api/v1/products/:id/stock
 * Adjust stock with movement log
 */
router.put(
  '/:id/stock',
  authenticateJWT,
  extractTenant,
  stockAdjustmentValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { quantity, type, reason, outlet_id } = req.body;

    const product = await db.query(
      'SELECT id, stock FROM products WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenantId]
    );
    if (product.rows.length === 0) return notFound(res, 'Produk tidak ditemukan.');

    const currentStock = product.rows[0].stock;
    let newStock;
    if (type === 'add') newStock = currentStock + Math.abs(quantity);
    else if (type === 'subtract') newStock = Math.max(0, currentStock - Math.abs(quantity));
    else newStock = Math.abs(quantity);

    await db.transaction(async (client) => {
      await client.query(
        'UPDATE products SET stock = $1, updated_at = NOW() WHERE id = $2',
        [newStock, req.params.id]
      );
      await client.query(
        `INSERT INTO stock_movements (tenant_id, product_id, outlet_id, type, quantity, before_stock, after_stock, reason, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [req.user.tenantId, req.params.id, outlet_id || null, type, Math.abs(quantity), currentStock, newStock, reason || null, req.user.userId]
      );
    });

    return ok(res, { id: req.params.id, stock_before: currentStock, stock_after: newStock }, 'Stok berhasil disesuaikan.');
  })
);

/**
 * GET /api/v1/products/low-stock
 */
router.get(
  '/low-stock',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const { outlet_id } = req.query;
    let params = [req.user.tenantId];
    let joinClause = '';
    let whereClause = `p.tenant_id = $1 AND p.is_active = true AND p.deleted_at IS NULL AND p.stock <= p.min_stock`;

    if (outlet_id) {
      params.push(outlet_id);
      joinClause = `LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.outlet_id = $${params.length}`;
      whereClause = `p.tenant_id = $1 AND p.is_active = true AND p.deleted_at IS NULL AND COALESCE(ps.stock, p.stock) <= p.min_stock`;
    }

    const result = await db.query(
      `SELECT p.*, c.name as category_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ${joinClause}
       WHERE ${whereClause}
       ORDER BY p.stock ASC`,
      params
    );

    return ok(res, result.rows);
  })
);

module.exports = router;
