'use strict';

/**
 * Verifikasi ulang JWT di Service Transkrip (FR-AUTH-08).
 */

const jwt = require('jsonwebtoken');
const { verifyToken } = require('../../../lib/tokens');

function verifyTokenMiddleware(req, res, next) {
  const header = req.get('Authorization') || '';
  const [scheme, token] = header.split(' ');

  if (!token || String(scheme).toLowerCase() !== 'bearer') {
    return res.status(401).json({ error: 'access token tidak ditemukan', reason: 'access token tidak ditemukan' });
  }

  try {
    const decoded = verifyToken(token);
    req.auth = {
      type: decoded.typ === 'service' || decoded.role === 'service' ? 'service' : 'user',
      id: decoded.sub,
      role: decoded.role,
      nim: decoded.nim ?? null,
      username: decoded.username ?? null,
      label: decoded.nim || decoded.username || String(decoded.sub),
    };
    return next();
  } catch (err) {
    const reason =
      err instanceof jwt.TokenExpiredError ? 'access token kedaluwarsa' : 'access token tidak valid';
    return res.status(401).json({ error: reason, reason });
  }
}

module.exports = verifyTokenMiddleware;
