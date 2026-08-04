const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { hashPassword, comparePassword } = require('../utils/password');
const { signToken, signRefreshToken, verifyRefreshToken } = require('../config/jwt');
const redis = require('../config/redis');

/**
 * Register a new tenant + owner user
 */
async function register({ business_name, owner_name, email, password, phone }) {
  // Check email uniqueness
  const existing = await db.query(
    'SELECT id FROM users WHERE email = $1',
    [email.toLowerCase()]
  );
  if (existing.rows.length > 0) {
    const err = new Error('Email sudah terdaftar.');
    err.statusCode = 409;
    throw err;
  }

  const hashedPassword = await hashPassword(password);

  return db.transaction(async (client) => {
    // Create tenant
    const tenantResult = await client.query(
      `INSERT INTO tenants (name, plan, status)
       VALUES ($1, 'starter', 'active')
       RETURNING *`,
      [business_name]
    );
    const tenant = tenantResult.rows[0];

    // Create owner user
    const userResult = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, name, phone, role)
       VALUES ($1, $2, $3, $4, $5, 'owner')
       RETURNING id, tenant_id, email, name, phone, role, created_at`,
      [tenant.id, email.toLowerCase(), hashedPassword, owner_name, phone || null]
    );
    const user = userResult.rows[0];

    // Create default outlet
    await client.query(
      `INSERT INTO outlets (tenant_id, name, code, is_active)
       VALUES ($1, $2, 'MAIN', true)`,
      [tenant.id, business_name]
    );

    // Create default loyalty program
    await client.query(
      `INSERT INTO loyalty_programs (tenant_id, name, points_per_rupiah, redemption_rate, is_active)
       VALUES ($1, 'Program Loyalitas Default', 1, 100, true)`,
      [tenant.id]
    );

    // Generate tokens
    const accessToken = signToken({ userId: user.id, tenantId: tenant.id, role: user.role });
    const refreshToken = signRefreshToken({ userId: user.id });

    // Store refresh token
    await redis.set(`refresh:${user.id}`, refreshToken, 60 * 60 * 24 * 30); // 30 days

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        plan: tenant.plan,
      },
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  });
}

/**
 * Login with email + password
 */
async function login(email, password) {
  const userResult = await db.query(
    `SELECT u.*, t.name as tenant_name, t.plan, t.status as tenant_status
     FROM users u
     JOIN tenants t ON t.id = u.tenant_id
     WHERE u.email = $1`,
    [email.toLowerCase()]
  );

  if (userResult.rows.length === 0) {
    const err = new Error('Email atau password salah.');
    err.statusCode = 401;
    throw err;
  }

  const user = userResult.rows[0];

  if (user.tenant_status !== 'active') {
    const err = new Error('Akun tenant tidak aktif. Hubungi administrator.');
    err.statusCode = 403;
    throw err;
  }

  const isValid = await comparePassword(password, user.password_hash);
  if (!isValid) {
    const err = new Error('Email atau password salah.');
    err.statusCode = 401;
    throw err;
  }

  // Update last login
  await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

  // Generate tokens
  const accessToken = signToken({ userId: user.id, tenantId: user.tenant_id, role: user.role });
  const refreshToken = signRefreshToken({ userId: user.id });

  // Store refresh token
  await redis.set(`refresh:${user.id}`, refreshToken, 60 * 60 * 24 * 30);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      avatar_url: user.avatar_url,
    },
    tenant: {
      id: user.tenant_id,
      name: user.tenant_name,
      plan: user.plan,
    },
    access_token: accessToken,
    refresh_token: refreshToken,
  };
}

/**
 * Google OAuth login/registration
 */
async function googleLogin(idToken) {
  const { OAuth2Client } = require('google-auth-library');
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || '');

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID || '',
    });
    payload = ticket.getPayload();
  } catch (err) {
    const error = new Error('Token Google tidak valid.');
    error.statusCode = 401;
    throw error;
  }

  const googleEmail = payload.email;
  const googleName = payload.name;
  const googlePicture = payload.picture;

  // Check if user exists
  const existingUser = await db.query(
    'SELECT u.*, t.name as tenant_name, t.plan, t.status as tenant_status FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.email = $1',
    [googleEmail]
  );

  if (existingUser.rows.length > 0) {
    const user = existingUser.rows[0];
    if (user.tenant_status !== 'active') {
      const err = new Error('Akun tidak aktif. Hubungi administrator.');
      err.statusCode = 403;
      throw err;
    }

    // Update avatar if available
    if (googlePicture && !user.avatar_url) {
      await db.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [googlePicture, user.id]);
    }

    await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const accessToken = signToken({ userId: user.id, tenantId: user.tenant_id, role: user.role });
    const refreshToken = signRefreshToken({ userId: user.id });
    await redis.set(`refresh:${user.id}`, refreshToken, 60 * 60 * 24 * 30);

    return {
      user: { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role },
      tenant: { id: user.tenant_id, name: user.tenant_name, plan: user.plan },
      access_token: accessToken,
      refresh_token: refreshToken,
      is_new: false,
    };
  }

  // Create new tenant + user for Google sign-up
  return db.transaction(async (client) => {
    const businessName = googleName.split(' ')[0] + "'s Store";
    const tenantResult = await client.query(
      `INSERT INTO tenants (name, plan, status) VALUES ($1, 'starter', 'active') RETURNING *`,
      [businessName]
    );
    const tenant = tenantResult.rows[0];

    const userResult = await client.query(
      `INSERT INTO users (tenant_id, email, name, avatar_url, role)
       VALUES ($1, $2, $3, $4, 'owner')
       RETURNING id, tenant_id, email, name, phone, role`,
      [tenant.id, googleEmail, googleName, googlePicture]
    );
    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO outlets (tenant_id, name, code, is_active) VALUES ($1, $2, 'MAIN', true)`,
      [tenant.id, businessName]
    );

    await client.query(
      `INSERT INTO loyalty_programs (tenant_id, name, points_per_rupiah, redemption_rate, is_active)
       VALUES ($1, 'Program Loyalitas Default', 1, 100, true)`,
      [tenant.id]
    );

    const accessToken = signToken({ userId: user.id, tenantId: tenant.id, role: user.role });
    const refreshToken = signRefreshToken({ userId: user.id });
    await redis.set(`refresh:${user.id}`, refreshToken, 60 * 60 * 24 * 30);

    return {
      user: { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role },
      tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan },
      access_token: accessToken,
      refresh_token: refreshToken,
      is_new: true,
    };
  });
}

/**
 * Refresh access token
 */
async function refreshToken(refreshToken) {
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch (err) {
    const error = new Error('Refresh token tidak valid atau sudah kedaluwarsa.');
    error.statusCode = 401;
    throw error;
  }

  // Verify stored token matches
  const storedToken = await redis.get(`refresh:${decoded.userId}`);
  if (storedToken !== refreshToken) {
    const error = new Error('Refresh token sudah tidak berlaku.');
    error.statusCode = 401;
    throw error;
  }

  // Get user
  const userResult = await db.query(
    `SELECT u.*, t.status as tenant_status FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
    [decoded.userId]
  );
  if (userResult.rows.length === 0 || userResult.rows[0].tenant_status !== 'active') {
    const error = new Error('Akun tidak ditemukan atau tidak aktif.');
    error.statusCode = 401;
    throw error;
  }

  const user = userResult.rows[0];
  const newAccessToken = signToken({ userId: user.id, tenantId: user.tenant_id, role: user.role });
  const newRefreshToken = signRefreshToken({ userId: user.id });

  // Rotate refresh token
  await redis.set(`refresh:${user.id}`, newRefreshToken, 60 * 60 * 24 * 30);

  return {
    access_token: newAccessToken,
    refresh_token: newRefreshToken,
  };
}

/**
 * Generate password reset token
 */
async function forgotPassword(email) {
  const userResult = await db.query(
    'SELECT id FROM users WHERE email = $1',
    [email.toLowerCase()]
  );

  if (userResult.rows.length === 0) {
    // Don't reveal if email exists
    return;
  }

  const userId = userResult.rows[0].id;
  const resetToken = uuidv4();
  const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await redis.set(`reset:${resetToken}`, { userId, email: email.toLowerCase() }, 3600);

  // In production, send email via Resend
  if (process.env.RESEND_API_KEY) {
    const axios = require('axios');
    try {
      await axios.post(
        'https://api.resend.com/emails',
        {
          from: process.env.EMAIL_FROM || 'noreply@rectobase.id',
          to: email,
          subject: 'Reset Password - RectoBase',
          html: `
            <h2>Reset Password RectoBase</h2>
            <p>Klik link berikut untuk reset password:</p>
            <a href="${process.env.FRONTEND_URL}/reset-password?token=${resetToken}">
              Reset Password
            </a>
            <p>Link berlaku 1 jam.</p>
          `,
        },
        { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }
      );
    } catch (emailErr) {
      console.error('Failed to send reset email:', emailErr.message);
    }
  } else {
    console.log(`[DEV] Password reset token for ${email}: ${resetToken}`);
  }
}

/**
 * Reset password with token
 */
async function resetPassword(token, newPassword) {
  const resetData = await redis.get(`reset:${token}`);

  if (!resetData) {
    const err = new Error('Token reset tidak valid atau sudah kedaluwarsa.');
    err.statusCode = 400;
    throw err;
  }

  const { userId, email } = resetData;
  const hashedPassword = await hashPassword(newPassword);

  await db.query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND email = $3',
    [hashedPassword, userId, email]
  );

  // Blacklist the reset token
  await redis.del(`reset:${token}`);
}

/**
 * Get current user profile with tenant info
 */
async function getMe(userId) {
  const result = await db.query(
    `SELECT u.id, u.email, u.name, u.phone, u.role, u.avatar_url, u.last_login, u.created_at,
            t.id as tenant_id, t.name as tenant_name, t.plan, t.status as tenant_status, t.logo_url,
            (SELECT COUNT(*) FROM outlets WHERE tenant_id = t.id AND deleted_at IS NULL) as outlet_count,
            (SELECT COUNT(*) FROM customers WHERE tenant_id = t.id AND deleted_at IS NULL) as customer_count
     FROM users u
     JOIN tenants t ON t.id = u.tenant_id
     WHERE u.id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    const err = new Error('User tidak ditemukan.');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

/**
 * Update current user profile
 */
async function updateMe(userId, data) {
  const { name, phone, password, avatar_url } = data;

  const updateFields = [];
  const values = [];
  let idx = 1;

  if (name !== undefined) {
    updateFields.push(`name = $${idx}`);
    values.push(name);
    idx++;
  }
  if (phone !== undefined) {
    updateFields.push(`phone = $${idx}`);
    values.push(phone);
    idx++;
  }
  if (avatar_url !== undefined) {
    updateFields.push(`avatar_url = $${idx}`);
    values.push(avatar_url);
    idx++;
  }
  if (password) {
    const hashed = await hashPassword(password);
    updateFields.push(`password_hash = $${idx}`);
    values.push(hashed);
    idx++;
  }

  if (updateFields.length === 0) {
    return getMe(userId);
  }

  values.push(userId);
  const result = await db.query(
    `UPDATE users SET ${updateFields.join(', ')}, updated_at = NOW()
     WHERE id = $${idx} RETURNING id, email, name, phone, role, avatar_url`,
    values
  );

  if (result.rows.length === 0) {
    const err = new Error('User tidak ditemukan.');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

/**
 * Logout - blacklist refresh token
 */
async function logout(refreshToken) {
  if (!refreshToken) return;

  try {
    const decoded = verifyRefreshToken(refreshToken);
    // Blacklist the refresh token
    await redis.del(`refresh:${decoded.userId}`);
    // Blacklist the access token if provided
  } catch {
    // ignore invalid tokens
  }
}

module.exports = {
  register,
  login,
  googleLogin,
  refreshToken,
  forgotPassword,
  resetPassword,
  getMe,
  updateMe,
  logout,
};
