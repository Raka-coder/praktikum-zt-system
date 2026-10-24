'use strict';

/**
 * Verifikasi ulang JWT di service (FR-AUTH-08).
 * Gateway sudah memeriksa, tapi service tetap "never trust": tanpa token valid
 * request ditolak walaupun membawa X-Gateway-Secret.
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

/** Guard role per endpoint. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      const reason =
        req.auth?.role === 'service' ? 'endpoint ini hanya untuk user' : 'role tidak diizinkan';
      return res.status(403).json({ error: reason, reason });
    }
    return next();
  };
}

module.exports = verifyTokenMiddleware;
module.exports.requireRole = requireRole;
