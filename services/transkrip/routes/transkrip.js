'use strict';

const express = require('express');
const { db } = require('../../../db/database');
const { resolveKelas } = require('../../../lib/kelas');

const router = express.Router();

const findUserByNim = db.prepare('SELECT id, nim, nama, role FROM users WHERE nim = ?');
const findUserById = db.prepare('SELECT id, nim, nama FROM users WHERE id = ?');

const listTranskrip = db.prepare(`
  SELECT kode_kelas, nama_mk, angka, huruf, synced_at
  FROM transkrip_entry
  WHERE nim = ?
  ORDER BY kode_kelas
`);

const listNilaiKelas = db.prepare(`
  SELECT n.user_id, u.nim, u.nama, k.kode, k.nama_mk, n.angka, n.huruf
  FROM nilai n
  JOIN users u ON u.id = n.user_id
  JOIN kelas k ON k.id = n.kelas_id
  WHERE n.kelas_id = ?
  ORDER BY u.nim
`);

const upsertEntry = db.prepare(`
  INSERT INTO transkrip_entry (user_id, nim, kode_kelas, nama_mk, angka, huruf, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT (user_id, kode_kelas) DO UPDATE SET
    nim       = excluded.nim,
    nama_mk   = excluded.nama_mk,
    angka     = excluded.angka,
    huruf     = excluded.huruf,
    synced_at = datetime('now')
`);

/** GET /transkrip/:nim — mahasiswa hanya NIM sendiri, admin semua NIM. */
router.get('/transkrip/:nim', (req, res) => {
  const role = req.auth.role;
  const nim = req.params.nim;

  if (role === 'mahasiswa') {
    const me = findUserById.get(req.auth.id);
    if (!me || String(me.nim) !== String(nim)) {
      return res.status(403).json({
        error: 'mahasiswa hanya boleh melihat transkrip NIM sendiri',
        reason: 'mahasiswa hanya boleh melihat transkrip NIM sendiri',
      });
    }
  } else if (role !== 'admin') {
    return res.status(403).json({ error: 'endpoint ini hanya untuk mahasiswa dan admin', reason: 'endpoint ini hanya untuk mahasiswa dan admin' });
  }

  const mahasiswa = findUserByNim.get(String(nim));
  if (!mahasiswa) {
    return res.status(404).json({ error: 'mahasiswa tidak ditemukan', reason: 'mahasiswa tidak ditemukan' });
  }

  const entries = listTranskrip.all(String(nim));
  return res.json({
    nim: mahasiswa.nim,
    nama: mahasiswa.nama,
    jumlah: entries.length,
    entries,
  });
});

/** POST /transkrip/sinkron — HANYA token service (token user ditolak). */
router.post('/transkrip/sinkron', (req, res) => {
  if (req.auth.role !== 'service') {
    return res.status(403).json({ error: 'endpoint ini hanya untuk service', reason: 'endpoint ini hanya untuk service' });
  }

  const kelas = resolveKelas((req.body || {}).kelas_id ?? (req.body || {}).kode);
  if (!kelas) {
    return res.status(404).json({ error: 'kelas tidak ditemukan', reason: 'kelas tidak ditemukan' });
  }
  if (kelas.status !== 'final') {
    return res.status(409).json({ error: 'kelas belum difinalisasi', reason: 'kelas belum difinalisasi' });
  }

  const rows = listNilaiKelas.all(kelas.id);
  const sync = db.transaction(() => {
    for (const row of rows) {
      upsertEntry.run(row.user_id, row.nim, row.kode, row.nama_mk, row.angka, row.huruf);
    }
    return rows.length;
  });

  const synced = sync();

  console.log(`[transkrip] sinkron ${kelas.kode}: ${synced} baris (oleh ${req.auth.id})`);
  return res.json({
    message: `transkrip kelas ${kelas.kode} tersinkron`,
    kode_kelas: kelas.kode,
    synced,
  });
});

module.exports = router;
