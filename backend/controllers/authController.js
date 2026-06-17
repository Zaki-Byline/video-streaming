import bcrypt from 'bcryptjs';
import pool from '../config/database.js';
import config from '../config/config.js';
import { generateToken, getAuthCookieOptions } from '../middleware/auth.js';

/**
 * Admin login
 */
export async function login(req, res) {
  try {
    const { username, password, rememberMe = false } = req.body;
    
    // Strict validation - check for existence and non-empty strings
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    // Trim and validate - ensure not just whitespace
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();
    
    if (!trimmedUsername || !trimmedPassword) {
      return res.status(400).json({ error: 'Username and password cannot be empty' });
    }
    
    // Minimum length validation
    if (trimmedUsername.length < 1 || trimmedPassword.length < 3) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    // For initial setup, use default admin credentials
    // In production, these should be in the database
    const defaultAdmin = {
      username: process.env.ADMIN_USERNAME || 'admin',
      password: process.env.ADMIN_PASSWORD || 'admin123'
    };
    
    // Check if admin exists in database (use trimmed username)
    const [users] = await pool.execute(
      `SELECT 
        id, username, email, full_name, role, 
        can_upload_videos, can_view_videos, can_check_links, can_check_qr_codes,
        is_active
      FROM admins WHERE username = ?`,
      [trimmedUsername]
    );
    
    let isValid = false;
    let user = null;
    
    if (users.length > 0) {
      // User exists in database
      user = users[0];
      
      // Check if user is active
      if (user.is_active === 0 || user.is_active === false) {
        return res.status(403).json({ error: 'Account is inactive. Please contact administrator.' });
      }
      
      // Verify password (use trimmed password)
      const [fullUser] = await pool.execute(
        'SELECT password_hash FROM admins WHERE id = ?',
        [user.id]
      );
      if (fullUser.length === 0 || !fullUser[0].password_hash) {
        isValid = false;
      } else {
        isValid = await bcrypt.compare(trimmedPassword, fullUser[0].password_hash);
      }
    } else {
      // Fallback to default admin (for initial setup) - use trimmed values
      isValid = trimmedUsername === defaultAdmin.username && trimmedPassword === defaultAdmin.password;
      if (isValid) {
        user = {
          id: null,
          username: defaultAdmin.username,
          role: 'admin',
          can_upload_videos: true,
          can_view_videos: true,
          can_check_links: true,
          can_check_qr_codes: true,
          is_active: true
        };
      }
    }
    
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Update last login
    if (user.id) {
      await pool.execute(
        'UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
        [user.id]
      );
    }
    
    const token = generateToken(user.id || trimmedUsername, Boolean(rememberMe));

    res.cookie(config.auth.cookieName, token, getAuthCookieOptions(Boolean(rememberMe)));

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role || 'admin',
        can_upload_videos: user.can_upload_videos || false,
        can_view_videos: user.can_view_videos || false,
        can_check_links: user.can_check_links || false,
        can_check_qr_codes: user.can_check_qr_codes || false
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
}

/**
 * Verify token
 */
export async function verifyToken(req, res) {
  res.json({
    valid: true,
    user: req.user
  });
}

/**
 * Session status check endpoint.
 * Always returns 200 to avoid noisy 401s for guests.
 */
export async function sessionStatus(req, res) {
  res.json({
    valid: Boolean(req.user),
    user: req.user || null
  });
}

/**
 * Log out — clears the httpOnly auth cookie
 */
export async function logout(req, res) {
  res.clearCookie(config.auth.cookieName, getAuthCookieOptions(false));
  res.json({ success: true });
}





