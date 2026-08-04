const { validationResult } = require('express-validator');

/**
 * Async handler wrapper to avoid try/catch in every route
 * @param {Function} fn
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Global error handler middleware
 */
function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  // Joi / express-validator errors
  if (err.isJoi || err.type === 'validation') {
    return res.status(400).json({
      success: false,
      message: 'Data yang dikirim tidak valid.',
      errors: err.details || err.errors,
    });
  }

  // PostgreSQL unique violation
  if (err.code === '23505') {
    const field = err.constraint?.replace(/^[a-z_]+_([a-z_]+)_key$/, '$1') || 'data';
    return res.status(409).json({
      success: false,
      message: `Data sudah ada: ${field} sudah terdaftar.`,
    });
  }

  // PostgreSQL foreign key violation
  if (err.code === '23503') {
    return res.status(400).json({
      success: false,
      message: 'Data referensi tidak ditemukan.',
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Token tidak valid.',
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token sudah kedaluwarsa. Silakan login kembali.',
    });
  }

  // Multer file size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: 'Ukuran file terlalu besar. Maksimal 5MB.',
    });
  }

  // Default 500
  const status = err.statusCode || err.status || 500;
  const message = err.message || 'Terjadi kesalahan di server. Silakan coba lagi.';

  res.status(status).json({
    success: false,
    message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}

/**
 * 404 Not Found handler
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    message: `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan.`,
  });
}

module.exports = {
  asyncHandler,
  errorHandler,
  notFoundHandler,
};
