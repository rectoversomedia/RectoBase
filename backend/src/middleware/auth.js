const { verifyToken } = require('../config/jwt');
const redis = require('../config/redis');

/**
 * Authenticate JWT access token
 */
async function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Token otorisasi tidak ditemukan. Silakan login kembali.',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Check if token is blacklisted
    const blacklisted = await redis.get(`blacklist:${token}`);
    if (blacklisted) {
      return res.status(401).json({
        success: false,
        message: 'Token sudah tidak berlaku. Silakan login kembali.',
      });
    }

    const decoded = verifyToken(token);
    req.user = {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      role: decoded.role,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token sudah kedaluwarsa. Silakan login kembali.',
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Token tidak valid.',
    });
  }
}

/**
 * Require specific role(s)
 * @param  {...string} roles
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Autentikasi diperlukan.',
      });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Anda tidak memiliki akses untuk fitur ini.',
      });
    }
    next();
  };
}

/**
 * Require specific plan(s)
 * @param  {...string} plans
 */
function requirePlan(...plans) {
  return async (req, res, next) => {
    if (!req.tenant || !req.tenant.plan) {
      return res.status(403).json({
        success: false,
        message: 'Tidak dapat memverifikasi paket langganan.',
      });
    }
    if (!plans.includes(req.tenant.plan)) {
      return res.status(403).json({
        success: false,
        message: `Fitur ini memerlukan paket ${plans.join(' atau ')}. Upgrade paket Anda untuk mengakses fitur ini.`,
      });
    }
    next();
  };
}

/**
 * Optional auth - attach user if token exists, otherwise continue
 */
async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];
  try {
    const blacklisted = await redis.get(`blacklist:${token}`);
    if (blacklisted) return next();

    const decoded = verifyToken(token);
    req.user = {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      role: decoded.role,
    };
  } catch {
    // ignore invalid tokens for optional auth
  }
  next();
}

module.exports = {
  authenticateJWT,
  requireRole,
  requirePlan,
  optionalAuth,
};
