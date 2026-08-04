const jwt = require('jsonwebtoken');

const ACCESS_SECRET = process.env.JWT_SECRET || 'dev-access-secret-at-least-32-chars!!';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-at-least-32-chars!!';
const ACCESS_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';
const REFRESH_EXPIRES = '30d';

/**
 * Sign an access token
 * @param {object} payload - { userId, tenantId, role }
 * @returns {string}
 */
function signToken(payload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES });
}

/**
 * Verify an access token
 * @param {string} token
 * @returns {object}
 */
function verifyToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

/**
 * Sign a refresh token
 * @param {object} payload - { userId }
 * @returns {string}
 */
function signRefreshToken(payload) {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
}

/**
 * Verify a refresh token
 * @param {string} token
 * @returns {object}
 */
function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

module.exports = {
  signToken,
  verifyToken,
  signRefreshToken,
  verifyRefreshToken,
};
