'use strict';

const crypto = require('node:crypto');
const config = require('../../../lib/config');

const EXPECTED = Buffer.from(config.GATEWAY_SECRET);
const REASON = 'akses langsung ke service ditolak';

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function gatewaySecret(req, res, next) {
  const provided = req.get('X-Gateway-Secret');
  if (!provided || !safeEqual(Buffer.from(provided), EXPECTED)) {
    return res.status(403).json({ error: REASON, reason: REASON });
  }
  return next();
}

module.exports = gatewaySecret;
module.exports.REASON = REASON;
