'use strict';

/**
 * Seed data awal (idempoten: tabel dibersihkan lalu diisi ulang).
 * Jalankan: npm run seed
 */

const bcrypt = require('bcryptjs');
const config = require('../lib/config');
const { db, DB_PATH } = require('./database');

const COST = 10;

/** Jangan cetak secret penuh ke terminal — berguna saat demo direkam. */
function mask(value) {
  const text = String(value ?? '');
  if (text.length <= 12) return '***';
  return `${text.slice(0, 8)}…${text.slice(-4)}`;
}

const users = [
  { username: 'admin01', nim: null, nama: 'Admin Akademik', role: 'admin', password: 'Admin123!' },
  { username: 'dosen01', nim: null, nama: 'Dr. Rina Kartika', role: 'dosen', password: 'Dosen123!' },
  { username: 'dosen02', nim: null, nama: 'Budi Santoso, M.Kom.', role: 'dosen', password: 'Dosen123!' },
  { username: null, nim: '2024001', nama: 'Raka Restu', role: 'mahasiswa', password: 'Mhs123!' },
  { username: null, nim: '2024002', nama: 'Siti Aminah', role: 'mahasiswa', password: 'Mhs123!' },
  { username: null, nim: '2024003', nama: 'Dewi Lestari', role: 'mahasiswa', password: 'Mhs123!' },
];

const devices = [
  { owner: 'admin01', device_id: 'DEV-ADMIN-01', label: 'Laptop Admin' },
  { owner: 'dosen01', device_id: 'DEV-DOSEN-01', label: 'Laptop Rina' },
  { owner: 'dosen02', device_id: 'DEV-DOSEN-02', label: 'Laptop Budi' },
  { owner: '2024001', device_id: 'DEV-MHS-01', label: 'HP Raka' },
  { owner: '2024002', device_id: 'DEV-MHS-02', label: 'Laptop Siti' },
  { owner: '2024003', device_id: 'DEV-MHS-03', label: 'HP Dewi' },
];

const classes = [
  { kode: 'IF-101-A', nama_mk: 'Keamanan Informasi', dosen: 'dosen01' },
  { kode: 'IF-102-B', nama_mk: 'Pemrograman Web', dosen: 'dosen02' },
];

const enrollment = [
  { kode: 'IF-101-A', nim: '2024001' },
  { kode: 'IF-101-A', nim: '2024002' },
  { kode: 'IF-102-B', nim: '2024003' },
];

const grades = [
  { kode: 'IF-101-A', nim: '2024001', angka: 82, huruf: 'AB' },
  { kode: 'IF-101-A', nim: '2024002', angka: 76, huruf: 'B' },
  { kode: 'IF-102-B', nim: '2024003', angka: 88, huruf: 'A' },
];

const seed = db.transaction(() => {
  db.exec(`
    DELETE FROM transkrip_entry;
    DELETE FROM audit_log;
    DELETE FROM nilai;
    DELETE FROM kelas_mahasiswa;
    DELETE FROM kelas;
    DELETE FROM refresh_token;
    DELETE FROM devices;
    DELETE FROM clients;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);

  const insertUser = db.prepare(`
    INSERT INTO users (username, nim, nama, role, password_hash)
    VALUES (@username, @nim, @nama, @role, @password_hash)
  `);
  const insertDevice = db.prepare(`
    INSERT INTO devices (user_id, device_id, label) VALUES (?, ?, ?)
  `);
  const insertClient = db.prepare(`
    INSERT INTO clients (client_id, secret_hash, service_name) VALUES (?, ?, ?)
  `);
  const insertKelas = db.prepare(`
    INSERT INTO kelas (kode, nama_mk, dosen_id, status) VALUES (?, ?, ?, 'open')
  `);
  const insertEnroll = db.prepare(`
    INSERT INTO kelas_mahasiswa (kelas_id, user_id) VALUES (?, ?)
  `);
  const insertNilai = db.prepare(`
    INSERT INTO nilai (kelas_id, user_id, angka, huruf, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);

  const idByLabel = new Map();
  for (const u of users) {
    const info = insertUser.run({ ...u, password_hash: bcrypt.hashSync(u.password, COST) });
    idByLabel.set(u.username || u.nim, Number(info.lastInsertRowid));
  }

  for (const d of devices) {
    insertDevice.run(idByLabel.get(d.owner), d.device_id, d.label);
  }

  for (const c of classes) {
    const info = insertKelas.run(c.kode, c.nama_mk, idByLabel.get(c.dosen));
    idByLabel.set(`kelas:${c.kode}`, Number(info.lastInsertRowid));
  }

  for (const e of enrollment) {
    insertEnroll.run(idByLabel.get(`kelas:${e.kode}`), idByLabel.get(e.nim));
  }

  for (const g of grades) {
    insertNilai.run(idByLabel.get(`kelas:${g.kode}`), idByLabel.get(g.nim), g.angka, g.huruf);
  }

  // Kredensial Service Nilai untuk POST /auth/service (secret disimpan sebagai hash bcrypt)
  insertClient.run(
    config.SERVICE_CLIENT_ID,
    bcrypt.hashSync(config.SERVICE_CLIENT_SECRET, COST),
    'service-nilai',
  );
});

seed();

const counts = {
  users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
  devices: db.prepare('SELECT COUNT(*) AS n FROM devices').get().n,
  kelas: db.prepare('SELECT COUNT(*) AS n FROM kelas').get().n,
  nilai: db.prepare('SELECT COUNT(*) AS n FROM nilai').get().n,
  clients: db.prepare('SELECT COUNT(*) AS n FROM clients').get().n,
};

console.log(`\nSeed selesai → ${DB_PATH}`);
console.log(counts);

console.log(`
Akun demo (password | device ID):
  admin01  | Admin123! | DEV-ADMIN-01  (admin)
  dosen01  | Dosen123! | DEV-DOSEN-01  (dosen, mengampu IF-101-A)
  dosen02  | Dosen123! | DEV-DOSEN-02  (dosen, mengampu IF-102-B)
  2024001  | Mhs123!   | DEV-MHS-01    (mahasiswa, IF-101-A)
  2024002  | Mhs123!   | DEV-MHS-02    (mahasiswa, IF-101-A)
  2024003  | Mhs123!   | DEV-MHS-03    (mahasiswa, IF-102-B)

Service client: ${config.SERVICE_CLIENT_ID} / ${mask(config.SERVICE_CLIENT_SECRET)}  (nilai lengkap ada di .env)
Kelas         : IF-101-A (dosen01), IF-102-B (dosen02)
`);
