const db = require('../utils/db');

/**
 * Extract tenant info from req.user and attach to req.tenant
 * Also performs permission check based on outlet assignment
 */
async function extractTenant(req, res, next) {
  if (!req.user || !req.user.tenantId) {
    return res.status(401).json({
      success: false,
      message: 'Autentikasi diperlukan.',
    });
  }

  try {
    const result = await db.query(
      `SELECT id, name, plan, status, logo_url, settings, created_at
       FROM tenants
       WHERE id = $1 AND status = 'active'`,
      [req.user.tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Akun tidak ditemukan atau tidak aktif.',
      });
    }

    req.tenant = result.rows[0];
    next();
  } catch (err) {
    console.error('extractTenant error:', err);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memuat data tenant.',
    });
  }
}

/**
 * Verify outlet belongs to tenant
 */
async function verifyOutlet(req, res, next) {
  const outletId = req.params.outletId || req.body.outlet_id || req.query.outlet;
  if (!outletId) return next();

  try {
    const result = await db.query(
      `SELECT id, name, code, is_active
       FROM outlets
       WHERE id = $1 AND tenant_id = $2`,
      [outletId, req.user.tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Outlet tidak ditemukan.',
      });
    }

    if (!result.rows[0].is_active) {
      return res.status(400).json({
        success: false,
        message: 'Outlet tidak aktif.',
      });
    }

    req.outlet = result.rows[0];
    next();
  } catch (err) {
    console.error('verifyOutlet error:', err);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memverifikasi outlet.',
    });
  }
}

module.exports = {
  extractTenant,
  verifyOutlet,
};
