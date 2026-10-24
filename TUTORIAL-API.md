# Tutorial Uji Manual API — Sistem Nilai Zero Trust

Panduan lengkap menguji API memakai **Postman** atau **Bruno**, termasuk skenario
untuk direkam. Semua contoh memakai konfigurasi repo ini (gateway **3100**).

> Sebelum mulai: baca `README.md` §1–§3 untuk gambaran arsitektur.
> Ringkasnya: **Client → Gateway (PEP) → Service Nilai / Transkrip → SQLite**.

---

## 0. Apa yang dibuktikan tiap langkah

| # | Aksi | Yang dibuktikan |
|---|---|---|
| 1 | Login + `X-Device-ID` | Autentikasi & device binding (FR-AUTH-01/02/03) |
| 2 | Akses tanpa token | Setiap request diverifikasi ulang |
| 3 | Device salah / tidak ada | Konteks device diperiksa, bukan hanya identitas |
| 4 | Dosen ubah nilai kelas lain | Policy Engine cek kepemilikan dari DB |
| 5 | Finalisasi | Least privilege + status kelas |
| 6 | Ubah nilai setelah final | Integritas data (kelas final terkunci) |
| 7 | Mahasiswa lihat transkrip NIM lain | Otorisasi per-resource |
| 8 | Token user panggil `/transkrip/sinkron` | Pemisahan role service vs user |
| 9 | Akses langsung `:3001` / `:3002` | Service tidak percaya pada jaringan |
| 10 | `npm run audit` | Setiap allow/deny tercatat (FR-AUD-01) |

---

## 1. Persiapan (sekali saja)

```bash
cd /home/rakarestu/Documents/praktikum-zts
npm install          # kalau node_modules belum ada
npm run seed         # reset + isi data demo
npm start            # gateway:3100, nilai:3001, transkrip:3002
```

Cek sistem hidup (terminal lain):

```bash
curl -s http://127.0.0.1:3100/health
# {"status":"ok","service":"gateway"}
```

Catatan penting:

- **Port 3000 di mesin ini dipakai Docker/Dokploy.** `.env` memakai `PORT_GATEWAY=3100`.
  Jangan ganti hanya satu variabel: `GATEWAY_URL` juga harus ikut.
- `npm run seed` **menghapus semua data** (termasuk audit log) lalu mengisi ulang.
  Jalankan setiap kali ingin demo dari kondisi bersih.
- Secret ada di `.env` (`JWT_SECRET`, `GATEWAY_SECRET`, `SERVICE_CLIENT_SECRET`).
  **Jangan tampilkan isinya saat rekaman** — cukup tunjukkan nama variabelnya.
- Setelah mengubah `SERVICE_CLIENT_SECRET`/`SERVICE_CLIENT_ID` di `.env`, **wajib**
  `npm run seed` karena nilai itu disimpan sebagai hash bcrypt di tabel `clients`.
- Access token berlaku **10 menit** (`ACCESS_TOKEN_TTL=10m`). Kalau 401
  `access token kedaluwarsa`, login ulang.

---

## 2. Bahan uji

### Akun & device

| Login | Password | Role | Device (`X-Device-ID`) |
|---|---|---|---|
| `dosen01` | `Dosen123!` | dosen (IF-101-A) | `DEV-DOSEN-01` |
| `dosen02` | `Dosen123!` | dosen (IF-102-B) | `DEV-DOSEN-02` |
| `2024001` | `Mhs123!` | mahasiswa | `DEV-MHS-01` |
| `2024003` | `Mhs123!` | mahasiswa | `DEV-MHS-03` |
| `admin01` | `Admin123!` | admin | `DEV-ADMIN-01` |

### ID yang dipakai di URL/body

| Data | Nilai | Keterangan |
|---|---|---|
| `nilaiIdOwn` | `1` | nilai 2024001 di IF-101-A (milik dosen01) |
| `nilaiIdOther` | `3` | nilai 2024003 di IF-102-B (milik dosen02) |
| `kelasKode` | `IF-101-A` | bisa juga pakai id `1` |
| `nimSelf` | `2024001` | |
| `nimOther` | `2024003` | |
| service client | `nilai-service` | secret: lihat `.env` → `SERVICE_CLIENT_SECRET` |

Nilai awal: 2024001 = **82/AB**, 2024002 = **76/B**, 2024003 = **88/A**.

---

## 3. Postman

### 3.1 Import koleksi

1. Postman → **Import** → **File** → pilih `tests/postman_collection.json`.
2. Setelah import, buka koleksi **Sistem Nilai Zero Trust** → tab **Variables**.
3. Pastikan:
   - `baseUrl` = `http://127.0.0.1:3100`
   - `nilaiServiceUrl` = `http://127.0.0.1:3001`
   - `transkripServiceUrl` = `http://127.0.0.1:3002`
   - `serviceClientSecret` = nilai `SERVICE_CLIENT_SECRET` di `.env`
     (sudah diisi; ganti jika kamu merotasi secret).

### 3.2 Urutan menjalankan

Jalankan folder **00 - Auth** lebih dulu. Request login punya *test script*
`pm.collectionVariables.set(...)` yang menyimpan `access_token`/`refresh_token`
ke collection variable, sehingga request lain tinggal memakai `{{dosenToken}}`
dan sejenisnya.

| Folder | Request | Harapan |
|---|---|---|
| 00 - Auth | Login dosen01 (device valid) | 200, token tersimpan |
| | Login mahasiswa 2024001 | 200 |
| | Login admin01 | 200 |
| | Login dosen02 | 200 |
| | Login device tidak terdaftar | 403 `device tidak terdaftar untuk user ini` |
| | Token service | 200, role `service` |
| | Refresh token | 200 |
| | Logout | 200 |
| | Refresh setelah logout | 401 `refresh token sudah dicabut` |
| 01 - Nilai | GET /nilai tanpa token | 401 `access token tidak ditemukan` |
| | Mahasiswa GET /nilai | 200, semua baris `nim = 2024001` |
| | Mahasiswa GET /nilai device salah | 403 `device tidak terdaftar...` |
| | Dosen GET /nilai | 200, hanya kelas diampu |
| | Dosen ubah nilai kelas lain | 403 `kelas bukan diampu dosen ini` |
| | Dosen ubah nilai kelas diampu | 200, huruf otomatis |
| | Finalisasi kelas IF-101-A | 200, `sinkron.ok = true` |
| | Ubah nilai setelah finalisasi | 403 `kelas sudah difinalisasi` |
| 02 - Transkrip | Mahasiswa akses NIM sendiri | 200 |
| | Mahasiswa akses NIM lain | 403 |
| | Admin akses transkrip | 200 |
| | Token user panggil sinkron | 403 `endpoint ini hanya untuk service` |
| | Token service panggil sinkron | 200 |
| 03 - Akses langsung | GET `:3001/nilai` tanpa secret | 403 `akses langsung ke service ditolak` |
| | POST `:3002/transkrip/sinkron` tanpa secret | 403 `akses langsung ke service ditolak` |

> Jalankan folder berurutan. Folder 01 mengubah nilai 1 → 90 dan memfinalisasi
> IF-101-A; kalau diulang tanpa `npm run seed`, request finalisasi akan 403
> `kelas sudah difinalisasi` (itu perilaku benar, bukan bug).

### 3.3 Membuat request dari nol (bagus untuk rekaman)

**A. Login dosen**

- Method/URL: `POST http://127.0.0.1:3100/auth/login`
- Headers:
  - `Content-Type: application/json`
  - `X-Device-ID: DEV-DOSEN-01`
- Body → raw → JSON:

```json
{ "username": "dosen01", "password": "Dosen123!" }
```

- Response 200:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "3f1c...",
  "token_type": "Bearer",
  "expires_in": "10m",
  "refresh_expires_in_days": 1,
  "user": { "id": 2, "username": "dosen01", "nim": null, "nama": "Dosen Satu", "role": "dosen" }
}
```

Salin `access_token`.

**B. Panggil endpoint terproteksi**

- `GET http://127.0.0.1:3100/nilai`
- Headers: `Authorization: Bearer <access_token>`, `X-Device-ID: DEV-DOSEN-01`

**C. Ubah nilai (dosen01, kelas sendiri)**

- `PUT http://127.0.0.1:3100/nilai/1`
- Headers sama seperti B + `Content-Type: application/json`
- Body:

```json
{ "angka": 90 }
```

Response 200:

```json
{
  "message": "nilai kelas IF-101-A diperbarui",
  "data": { "nilai_id": 1, "kelas_id": 1, "kode_kelas": "IF-101-A", "angka": 90, "huruf": "A" }
}
```

**D. Finalisasi + sinkron**

- `POST http://127.0.0.1:3100/kelas/IF-101-A/finalisasi`
- Headers: `Authorization` + `X-Device-ID: DEV-DOSEN-01`, tanpa body.

Response 200 (perhatikan `sinkron.ok`):

```json
{
  "message": "kelas IF-101-A difinalisasi",
  "kelas": { "id": 1, "kode": "IF-101-A", "status": "final" },
  "sinkron": { "ok": true, "status": 200, "stage": "selesai", "detail": { "synced": 2 } }
}
```

**E. Akses langsung service (harus gagal)**

```bash
curl -s http://127.0.0.1:3001/nilai
# {"error":"akses langsung ke service ditolak","reason":"akses langsung ke service ditolak"}
```

**F. Token service + sinkron (role service)**

- `POST http://127.0.0.1:3100/auth/service`
- Body:

```json
{ "client_id": "nilai-service", "client_secret": "<SERVICE_CLIENT_SECRET dari .env>" }
```

- Lalu `POST http://127.0.0.1:3100/transkrip/sinkron`
  dengan `Authorization: Bearer <token_service>`, body `{ "kode": "IF-101-A" }`.
  **Tanpa** `X-Device-ID` (token service tidak punya device).
- Response 200: `{ "message": "...", "kode_kelas": "IF-101-A", "synced": 2 }`

### 3.4 Kesalahan umum di Postman

| Gejala | Sebab | Solusi |
|---|---|---|
| 401 `access token tidak ditemukan` | Header Authorization kosong/tab Auth tidak dipakai | Isi `Authorization: Bearer {{token}}` |
| 403 `header X-Device-ID wajib diisi` | Lupa header device | Tambah `X-Device-ID` sesuai tabel |
| 400 body kosong / JSON invalid | Body bukan raw JSON | Body → raw → JSON |
| 403 padahal baru login | Token kedaluwarsa (10 menit) | Login ulang |
| 403 `kelas sudah difinalisasi` | Data sisa percobaan sebelumnya | `npm run seed`, lalu ulangi |
| 401 `client credential tidak valid` | Secret di collection ≠ `.env` | Samakan `serviceClientSecret`, atau reseed setelah ganti secret |

---

## 4. Bruno

Koleksi Bruno siap pakai ada di **`tests/bruno/`** (16 request, folder sama
dengan Postman).

### 4.1 Buka koleksi

1. Install Bruno (<https://www.usebruno.com/download>) — GUI/desktop.
2. **Open Collection** → pilih folder `tests/bruno`.
3. Di kanan atas pilih environment **Local** (berisi `baseUrl` 3100, ID, dan
   `serviceClientSecret`).
4. Jalankan request dari atas ke bawah: **00 - Auth** dulu (4 request), lalu
   **01 - Nilai**, **02 - Transkrip**, **03 - Akses langsung**.

### 4.2 Bagaimana token disimpan

Setiap request login punya blok:

```bru
script:post-response {
  bru.setVar("dosenToken", res.body.access_token);
  bru.setVar("dosenRefresh", res.body.refresh_token);
}
```

Request lain memakai `auth: bearer` dengan `token: {{dosenToken}}`, dan header
`X-Device-ID` diisi manual. Assertion ada di blok `tests`:

```bru
tests {
  test("status 403", function () {
    expect(res.getStatus()).to.equal(403);
  });
}
```

### 4.3 Jalankan lewat CLI (opsional, untuk bukti otomatis)

```bash
npx @usebruno/cli run tests/bruno -e Local
```

Semua assertion harus lulus. Ini alternatif ringan tanpa membuka GUI.

### 4.4 Kalau lebih suka import dari Postman

Bruno → **Import Collection** → **Postman Collection** → pilih
`tests/postman_collection.json`. Variable `serviceClientSecret` tetap perlu
disamakan dengan `.env`.

---

## 5. Skenario uji lengkap (untuk laporan/rekaman)

Jalankan dari kondisi bersih (`npm run seed`).

| # | Request | Expected | Kontrol yang terbukti |
|---|---|---|---|
| 1 | Login dosen01, device `DEV-DOSEN-01` | 200 + token | Autentikasi + device |
| 2 | Login dosen01, device `DEV-MHS-01` | 403 device | Device binding |
| 3 | Login password salah | 401 `kredensial tidak valid` | Anti user-enumeration |
| 4 | GET `/nilai` tanpa token | 401 | Verifikasi tiap request |
| 5 | GET `/nilai` (mahasiswa) | 200, hanya NIM sendiri | Otorisasi data |
| 6 | GET `/nilai` device salah | 403 | Konteks device |
| 7 | PUT `/nilai/3` oleh dosen01 | 403 `kelas bukan diampu dosen ini` | Policy dari DB |
| 8 | PUT `/nilai/1` oleh dosen01, `{"angka":90}` | 200, `huruf:"A"` | Least privilege |
| 9 | PUT `/nilai/1` setelah finalisasi | 403 `kelas sudah difinalisasi` | Integritas |
| 10 | POST `/kelas/IF-101-A/finalisasi` | 200, `sinkron.ok=true` | Orkestrasi antar-service |
| 11 | GET `/transkrip/2024001` (mahasiswa) | 200, ada entri | Sinkron berhasil |
| 12 | GET `/transkrip/2024003` (mahasiswa) | 403 NIM sendiri | Otorisasi per-resource |
| 13 | GET `/transkrip/2024001` (admin) | 200 | Role admin |
| 14 | POST `/transkrip/sinkron` token dosen | 403 hanya service | Pemisahan role |
| 15 | POST `/transkrip/sinkron` token service | 200 | Service identity |
| 16 | GET `:3001/nilai` langsung | 403 akses langsung | Service tidak percaya jaringan |
| 17 | GET `:3001/nilai` + secret, tanpa token | 401 | Verifikasi ganda |
| 18 | Refresh setelah logout | 401 `sudah dicabut` | Revocation |
| 19 | `npm run audit` | baris allow & deny | Auditability |

### Bukti verifikasi ganda (no. 17)

```bash
GW=$(grep '^GATEWAY_SECRET=' .env | cut -d= -f2-)
curl -s -H "X-Gateway-Secret: $GW" http://127.0.0.1:3001/nilai
# {"error":"access token tidak ditemukan", ...}
```

Artinya: punya secret gateway saja tidak cukup — service tetap menuntut JWT.

---

## 6. Demo jam akses (tanpa menunggu malam)

Kontrol jam hanya berlaku untuk `PUT /nilai/:id` dan `POST /kelas/:id/finalisasi`.

1. Ubah `.env`:

```env
JAM_MULAI=0
JAM_SELESAI=0
```

2. Hentikan (`Ctrl-C`) lalu `npm start` lagi — **ketiga proses**.
3. Login dosen01 → `PUT /nilai/1 {"angka":85}`.
4. Expected 403:

```json
{
  "error": "perubahan nilai hanya diizinkan pukul 07.00–21.00 (di luar jam akses)",
  "decision": "deny",
  "reason": "perubahan nilai hanya diizinkan pukul 07.00–21.00 (di luar jam akses)"
}
```

5. Kembalikan `.env` ke `JAM_MULAI=7`, `JAM_SELESAI=21`, restart.

Zona waktu mengikuti `TZ=Asia/Jakarta`. Jam 21.00 tepat sudah ditolak
(rentang `07.00 ≤ t < 21.00`).

---

## 7. Melihat audit log

```bash
npm run audit          # 15 baris terakhir
npm run audit -- 50    # 50 baris
npm run audit -- deny  # hanya penolakan
```

Contoh keluaran:

```
┌────┬─────────────────────┬─────────┬───────┬──────────────────────────┬────────────────┬─────────┬─────────────────────────┐
│ id │ waktu               │ subjek  │ role  │ aksi                     │ device         │ putusan │ alasan                  │
├────┼─────────────────────┼─────────┼───────┼──────────────────────────┼────────────────┼─────────┼─────────────────────────┤
│ 12 │ 2026-10-24 10:15:02 │ 2024001 │ mhs   │ GET /transkrip/2024003   │ DEV-MHS-01     │ deny    │ mahasiswa hanya ...     │
│ 13 │ 2026-10-24 10:15:10 │ dosen01 │ dosen │ PUT /nilai/1             │ DEV-DOSEN-01   │ allow   │ dosen mengubah nilai... │
└────┴─────────────────────┴─────────┴───────┴──────────────────────────┴────────────────┴─────────┴─────────────────────────┘
```

Query manual (opsional):

```bash
node -e "const D=require('better-sqlite3');const db=new D('./db/sistem_nilai.db',{readonly:true});console.table(db.prepare(\"SELECT ts,role,method,endpoint,decision,reason FROM audit_log ORDER BY id DESC LIMIT 5\").all())"
```

Catatan bentuk respons:

- Ditahan **gateway** → `{ "error", "decision": "deny", "reason" }`
- Ditolak **service** (mis. akses langsung / 409 kelas belum final) → `{ "error", "reason" }`

---

## 8. Reset data & rotasi secret

| Aksi | Perintah | Dampak |
|---|---|---|
| Reset data demo | `npm run seed` | Semua tabel diisi ulang; refresh token lama hilang |
| Ganti `JWT_SECRET` | edit `.env` → restart | Access token lama invalid; refresh token lama masih valid sampai expired |
| Ganti `GATEWAY_SECRET` | edit `.env` → restart **semua** proses | Tidak perlu reseed |
| Ganti `SERVICE_CLIENT_ID`/`SECRET` | edit `.env` → `npm run seed` → restart | Tanpa reseed: 401 `client credential tidak valid`, sinkron gagal |

Generate secret baru:

```bash
openssl rand -hex 32   # JWT_SECRET, GATEWAY_SECRET
openssl rand -hex 24   # SERVICE_CLIENT_SECRET
```

Setelah rotasi service secret, perbarui juga:

- `tests/bruno/environments/Local.bru` → `serviceClientSecret`
- Postman → collection variable `serviceClientSecret`
  (atau biarkan kosong dan isi manual saat uji)

---

## 9. Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:3100` | Gateway belum jalan | `npm start`, cek log |
| `curl :3000` balas HTML Dokploy | Port 3000 dipakai Docker di mesin ini | Pakai 3100 sesuai `.env` |
| `EADDRINUSE` | Proses lama masih hidup | `pkill -f "gateway/server.js"` lalu ulangi |
| 403 `device tidak terdaftar...` | Device bukan milik user token | Cocokkan `X-Device-ID` dengan tabel §2 |
| 401 `access token kedaluwarsa` | Token > 10 menit | Login ulang |
| Finalisasi 200 tapi `sinkron.ok=false` | Secret service berubah tanpa reseed / gateway mati | `npm run seed`, pastikan gateway hidup |
| 409 `kelas belum difinalisasi` saat sinkron | Sinkron manual sebelum finalisasi | Finalisasi dulu |
| 403 saat PUT padahal jam kerja | `JAM_MULAI/JAM_SELESAI` salah / TZ | Periksa `.env`, restart |
| Postman token kosong | Folder Auth belum dijalankan | Jalankan login dulu atau isi variable manual |
| Bruno 401 semua request | Environment belum dipilih | Pilih **Local** kanan atas |

---

## 10. Run sheet rekaman (± 8 menit)

| Waktu | Yang ditampilkan |
|---|---|
| 0:00–0:30 | Diagram arsitektur `README.md` §1: client → gateway → 2 service → SQLite |
| 0:30–1:00 | `npm run seed` lalu `npm start`; tunjukkan tiga port hidup + `/health` |
| 1:00–1:40 | Login dosen01 **dengan** device; tunjukkan token & `user.role`; login tanpa device → 403 |
| 1:40–2:20 | `GET /nilai` sebagai dosen vs mahasiswa; tunjukkan filter kepemilikan |
| 2:20–3:00 | PUT nilai kelas lain → 403; buka `gateway/policy.js` bagian kepemilikan; PUT nilai sendiri → 200 |
| 3:00–3:40 | Akses langsung `:3001/nilai` → 403; dengan `X-Gateway-Secret` saja → 401 (verifikasi ganda) |
| 3:40–4:20 | Finalisasi; tunjukkan `sinkron.ok=true`; GET transkrip mahasiswa |
| 4:20–5:00 | Transkrip NIM lain → 403; sinkron dengan token dosen → 403; token service → 200 |
| 5:00–5:40 | Logout → refresh → 401; jelaskan revocation |
| 5:40–6:20 | `npm run audit` → tunjukkan baris allow & deny |
| 6:20–7:00 | Demo jam akses: `.env` 0/0, restart, PUT → 403, kembalikan |
| 7:00–8:00 | Kesimpulan: petakan ke kriteria penerimaan `docs/01-PRD.md` §9 |

Tips rekaman:

- Jangan buka `.env` penuh; cukup tunjukkan nama variabel + `grep -c` bila perlu.
- Siapkan dua tab: terminal (server) dan Postman/Bruno.
- Jalankan `npm run seed` tepat sebelum merekam agar alur finalisasi bersih.
- Kalau salah langkah, `npm run seed` + login ulang lebih cepat daripada debug.

---

## 11. Lampiran respons

**GET /nilai (mahasiswa)**

```json
{
  "role": "mahasiswa",
  "jumlah": 1,
  "data": [
    {
      "nilai_id": 1, "kelas_id": 1, "kode_kelas": "IF-101-A", "nama_mk": "Keamanan Informasi",
      "status": "open", "nim": "2024001", "nama": "Mahasiswa Satu",
      "angka": 82, "huruf": "AB", "updated_at": "2026-10-24 09:00:00"
    }
  ]
}
```

**GET /transkrip/2024001**

```json
{
  "nim": "2024001",
  "nama": "Mahasiswa Satu",
  "jumlah": 1,
  "entries": [
    { "kode_kelas": "IF-101-A", "nama_mk": "Keamanan Informasi", "angka": 90, "huruf": "A", "synced_at": "2026-10-24 10:15:00" }
  ]
}
```

**Deny dari gateway**

```json
{
  "error": "kelas bukan diampu dosen ini",
  "decision": "deny",
  "reason": "kelas bukan diampu dosen ini"
}
```

**Ditolak service (akses langsung)**

```json
{ "error": "akses langsung ke service ditolak", "reason": "akses langsung ke service ditolak" }
```
