'use strict';

/**
 * Aturan jam akses (FR-CTX-02/03), dipakai gateway DAN Service Nilai
 * (lapisan kedua). Rentang dari .env agar mudah didemokan.
 */

const config = require('./config');

const REASON = `perubahan nilai hanya diizinkan pukul ${String(config.JAM_MULAI).padStart(2, '0')}.00–${String(config.JAM_SELESAI).padStart(2, '0')}.00 (di luar jam akses)`;

const MUTATING_ROUTES = [
  { method: 'PUT', pattern: /^\/nilai\/[^/]+\/?$/ },
  { method: 'POST', pattern: /^\/kelas\/[^/]+\/finalisasi\/?$/ },
];

function needsTimeWindow(method, path) {
  const verb = String(method).toUpperCase();
  const cleanPath = String(path).split('?')[0];
  return MUTATING_ROUTES.some((route) => route.method === verb && route.pattern.test(cleanPath));
}

/** Menit sejak 00.00 pada zona TZ; 21.00 tepat dianggap di luar jam. */
function currentMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === 'hour').value);
  const minute = Number(parts.find((p) => p.type === 'minute').value);
  return hour * 60 + minute;
}

function withinWindow(nowMinutes = currentMinutes()) {
  return nowMinutes >= config.JAM_MULAI * 60 && nowMinutes < config.JAM_SELESAI * 60;
}

module.exports = { needsTimeWindow, currentMinutes, withinWindow, REASON };
