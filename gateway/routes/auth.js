'use strict';

/**
 * Policy Enforcement Point untuk /auth/* (PE/PA juga menerbitkan token).
 * Endpoint auth tidak melewati pipeline token/device karena justru di sinilah
 * token diterbitkan — kecuali login yang tetap mewajibkan device terdaftar.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../../lib/config');
const { db } = require('../../db/database');
const {
  signUserToken,
  signServiceToken,
  createRefreshToken,
  hashRefreshToken,
  refreshExpiry,
} = require('../../lib/tokens');
const { deny, writeAudit } = require('../middleware/audit');

const router = express.Router();

const findUserByLogin = db.prepare(
  'SELECT * FROM users WHERE username = ? OR nim = ? LIMIT 1',
);
const findDevice = db.prepare('SELECT device_id FROM devices WHERE device_id = ? AND user_id = ?');
const findRefresh = db.prepare('SELECT * FROM refresh_token WHERE token_hash = ?');
const findUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const insertRefresh = db.prepare(`
  INSERT INTO refresh_token (user_id, token_hash, device_id, expires_at)
  VALUES (?, ?, ?, ?)
`);
const revokeRefresh = db.prepare(`
  UPDATE refresh_token SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL
`);
const findClient = db.prepare('SELECT * FROM clients WHERE client_id = ?');

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    nim: user.nim,
    nama: user.nama,
    role: user.role,
  };
}

// ---------- POST /auth/login — FR-AUTH-01/02/03, 03-RULES §3.1 ----------
router.post('/login', (req, res) => {
  const body = req.body || {};
  const identifier = body.username ?? body.nim;
  const password = body.password;
  const deviceId = req.get('X-Device-ID');

  if (!identifier || !password) {
    return deny(req, res, 400, 'username/nim dan password wajib diisi');
  }

  const user = findUserByLogin.get(String(identifier), String(identifier));

  // Alasan sengaja tidak membedakan "user tidak ada" dan "password salah".
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return deny(req, res, 401, 'kredensial tidak valid');
  }

  // Subjek sudah diketahui → audit mencatat user, bukan anonymous.
  req.subject = {
    type: 'user',
    id: user.id,
    role: user.role,
    label: user.nim || user.username,
  };

  if (!deviceId || !findDevice.get(deviceId, user.id)) {
    return deny(req, res, 403, 'device tidak terdaftar untuk user ini');
  }

  const accessToken = signUserToken(user);
  const { raw: refreshToken, hash } = createRefreshToken();
  insertRefresh.run(user.id, hash, deviceId, refreshExpiry());

  writeAudit(req, 'allow', 'login berhasil');

  return res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: config.ACCESS_TOKEN_TTL,
    refresh_expires_in_days: config.REFRESH_TOKEN_TTL_DAYS,
    user: publicUser(user),
  });
});

// ---------- POST /auth/refresh — 03-RULES §3.2 ----------
router.post('/refresh', (req, res) => {
  const raw = (req.body || {}).refresh_token;
  if (!raw) return deny(req, res, 400, 'refresh token wajib dikirim');

  const row = findRefresh.get(hashRefreshToken(raw));
  if (!row) return deny(req, res, 401, 'refresh token tidak valid');

  const user = findUserById.get(row.user_id);
  if (user) {
    req.subject = {
      type: 'user',
      id: user.id,
      role: user.role,
      label: user.nim || user.username,
    };
  }

  if (row.revoked_at) return deny(req, res, 401, 'refresh token sudah dicabut');
  if (new Date(`${row.expires_at}Z`).getTime() <= Date.now()) {
    return deny(req, res, 401, 'refresh token kedaluwarsa');
  }

  writeAudit(req, 'allow', 'refresh token valid');

  return res.json({
    access_token: signUserToken(user),
    token_type: 'Bearer',
    expires_in: config.ACCESS_TOKEN_TTL,
  });
});

// ---------- POST /auth/logout — idempoten (03-RULES §3.3) ----------
router.post('/logout', (req, res) => {
  const raw = (req.body || {}).refresh_token;

  if (raw) {
    const row = findRefresh.get(hashRefreshToken(raw));
    if (row) {
      const user = findUserById.get(row.user_id);
      if (user) {
        req.subject = {
          type: 'user',
          id: user.id,
          role: user.role,
          label: user.nim || user.username,
        };
      }
      revokeRefresh.run(row.id);
    }
  }

  writeAudit(req, 'allow', 'logout: refresh token dicabut');
  return res.json({ message: 'logout berhasil', revoked: Boolean(raw) });
});

// ---------- POST /auth/service — FR-AUTH-05 ----------
router.post('/service', (req, res) => {
  const { client_id: clientId, client_secret: clientSecret } = req.body || {};

  const client = clientId ? findClient.get(String(clientId)) : null;
  if (!client || !clientSecret || !bcrypt.compareSync(String(clientSecret), client.secret_hash)) {
    return deny(req, res, 401, 'client credential tidak valid');
  }

  req.subject = {
    type: 'service',
    id: client.client_id,
    role: 'service',
    label: client.client_id,
  };
  writeAudit(req, 'allow', 'token service diterbitkan');

  return res.json({
    access_token: signServiceToken(client.client_id),
    token_type: 'Bearer',
    expires_in: config.SERVICE_TOKEN_TTL,
    role: 'service',
  });
});

module.exports = router;
