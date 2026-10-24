'use strict';

/** Helper bersama: resolusi kelas berdasarkan id numerik atau kode (IF-101-A). */

const { db } = require('../db/database');

const findKelasById = db.prepare('SELECT id, kode, nama_mk, dosen_id, status FROM kelas WHERE id = ?');
const findKelasByKode = db.prepare('SELECT id, kode, nama_mk, dosen_id, status FROM kelas WHERE kode = ?');

function resolveKelas(idOrKode) {
  if (idOrKode === undefined || idOrKode === null) return null;
  const raw = String(idOrKode);
  if (/^\d+$/.test(raw)) {
    return findKelasById.get(Number(raw)) || findKelasByKode.get(raw) || null;
  }
  return findKelasByKode.get(raw) || null;
}

module.exports = { resolveKelas, findKelasById, findKelasByKode };
