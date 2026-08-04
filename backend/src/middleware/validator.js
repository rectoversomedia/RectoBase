const { validationResult } = require('express-validator');

/**
 * Middleware that checks express-validator results
 * Returns 400 with formatted errors if validation fails
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formatted = errors.array().map((err) => ({
      field: err.path,
      message: err.msg,
    }));
    return res.status(400).json({
      success: false,
      message: 'Data yang dikirim tidak valid.',
      errors: formatted,
    });
  }
  next();
}

module.exports = { validate };
