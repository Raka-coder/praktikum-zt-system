'use strict';

const express = require('express');
const { db } = require('../../../db/database');
const { resolveKelas } = require('../../../lib/kelas');
const { withinWindow, REASON: JAM_REASON } = require('../../../lib/timeWindow');
const { sinkronTranskrip } = require('../lib/gatewayClient');

const router = express.Router();

const listNilaiMahasiswa = db.prepare(`
  SELECT n.id AS nilai_id, n.kelas_id, k.kode AS kode_kelas, k.nama_mk, k.status,
         u.nim, u.nama, n.angka, n.huruf, n.updated_at
  FROM nilai n
  JOIN kelas k ON k.id = n.kelas_id
  JOIN users u ON u.id = n.user_id
  WHERE n.user_id = ?
  ORDER BY k.kode
`);

const listNilaiDosen = db.prepare(`
  SELECT n.id AS nilai_id, n.kelas_id, k.kode AS kode_kelas, k.nama_mk, k.status,
         u.nim, u.nama, n.angka, n.huruf, n.updated_at
  FROM nilai n
  JOIN kelas k ON k.id = n.kelas_id
  JOIN users u ON u.id = n.user_id
  WHERE k.dosen_id = ?
  ORDER BY k.kode, u.nim
`);

const findNilaiDetail = db.prepare(`
  SELECT n.id, n.kelas_id, n.user_id, n.angka, n.huruf,
         k.kode, k.dosen_id, k.status
  FROM nilai n
  JOIN kelas k ON k.id = n.kelas_id
  WHERE n.id = ?
`);

const updateNilai = db.prepare(`
  UPDATE nilai SET angka = ?, huruf = ?, updated_at = datetime('now') WHERE id = ?
`);

const updateKelasFinal = db.prepare(`
  UPDATE kelas SET status = 'final' WHERE id = ? AND status = 'open'
`);

const VALID_HURUF = new Set(['A', 'AB', 'B', 'BC', 'C', 'CD', 'D', 'E']);

function angkaKeHuruf(angka) {
  if (angka === null || angka === undefined) return null;
  if (angka >= 85) return 'A';
  if (angka >= 80) return 'AB';
  if (angka >= 70) return 'B';
  if (angka >= 65) return 'BC';
  if (angka >= 60) return 'C';
  if (angka >= 55) return 'CD';
  if (angka >= 45) return 'D';
  return 'E';
}

/** GET /nilai — data selalu difilter kepemilikan (defense in depth, bukan hanya gateway). */
router.get('/nilai', (req, res) => {
  const role = req.auth.role;

  if (role === 'mahasiswa') {
    const rows = listNilaiMahasiswa.all(req.auth.id);
    return res.json({ role, jumlah: rows.length, data: rows });
  }

  if (role === 'dosen') {
    const rows = listNilaiDosen.all(req.auth.id);
    return res.json({ role, jumlah: rows.length, data: rows });
  }

  return res.status(403).json({ error: 'role tidak diizinkan', reason: 'role tidak diizinkan' });
});

/** PUT /nilai/:id — dosen pemilik kelas, kelas belum final, dalam jam akses. */
router.put('/nilai/:id', (req, res) => {
  if (req.auth.role !== 'dosen') {
    return res.status(403).json({ error: 'endpoint ini hanya untuk dosen', reason: 'endpoint ini hanya untuk dosen' });
  }
  if (!withinWindow()) {
    return res.status(403).json({ error: JAM_REASON, reason: JAM_REASON });
  }

  const nilai = findNilaiDetail.get(req.params.id);
  if (!nilai) return res.status(404).json({ error: 'nilai tidak ditemukan', reason: 'nilai tidak ditemukan' });
  if (Number(nilai.dosen_id) !== Number(req.auth.id)) {
    return res.status(403).json({ error: 'kelas bukan diampu dosen ini', reason: 'kelas bukan diampu dosen ini' });
  }
  if (nilai.status === 'final') {
    return res.status(403).json({ error: 'kelas sudah difinalisasi', reason: 'kelas sudah difinalisasi' });
  }

  const body = req.body || {};
  let angka = nilai.angka;
  let huruf = nilai.huruf;

  if ('angka' in body) {
    if (body.angka === null) {
      angka = null;
      huruf = null;
    } else {
      const parsed = Number(body.angka);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        return res.status(400).json({ error: 'angka harus 0–100', reason: 'angka harus 0–100' });
      }
      angka = parsed;
      huruf = 'huruf' in body ? body.huruf : angkaKeHuruf(parsed);
    }
  } else if ('huruf' in body) {
    huruf = body.huruf;
  } else {
    return res.status(400).json({ error: 'tidak ada perubahan (angka/huruf)', reason: 'tidak ada perubahan' });
  }

  if (huruf !== null && !VALID_HURUF.has(String(huruf))) {
    return res.status(400).json({ error: 'huruf tidak valid', reason: 'huruf tidak valid' });
  }

  updateNilai.run(angka, huruf, nilai.id);

  const updated = findNilaiDetail.get(nilai.id);
  return res.json({
    message: `nilai kelas ${nilai.kode} diperbarui`,
    data: {
      nilai_id: updated.id,
      kelas_id: updated.kelas_id,
      kode_kelas: updated.kode,
      angka: updated.angka,
      huruf: updated.huruf,
    },
  });
});

/** POST /kelas/:id/finalisasi — set final lalu sinkron transkrip lewat gateway. */
router.post('/kelas/:id/finalisasi', async (req, res) => {
  if (req.auth.role !== 'dosen') {
    return res.status(403).json({ error: 'endpoint ini hanya untuk dosen', reason: 'endpoint ini hanya untuk dosen' });
  }
  if (!withinWindow()) {
    return res.status(403).json({ error: JAM_REASON, reason: JAM_REASON });
  }

  const kelas = resolveKelas(req.params.id);
  if (!kelas) return res.status(404).json({ error: 'kelas tidak ditemukan', reason: 'kelas tidak ditemukan' });
  if (Number(kelas.dosen_id) !== Number(req.auth.id)) {
    return res.status(403).json({ error: 'kelas bukan diampu dosen ini', reason: 'kelas bukan diampu dosen ini' });
  }
  if (kelas.status === 'final') {
    return res.status(403).json({ error: 'kelas sudah difinalisasi', reason: 'kelas sudah difinalisasi' });
  }

  updateKelasFinal.run(kelas.id);

  // Panggilan antar-service tetap lewat gateway (token service, role service).
  let sinkron = { ok: false, stage: 'belum dijalankan' };
  try {
    sinkron = await sinkronTranskrip(kelas.id);
  } catch (err) {
    console.error('[nilai] sinkron transkrip gagal:', err.message);
    sinkron = { ok: false, stage: 'exception', error: err.message };
  }

  if (!sinkron.ok) {
    console.error('[nilai] sinkron transkrip tidak berhasil:', JSON.stringify(sinkron));
  }

  return res.json({
    message: `kelas ${kelas.kode} difinalisasi`,
    kelas: { id: kelas.id, kode: kelas.kode, status: 'final' },
    sinkron: {
      ok: sinkron.ok,
      status: sinkron.status ?? null,
      stage: sinkron.stage,
      detail: sinkron.body ?? null,
    },
  });
});

module.exports = router;
