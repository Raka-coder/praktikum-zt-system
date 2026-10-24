'use strict';

/**
 * Menampilkan audit_log terakhir — bukti bahwa setiap keputusan
 * (allow maupun deny) tercatat. Dipakai saat demo/rekaman.
 *
 * Pemakaian:
 *   npm run audit            → 15 baris terakhir
 *   npm run audit -- 50      → 50 baris terakhir
 *   npm run audit -- deny    → hanya keputusan deny
 */

const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('../lib/config');

const arg = process.argv[2];
const onlyDeny = arg === 'deny';
const limit = Number.isFinite(Number(arg)) && Number(arg) > 0 ? Number(arg) : 15;
const dbPath = path.resolve(process.env.DB_PATH || config.DB_PATH);

let db;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
} catch (err) {
  console.error(`Tidak bisa membuka DB: ${dbPath}`);
  console.error('Jalankan `npm run seed` lebih dulu.');
  process.exit(1);
}

const sql = `
  SELECT id, ts, subject, role, method, endpoint, decision, device_id, reason
  FROM audit_log
  ${onlyDeny ? "WHERE decision = 'deny'" : ''}
  ORDER BY id DESC
  LIMIT ?
`;

const rows = db.prepare(sql).all(limit).reverse();

if (rows.length === 0) {
  console.log('audit_log masih kosong. Jalankan beberapa request dulu.');
  process.exit(0);
}

console.log(`\nAudit log (${rows.length} baris terakhir dari ${dbPath}):\n`);
console.table(
  rows.map((r) => ({
    id: r.id,
    waktu: r.ts,
    subjek: r.subject ?? '-',
    role: r.role ?? '-',
    aksi: `${r.method} ${r.endpoint}`,
    device: r.device_id ?? '-',
    putusan: r.decision,
    alasan: String(r.reason ?? '').slice(0, 55),
  })),
);

const total = db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c;
const denyCount = db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE decision = 'deny'").get().c;
const allowCount = db
  .prepare("SELECT COUNT(*) AS c FROM audit_log WHERE decision = 'allow'")
  .get().c;
console.log(`Total ${total} baris — allow ${allowCount}, deny ${denyCount}\n`);
