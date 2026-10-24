# Sistem Nilai Zero Trust

Tugas Praktikum Individu — **Keamanan Informasi (KP70065004)**, Informatika Universitas Siliwangi.

Implementasi *zero trust* pada level aplikasi: satu **API Gateway (PEP)** di depan dua **service (Resource)**, dengan **Policy Engine**, verifikasi device, jam akses, audit log, dan token terpisah untuk service.

> *Never trust, always verify.* Setiap request — termasuk panggilan antar-service — diperiksa ulang.

---

## 1. Arsitektur

```
                     ┌───────────────────────────┐
  Client ───────────▶│  API Gateway :3000        │◀── policy.js (Policy Engine)
  (Postman / curl)   │  = PEP (+ PE / PA)        │
  Bearer + X-Device  │                           │───▶ audit_log (allow & deny)
                     └──────┬─────────────┬──────┘
               X-Gateway    │             │  X-Gateway-Secret
                 -Secret    ▼             ▼
                  ┌───────────────┐  ┌──────────────────┐
                  │ Service Nilai │  │ Service Transkrip│
                  │   :3001       │  │   :3002          │
                  └───────┬───────┘  └────────▲─────────┘
                          │ POST /transkrip/sinkron
                          │ (token service, LEWAT GATEWAY lagi)
                          └──────────▶ Gateway ────────┘
                                          │
                                    ┌─────▼──────┐
                                    │  SQLite    │ (satu DB bersama)
                                    └────────────┘
```

| Komponen | Port | Peran NIST SP 800-207 | Kode |
|---|---|---|---|
| API Gateway | 3000 (di repo ini `.env` memakai **3100**, lihat §3) | PEP | `gateway/server.js` |
| Policy Engine / PA | — | PE / PA | `gateway/policy.js`, `gateway/routes/auth.js` |
| Service Nilai | 3001 | Resource | `services/nilai/` |
| Service Transkrip | 3002 | Resource | `services/transkrip/` |
| Database | — | Resource | `db/schema.sql` (SQLite) |
| Audit Log | — | Data source | tabel `audit_log` |

---

## 2. Prasyarat

- Node.js **20+** (diuji pada Node 24)
- npm
- Tidak butuh database server (SQLite via `better-sqlite3`)

```bash
npm install
```

---

## 3. Menjalankan

```bash
cp .env.example .env     # sekali saja (file .env sudah disertakan untuk demo)
npm run seed             # isi data awal (idempoten: menghapus lalu mengisi ulang)
npm start                # gateway + service nilai + service transkrip sekaligus
```

Keluaran:

```
[start-all] gateway :3000, nilai :3001, transkrip :3002
[gateway] PEP berjalan di http://127.0.0.1:3000
[nilai] berjalan di http://127.0.0.1:3001
[transkrip] berjalan di http://127.0.0.1:3002
```

Cek cepat:

```bash
curl http://127.0.0.1:3000/health
```

### Catatan port

`.env` bawaan repo ini memakai **PORT_GATEWAY=3100** karena port 3000 di komputer pengembang sudah dipakai layanan lain (Docker/Dokploy) sehingga request ke `127.0.0.1:3000` dibelokkan ke container tersebut. Di komputer yang port 3000-nya bebas, cukup ubah:

```env
PORT_GATEWAY=3000
GATEWAY_URL=http://127.0.0.1:3000
```

Service tetap di 3001/3002 sesuai soal. Semua contoh di README memakai variabel berikut agar tidak perlu edit:

```bash
GW=http://127.0.0.1:3100     # sesuaikan dengan PORT_GATEWAY di .env
```

Menjalankan terpisah (tiga terminal):

```bash
npm run gateway
npm run nilai
npm run transkrip
```

---

## 4. Akun & Device (seed)

| Username / NIM | Role | Password | Device ID | Keterangan |
|---|---|---|---|---|
| `admin01` | admin | `Admin123!` | `DEV-ADMIN-01` | Melihat semua transkrip |
| `dosen01` | dosen | `Dosen123!` | `DEV-DOSEN-01` | Mengampu **IF-101-A** |
| `dosen02` | dosen | `Dosen123!` | `DEV-DOSEN-02` | Mengampu **IF-102-B** |
| `2024001` | mahasiswa | `Mhs123!` | `DEV-MHS-01` | Terdaftar IF-101-A |
| `2024002` | mahasiswa | `Mhs123!` | `DEV-MHS-02` | Terdaftar IF-101-A |
| `2024003` | mahasiswa | `Mhs123!` | `DEV-MHS-03` | Terdaftar IF-102-B |

Service client: `nilai-service` / lihat `SERVICE_CLIENT_SECRET` di `.env` (hex acak, di-hash bcrypt saat `npm run seed`).

Kelas: `IF-101-A` (Keamanan Informasi, dosen01), `IF-102-B` (Pemrograman Web, dosen02).

Nilai awal: 2024001 = 82/AB, 2024002 = 76/B (IF-101-A), 2024003 = 88/A (IF-102-B).
Password disimpan sebagai bcrypt hash; secret service juga di-hash.

---

## 5. Endpoint

| Method | Endpoint | Role | Kondisi tambahan |
|---|---|---|---|
| POST | `/auth/login` | publik | password valid + `X-Device-ID` terdaftar |
| POST | `/auth/refresh` | publik | refresh token ada, belum dicabut, belum kedaluwarsa |
| POST | `/auth/logout` | publik | mencabut refresh token (idempoten) |
| POST | `/auth/service` | publik | `client_id` + `client_secret` valid → token 5 menit, role `service` |
| GET | `/nilai` | mahasiswa, dosen | difilter kepemilikan (NIM sendiri / kelas yang diampu) |
| PUT | `/nilai/:id` | dosen | kelas diampu, `status='open'`, jam 07.00–21.00 |
| POST | `/kelas/:id/finalisasi` | dosen | kelas diampu, `status='open'`, jam 07.00–21.00 |
| GET | `/transkrip/:nim` | mahasiswa, admin | mahasiswa hanya NIM sendiri |
| POST | `/transkrip/sinkron` | service | token user ditolak |
| lainnya | — | — | **default deny** |

`:id` kelas menerima id numerik **atau** kode (`IF-101-A`).
Semua endpoint selain `/auth/*` wajib `Authorization: Bearer <access>` dan (untuk user) `X-Device-ID`.
Setiap keputusan allow/deny ditulis ke `audit_log`.

---

## 6. Alur penting

### 6.1 Login

```bash
curl -s -X POST $GW/auth/login \
  -H 'Content-Type: application/json' \
  -H 'X-Device-ID: DEV-DOSEN-01' \
  -d '{"username":"dosen01","password":"Dosen123!"}'
```

Access token 10 menit (`sub`, `role`, `nim`/`username`), refresh token 1 hari (disimpan sebagai SHA-256).

### 6.2 Dosen mengubah nilai → finalisasi → transkrip

```bash
# token
TOKEN=$(curl -s -X POST $GW/auth/login -H 'Content-Type: application/json' \
  -H 'X-Device-ID: DEV-DOSEN-01' \
  -d '{"username":"dosen01","password":"Dosen123!"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')

# ubah nilai (id 1 = nilai 2024001 di IF-101-A)
curl -s -X PUT $GW/nilai/1 -H "Authorization: Bearer $TOKEN" \
  -H 'X-Device-ID: DEV-DOSEN-01' -H 'Content-Type: application/json' -d '{"angka":95}'

# finalisasi (Service Nilai lalu ambil token service & panggil /transkrip/sinkron LEWAT gateway)
curl -s -X POST $GW/kelas/IF-101-A/finalisasi -H "Authorization: Bearer $TOKEN" \
  -H 'X-Device-ID: DEV-DOSEN-01'

# cek transkrip sebagai admin
ADMIN=$(curl -s -X POST $GW/auth/login -H 'Content-Type: application/json' \
  -H 'X-Device-ID: DEV-ADMIN-01' \
  -d '{"username":"admin01","password":"Admin123!"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
curl -s $GW/transkrip/2024001 -H "Authorization: Bearer $ADMIN" -H 'X-Device-ID: DEV-ADMIN-01'
```

### 6.3 Membuktikan service tidak bisa diakses langsung

```bash
curl -i http://127.0.0.1:3001/nilai
# 403 {"error":"akses langsung ke service ditolak"}

# walau membawa secret yang benar, token tetap wajib diverifikasi:
curl -i http://127.0.0.1:3001/nilai -H 'X-Gateway-Secret: <GATEWAY_SECRET>'
# 401 access token tidak ditemukan
```

### 6.4 Demo jam akses

Ubah `.env` sementara:

```env
JAM_MULAI=0
JAM_SELESAI=0      # rentang kosong → semua perubahan ditolak
```

Restart `npm start`, lalu `PUT /nilai/1` → `403 perubahan nilai hanya diizinkan pukul 00.00–00.00 (di luar jam akses)`.
Kembalikan ke `7` dan `21` setelah demo.

---

## 7. Pengujian

### Otomatis (satu perintah)

```bash
npm test
```

`tests/e2e.sh` menyalakan sistem dengan DB terpisah (`db/test-e2e.db`), lalu menguji **47 assertion**:

- login benar/salah, device salah, token invalid/kedaluwarsa
- token service, kredensial service salah
- kepemilikan nilai & transkrip, admin vs dosen vs mahasiswa
- ubah nilai, validasi angka, finalisasi, ubah setelah final, finalisasi ulang
- sinkron transkrip otomatis & manual, token user ditolak
- refresh, logout, refresh token lama ditolak
- akses langsung ke port service (tanpa secret, dengan secret tanpa token)
- jam akses di luar rentang (gateway kedua dengan `JAM_MULAI=0 JAM_SELESAI=0`)
- audit log: total baris, deny jam akses, keputusan token service

Contoh keluaran: `== Hasil: 47/47 lulus ==`.

### Postman / Bruno

Panduan langkah demi langkah (termasuk koleksi Bruno siap pakai dan alur untuk direkam): **[TUTORIAL-API.md](TUTORIAL-API.md)**.

### Postman (ringkas)

Import `tests/postman_collection.json`, jalankan folder **00 - Auth** lebih dulu (menyimpan token ke collection variable), lalu folder lain. `baseUrl` default `http://127.0.0.1:3100`.

### Manual (skenario 03-RULES §8)

| No | Aksi | Harapan |
|---|---|---|
| 1 | 2024001 `GET /nilai` + `DEV-MHS-01` | 200, hanya nilai 2024001 |
| 2 | 2024001 `GET /nilai` + `DEV-MHS-02` | 403 device tidak terdaftar |
| 3 | 2024001 `GET /transkrip/2024002` | 403 NIM sendiri |
| 4 | 2024001 `GET /transkrip/2024001` | 200 |
| 5 | dosen01 `PUT /nilai/3` (milik IF-102-B) | 403 bukan diampu |
| 6 | dosen01 `PUT /nilai/1` (sebelum final) | 200 |
| 7 | dosen01 `POST /kelas/IF-101-A/finalisasi` | 200, status final + transkrip tersinkron |
| 8 | dosen01 `PUT /nilai/1` setelah final | 403 sudah difinalisasi |
| 9 | Perubahan saat `.env` di luar jam | 403 di luar jam akses |
| 10 | admin01 `GET /transkrip/2024003` | 200 |
| 11 | dosen01 `POST /transkrip/sinkron` | 403 hanya untuk service |
| 12 | `curl :3001/nilai` tanpa secret | 403 akses langsung ditolak |
| 13 | `POST /auth/refresh` setelah logout | 401 sudah dicabut |
| 14 | Token kedaluwarsa | 401 kedaluwarsa |

---

## 8. Struktur folder

```
├── README.md
├── .env.example
├── package.json
├── docker-compose.yml
├── Dockerfile
├── lib/                      # konfigurasi, JWT, jam akses, helper kelas
│   ├── config.js
│   ├── tokens.js
│   ├── timeWindow.js
│   └── kelas.js
├── db/
│   ├── schema.sql
│   ├── seed.js
│   └── database.js
├── gateway/
│   ├── server.js             # PEP + proxy
│   ├── policy.js             # Policy Engine: allow/deny + alasan
│   ├── middleware/{authenticate,deviceCheck,timeWindow,audit}.js
│   └── routes/auth.js
├── services/
│   ├── nilai/
│   │   ├── server.js
│   │   ├── lib/gatewayClient.js   # ambil token service + sinkron via gateway
│   │   ├── middleware/{gatewaySecret,verifyToken}.js
│   │   └── routes/nilai.js
│   └── transkrip/
│       ├── server.js
│       ├── middleware/{gatewaySecret,verifyToken}.js
│       └── routes/transkrip.js
├── scripts/start-all.js
├── tests/
│   ├── e2e.sh
│   └── postman_collection.json
└── docs/                     # PRD, arsitektur, rules, schema
```

---

## 9. Keputusan desain & kontrol keamanan

| Kontrol | Implementasi |
|---|---|
| Never trust | Gateway memeriksa setiap request; service **memverifikasi ulang** JWT (`services/*/middleware/verifyToken.js`) |
| Assume breach | Service menolak tanpa `X-Gateway-Secret`; service bind ke `127.0.0.1` |
| Least privilege | Policy matrix per endpoint + token service hanya untuk `POST /transkrip/sinkron` |
| Kepemilikan data | `policy.js` membaca DB (`kelas.dosen_id`, `users.nim`, `kelas.status`) — bukan dari token/body |
| Token | Access 10 menit, service 5 menit, refresh 1 hari dengan hash SHA-256 + `revoked_at` |
| Kredensial | bcrypt (cost 10) untuk password dan client secret |
| Konteks | `X-Device-ID` dicek ke tabel `devices`; jam akses 07.00–21.00 (TZ Asia/Jakarta, dari `.env`) |
| Audit | Satu baris per keputusan (`allow`/`deny`) berisi subjek, endpoint, device, alasan, IP |
| Anti-spoof | `X-Gateway-Secret` dari client selalu **ditimpa** gateway saat proxy |

Catatan: JWT memakai HS256 dengan secret bersama agar sederhana untuk satu komputer. Untuk produksi: RS256 (public key di service), rotasi refresh token, rate limiting login, dan TLS di depan gateway.

---

## 10. Troubleshooting

| Gejala | Penyebab / solusi |
|---|---|
| `curl $GW` mengembalikan HTML/404 aneh | Port bentrok (mis. Docker memakai 3000). Set `PORT_GATEWAY` + `GATEWAY_URL` ke port bebas |
| `EADDRINUSE` | Ada proses lain di port tersebut: `ss -ltnp | grep :3000` |
| `401 access token kedaluwarsa` | Access token hanya 10 menit — login/refresh ulang |
| Data ingin direset | `npm run seed` |
| Sinkron transkrip gagal | Cek log `[nilai]`/`[transkrip]`; pastikan gateway hidup dan `SERVICE_CLIENT_SECRET` sama dengan seed |
| `403 akses langsung ke service ditolak` | Memang benar: akses harus lewat gateway |

---

## 11. Docker (opsional)

```bash
docker compose up --build -d
# gateway: http://127.0.0.1:3000 (ubah HOST_GATEWAY_PORT bila bentrok)
docker compose logs -f gateway
```

Satu container menjalankan gateway + dua service (sesuai "satu komputer"), DB di volume `zts-db`.
