'use strict';

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });

const str = (key, fallback) => process.env[key] || fallback;
const num = (key, fallback) => {
  const raw = process.env[key];
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const config = {
  ROOT,
  PORT_GATEWAY: num('PORT_GATEWAY', 3000),
  PORT_NILAI: num('PORT_NILAI', 3001),
  PORT_TRANSKRIP: num('PORT_TRANSKRIP', 3002),

  JWT_SECRET: str('JWT_SECRET', 'dev-jwt-secret-jangan-dipakai-di-produksi'),
  ACCESS_TOKEN_TTL: str('ACCESS_TOKEN_TTL', '10m'),
  SERVICE_TOKEN_TTL: str('SERVICE_TOKEN_TTL', '5m'),
  REFRESH_TOKEN_TTL_DAYS: num('REFRESH_TOKEN_TTL_DAYS', 1),

  GATEWAY_SECRET: str('GATEWAY_SECRET', 'dev-gateway-secret'),
  SERVICE_CLIENT_ID: str('SERVICE_CLIENT_ID', 'nilai-service'),
  SERVICE_CLIENT_SECRET: str('SERVICE_CLIENT_SECRET', 'dev-service-secret'),

  JAM_MULAI: num('JAM_MULAI', 7),
  JAM_SELESAI: num('JAM_SELESAI', 21),
  TZ: str('TZ', 'Asia/Jakarta'),

  DB_PATH: path.resolve(ROOT, str('DB_PATH', './db/sistem_nilai.db')),

  GATEWAY_URL: str('GATEWAY_URL', `http://127.0.0.1:${num('PORT_GATEWAY', 3000)}`),
  NILAI_URL: str('NILAI_URL', `http://127.0.0.1:${num('PORT_NILAI', 3001)}`),
  TRANSKRIP_URL: str('TRANSKRIP_URL', `http://127.0.0.1:${num('PORT_TRANSKRIP', 3002)}`),

  // Service hanya listen di loopback: lapisan kedua selain X-Gateway-Secret.
  BIND_HOST: str('BIND_HOST', '127.0.0.1'),
};

module.exports = config;
