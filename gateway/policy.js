'use strict';

const { db } = require('../db/database');
const { resolveKelas } = require('../lib/kelas');

const findNilai = db.prepare(`
  SELECT n.id, n.kelas_id, n.user_id, k.kode, k.dosen_id, k.status
  FROM nilai n
  JOIN kelas k ON k.id = n.kelas_id
  WHERE n.id = ?
`);

const findUserNim = db.prepare('SELECT nim FROM users WHERE id = ?');

const DENY = (reason) => ({ allow: false, reason });

function decide(subject, method, path, _body = {}) {
  const role = subject?.role;
  const verb = method.toUpperCase();
  const route = `${verb} ${path}`;

  // ---------- GET /nilai ----------
  if (verb === 'GET' && path === '/nilai') {
    if (role === 'mahasiswa') {
      return { allow: true, reason: 'mahasiswa melihat nilai miliknya' };
    }
    if (role === 'dosen') {
      return { allow: true, reason: 'dosen melihat nilai kelas yang diampu' };
    }
    return DENY(`role ${role || 'unknown'} tidak diizinkan mengakses ${route}`);
  }

  // ---------- PUT /nilai/:id ----------
  const putNilai = path.match(/^\/nilai\/([^/]+)\/?$/);
  if (verb === 'PUT' && putNilai) {
    if (role !== 'dosen') return DENY('endpoint ini hanya untuk dosen');

    const nilai = findNilai.get(putNilai[1]);
    if (!nilai) return DENY('nilai tidak ditemukan');
    if (Number(nilai.dosen_id) !== Number(subject.id)) {
      return DENY('kelas bukan diampu dosen ini');
    }
    if (nilai.status === 'final') return DENY('kelas sudah difinalisasi');
    return { allow: true, reason: `dosen mengubah nilai kelas ${nilai.kode} yang diampu` };
  }

  // ---------- POST /kelas/:id/finalisasi ----------
  const finalisasi = path.match(/^\/kelas\/([^/]+)\/finalisasi\/?$/);
  if (verb === 'POST' && finalisasi) {
    if (role !== 'dosen') return DENY('endpoint ini hanya untuk dosen');

    const kelas = resolveKelas(finalisasi[1]);
    if (!kelas) return DENY('kelas tidak ditemukan');
    if (Number(kelas.dosen_id) !== Number(subject.id)) {
      return DENY('kelas bukan diampu dosen ini');
    }
    if (kelas.status === 'final') return DENY('kelas sudah difinalisasi');
    return { allow: true, reason: `dosen memfinalisasi kelas ${kelas.kode} yang diampu` };
  }

  // ---------- GET /transkrip/:nim ----------
  const getTranskrip = path.match(/^\/transkrip\/([^/]+)\/?$/);
  if (verb === 'GET' && getTranskrip) {
    if (role === 'admin') {
      return { allow: true, reason: 'admin melihat transkrip mahasiswa' };
    }
    if (role === 'mahasiswa') {
      const me = findUserNim.get(subject.id);
      if (!me || String(me.nim) !== String(getTranskrip[1])) {
        return DENY('mahasiswa hanya boleh melihat transkrip NIM sendiri');
      }
      return { allow: true, reason: 'mahasiswa melihat transkrip sendiri' };
    }
    return DENY('endpoint ini hanya untuk mahasiswa dan admin');
  }

  // ---------- POST /transkrip/sinkron ----------
  if (verb === 'POST' && path === '/transkrip/sinkron') {
    if (role !== 'service') return DENY('endpoint ini hanya untuk service');
    return { allow: true, reason: 'service melakukan sinkron transkrip' };
  }

  // ---------- Default deny ----------
  return DENY('endpoint tidak dikenali');
}

module.exports = { decide };
