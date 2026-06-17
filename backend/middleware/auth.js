import jwt from 'jsonwebtoken';
import config from '../config/config.js';

function getCookieValue(req, name) {
  const cookies = req.headers.cookie;
  if (!cookies) return null;

  const match = cookies.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function getAuthCookieOptions(rememberMe = false) {
  const isProduction = config.nodeEnv === 'production';
  const options = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction && config.auth.crossOrigin ? 'none' : 'lax',
    path: '/'
  };

  if (rememberMe) {
    options.maxAge = 7 * 24 * 60 * 60 * 1000;
  }

  return options;
}

export function getTokenFromRequest(req) {
  const cookieToken = getCookieValue(req, config.auth.cookieName);
  if (cookieToken) return cookieToken;

  const authHeader = req.headers.authorization;
  return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

/**
 * Verify JWT token
 */
export function authenticateToken(req, res, next) {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, config.jwt.secret, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    req.user = user;
    next();
  });
}

/**
 * Optional JWT auth middleware.
 * Never rejects; sets req.user when token is valid.
 */
export function optionalAuthenticateToken(req, _res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, config.jwt.secret, (err, user) => {
    req.user = err ? null : user;
    next();
  });
}

/**
 * Generate JWT token
 */
export function generateToken(userId, rememberMe = false) {
  return jwt.sign({ userId }, config.jwt.secret, {
    expiresIn: rememberMe ? config.jwt.expiresIn : config.jwt.sessionExpiresIn
  });
}





