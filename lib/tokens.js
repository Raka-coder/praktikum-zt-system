'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const config = require('./config');

/** Access token user: berisi sub (user id), role, nim/username. */
function signUserToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      typ: 'user',
      username: user.username || null,
      nim: user.nim || null,
      nama: user.nama,
    },
    config.JWT_SECRET,
    { expiresIn: config.ACCESS_TOKEN_TTL, algorithm: 'HS256' },
  );
}

/** Token service: sub = client_id, role = service. TTL lebih pendek (5 menit). */
function signServiceToken(clientId) {
  return jwt.sign(
    { sub: clientId, role: 'service', typ: 'service' },
    config.JWT_SECRET,
    { expiresIn: config.SERVICE_TOKEN_TTL, algorithm: 'HS256' },
  );
}

function verifyToken(token) {
  return jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
}

/** Refresh token asli hanya dikirim ke client; DB menyimpan hash SHA-256. */
function createRefreshToken() {
  const raw = crypto.randomBytes(48).toString('hex');
  return { raw, hash: hashRefreshToken(raw) };
}

function hashRefreshToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function refreshExpiry() {
  const expires = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  // SQLite datetime('now') memakai UTC, jadi simpan juga dalam UTC "YYYY-MM-DD HH:MM:SS".
  return expires.toISOString().slice(0, 19).replace('T', ' ');
}

/** Nama subjek untuk audit log: NIM untuk mahasiswa, username untuk dosen/admin. */
function subjectLabel(decoded) {
  if (!decoded) return null;
  if (decoded.typ === 'service') return String(decoded.sub);
  return decoded.nim || decoded.username || String(decoded.sub);
}

module.exports = {
  signUserToken,
  signServiceToken,
  verifyToken,
  createRefreshToken,
  hashRefreshToken,
  refreshExpiry,
  subjectLabel,
};
