'use strict';

/**
 * Audit log — FR-AUD-01.
 * Setiap keputusan akses (allow maupun deny) ditulis SATU baris di sini.
 * Modul ini juga menyediakan `deny()` supaya respons penolakan selalu konsisten
 * dan tidak mungkin lupa dicatat.
 */

const config = require('../../lib/config');
const { db } = require('../../db/database');

const insertAudit = db.prepare(`
  INSERT INTO audit_log (ts, subject_type, subject, role, method, endpoint, device_id, decision, reason, ip)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

/** Waktu lokal sesuai TZ (mis. 2026-10-24 09:15:02) agar mudah dibaca saat demo. */
function nowLocal() {
  return new Date().toLocaleString('sv-SE', { timeZone: config.TZ });
}

function endpointOf(req) {
  const raw = req.originalUrl || req.url || '';
  return raw.split('?')[0];
}

function writeAudit(req, decision, reason) {
  const subject = req.subject || {};
  try {
    insertAudit.run(
      nowLocal(),
      subject.type || 'anonymous',
      subject.label ?? null,
      subject.role ?? null,
      req.method,
      endpointOf(req),
      req.get('X-Device-ID') || null,
      decision,
      reason,
      req.ip || null,
    );
  } catch (err) {
    // Audit tidak boleh menjatuhkan request, tapi harus kelihatan di log server.
    console.error('[audit] gagal menulis audit_log:', err.message);
  }
}

/** Tolak request: catat audit lalu balas JSON. */
function deny(req, res, status, reason) {
  writeAudit(req, 'deny', reason);
  return res.status(status).json({ error: reason, decision: 'deny', reason });
}

/** Izinkan request: catat audit lalu lanjut ke middleware berikutnya. */
function allow(req, reason) {
  writeAudit(req, 'allow', reason);
}

module.exports = { writeAudit, deny, allow, nowLocal };
