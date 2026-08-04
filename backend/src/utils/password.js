const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;

/**
 * Hash a plain text password
 * @param {string} plainPassword
 * @returns {Promise<string>}
 */
async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/**
 * Compare a plain password with a hash
 * @param {string} plainPassword
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function comparePassword(plainPassword, hash) {
  return bcrypt.compare(plainPassword, hash);
}

/**
 * Validate password strength
 * @param {string} password
 * @returns {{ valid: boolean, reasons: string[] }}
 */
function validatePasswordStrength(password) {
  const reasons = [];
  if (password.length < 8) reasons.push('Password minimal 8 karakter.');
  if (!/[A-Z]/.test(password)) reasons.push('Password harus mengandung minimal 1 huruf besar.');
  if (!/[a-z]/.test(password)) reasons.push('Password harus mengandung minimal 1 huruf kecil.');
  if (!/[0-9]/.test(password)) reasons.push('Password harus mengandung minimal 1 angka.');
  if (!/[^A-Za-z0-9]/.test(password)) reasons.push('Password harus mengandung minimal 1 karakter khusus.');
  return {
    valid: reasons.length === 0,
    reasons,
  };
}

module.exports = {
  hashPassword,
  comparePassword,
  validatePasswordStrength,
};
