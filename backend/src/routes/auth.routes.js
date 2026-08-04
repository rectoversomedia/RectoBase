const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validator');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticateJWT, requireRole } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const authService = require('../services/auth.service');
const { ok, created, error } = require('../utils/response');

const router = express.Router();

// Validation rules
const registerValidation = [
  body('business_name')
    .trim()
    .notEmpty().withMessage('Nama bisnis wajib diisi.')
    .isLength({ max: 100 }).withMessage('Nama bisnis maksimal 100 karakter.'),
  body('owner_name')
    .trim()
    .notEmpty().withMessage('Nama pemilik wajib diisi.')
    .isLength({ max: 100 }).withMessage('Nama maksimal 100 karakter.'),
  body('email')
    .trim()
    .notEmpty().withMessage('Email wajib diisi.')
    .isEmail().withMessage('Format email tidak valid.')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password wajib diisi.')
    .isLength({ min: 8 }).withMessage('Password minimal 8 karakter.')
    .matches(/[A-Z]/).withMessage('Password harus mengandung huruf besar.')
    .matches(/[a-z]/).withMessage('Password harus mengandung huruf kecil.')
    .matches(/[0-9]/).withMessage('Password harus mengandung angka.')
    .matches(/[^A-Za-z0-9]/).withMessage('Password harus mengandung karakter khusus.'),
  body('phone')
    .trim()
    .notEmpty().withMessage('Nomor telepon wajib diisi.')
    .matches(/^[\d\s\+\-\(\)]{8,20}$/).withMessage('Format nomor telepon tidak valid.'),
];

const loginValidation = [
  body('email')
    .trim().notEmpty().withMessage('Email wajib diisi.')
    .isEmail().withMessage('Format email tidak valid.')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password wajib diisi.'),
];

const googleLoginValidation = [
  body('id_token')
    .notEmpty().withMessage('ID token wajib diisi.'),
];

const forgotPasswordValidation = [
  body('email')
    .trim().notEmpty().withMessage('Email wajib diisi.')
    .isEmail().withMessage('Format email tidak valid.')
    .normalizeEmail(),
];

const resetPasswordValidation = [
  body('token')
    .notEmpty().withMessage('Token reset password wajib diisi.'),
  body('password')
    .notEmpty().withMessage('Password wajib diisi.')
    .isLength({ min: 8 }).withMessage('Password minimal 8 karakter.')
    .matches(/[A-Z]/).withMessage('Password harus mengandung huruf besar.')
    .matches(/[a-z]/).withMessage('Password harus mengandung huruf kecil.')
    .matches(/[0-9]/).withMessage('Password harus mengandung angka.')
    .matches(/[^A-Za-z0-9]/).withMessage('Password harus mengandung karakter khusus.'),
];

const updateProfileValidation = [
  body('name')
    .optional().trim().isLength({ max: 100 }).withMessage('Nama maksimal 100 karakter.'),
  body('phone')
    .optional().trim().matches(/^[\d\s\+\-\(\)]{8,20}$/).withMessage('Format nomor telepon tidak valid.'),
  body('password')
    .optional()
    .isLength({ min: 8 }).withMessage('Password minimal 8 karakter.')
    .matches(/[A-Z]/).withMessage('Password harus mengandung huruf besar.')
    .matches(/[a-z]/).withMessage('Password harus mengandung huruf kecil.')
    .matches(/[0-9]/).withMessage('Password harus mengandung angka.')
    .matches(/[^A-Za-z0-9]/).withMessage('Password harus mengandung karakter khusus.'),
];

/**
 * POST /api/v1/auth/register
 * Register new tenant + owner user
 */
router.post('/register', authLimiter, registerValidation, validate, asyncHandler(async (req, res) => {
  const { business_name, owner_name, email, password, phone } = req.body;
  const result = await authService.register({ business_name, owner_name, email, password, phone });
  return created(res, result, 'Registrasi berhasil. Silakan login.');
}));

/**
 * POST /api/v1/auth/login
 * Login with email + password
 */
router.post('/login', authLimiter, loginValidation, validate, asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.login(email, password);
  return ok(res, result, 'Login berhasil.');
}));

/**
 * POST /api/v1/auth/google-login
 * Login or register with Google OAuth
 */
router.post('/google-login', authLimiter, googleLoginValidation, validate, asyncHandler(async (req, res) => {
  const { id_token } = req.body;
  const result = await authService.googleLogin(id_token);
  return ok(res, result, 'Login dengan Google berhasil.');
}));

/**
 * POST /api/v1/auth/refresh
 * Refresh access token
 */
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    return error(res, 400, 'Refresh token wajib diisi.');
  }
  const result = await authService.refreshToken(refresh_token);
  return ok(res, result, 'Token berhasil di-refresh.');
}));

/**
 * POST /api/v1/auth/forgot-password
 * Generate password reset token
 */
router.post('/forgot-password', authLimiter, forgotPasswordValidation, validate, asyncHandler(async (req, res) => {
  const { email } = req.body;
  await authService.forgotPassword(email);
  return ok(res, null, 'Jika email terdaftar, link reset password sudah dikirim.');
}));

/**
 * POST /api/v1/auth/reset-password
 * Reset password with token
 */
router.post('/reset-password', authLimiter, resetPasswordValidation, validate, asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  await authService.resetPassword(token, password);
  return ok(res, null, 'Password berhasil direset. Silakan login.');
}));

/**
 * GET /api/v1/auth/me
 * Get current user + tenant info
 */
router.get('/me', authenticateJWT, asyncHandler(async (req, res) => {
  const result = await authService.getMe(req.user.userId);
  return ok(res, result);
}));

/**
 * PUT /api/v1/auth/me
 * Update current user profile
 */
router.put('/me', authenticateJWT, updateProfileValidation, validate, asyncHandler(async (req, res) => {
  const result = await authService.updateMe(req.user.userId, req.body);
  return ok(res, result, 'Profil berhasil diperbarui.');
}));

/**
 * POST /api/v1/auth/logout
 * Logout and blacklist refresh token
 */
router.post('/logout', asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;
  if (refresh_token) {
    await authService.logout(refresh_token);
  }
  return ok(res, null, 'Logout berhasil.');
}));

module.exports = router;
