'use strict';

/**
 * Langkah 2 pipeline (03-RULES §2): verifikasi access token.
 * Tidak ada sesi yang dipercaya — setiap request harus membawa JWT valid.
 */

const jwt = require('jsonwebtoken');
const { verifyToken } = require('../../lib/tokens');
const { deny } = require('./audit');

function authenticate(req, res, next) {
  const header = req.get('Authorization') || '';
  const [scheme, token] = header.split(' ');

  if (!token || String(scheme).toLowerCase() !== 'bearer') {
    return deny(req, res, 401, 'access token tidak ditemukan');
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return deny(req, res, 401, 'access token kedaluwarsa');
    }
    return deny(req, res, 401, 'access token tidak valid');
  }

  const isService = decoded.typ === 'service' || decoded.role === 'service';
  req.decoded = decoded;
  req.subject = {
    type: isService ? 'service' : 'user',
    id: decoded.sub,
    role: decoded.role,
    label: isService ? String(decoded.sub) : decoded.nim || decoded.username || String(decoded.sub),
    nim: decoded.nim || null,
    username: decoded.username || null,
    nama: decoded.nama || null,
  };

  return next();
}

module.exports = authenticate;
