#!/usr/bin/env bash
# ============================================================
#  E2E test — Sistem Nilai Zero Trust
#  Menjalankan sistem dengan DB terpisah, lalu menguji seluruh
#  kriteria penerimaan (01-PRD §9) dan skenario 03-RULES §8.
#
#  Pemakaian: npm test        (atau: bash tests/e2e.sh)
# ============================================================

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

GW_PORT="${GW_PORT:-3100}"
NILAI_PORT="${NILAI_PORT:-3101}"
TRANSKRIP_PORT="${TRANSKRIP_PORT:-3102}"
CUTOFF_PORT="${CUTOFF_PORT:-3110}"

export PORT_GATEWAY="$GW_PORT"
export PORT_NILAI="$NILAI_PORT"
export PORT_TRANSKRIP="$TRANSKRIP_PORT"
export GATEWAY_URL="http://127.0.0.1:$GW_PORT"
export NILAI_URL="http://127.0.0.1:$NILAI_PORT"
export TRANSKRIP_URL="http://127.0.0.1:$TRANSKRIP_PORT"
export BIND_HOST="127.0.0.1"
export DB_PATH="./db/test-e2e.db"
export JAM_MULAI="${JAM_MULAI:-7}"
export JAM_SELESAI="${JAM_SELESAI:-21}"

BASE="http://127.0.0.1:$GW_PORT"
DB_FILE="$ROOT/db/test-e2e.db"
LOG="/tmp/zts-e2e-server.log"
BODY_FILE="/tmp/zts-e2e-body.json"
CUTOFF_LOG="/tmp/zts-e2e-cutoff.log"

PASS=0
FAIL=0
SERVER_PID=""
CUTOFF_PID=""

cleanup() {
  [[ -n "$CUTOFF_PID" ]] && kill "$CUTOFF_PID" 2>/dev/null
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null
  wait 2>/dev/null
  rm -f "$DB_FILE" "$DB_FILE-wal" "$DB_FILE-shm"
}
trap cleanup EXIT

# ---------- util ----------
ok()   { PASS=$((PASS + 1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }

# req METHOD PATH TOKEN DEVICE [JSON_BODY] → mengisi STATUS dan BODY
req() {
  local method="$1" path="$2" token="${3:-}" device="${4:-}" data="${5:-}"
  local args=(-s -m 15 -o "$BODY_FILE" -w '%{http_code}' -X "$method" "$BASE$path")
  [[ -n "$token"  ]] && args+=(-H "Authorization: Bearer $token")
  [[ -n "$device" ]] && args+=(-H "X-Device-ID: $device")
  [[ -n "$data"   ]] && args+=(-H 'Content-Type: application/json' -d "$data")
  STATUS="$(curl "${args[@]}")"
  BODY="$(cat "$BODY_FILE" 2>/dev/null || echo '')"
}

# jget "a.b.c" → ambil nilai dari $BODY
jget() {
  node -e '
    let raw = process.argv[1] || "{}";
    let cur; try { cur = JSON.parse(raw); } catch { cur = {}; }
    for (const key of process.argv[2].split(".")) cur = cur?.[key];
    if (cur === undefined || cur === null) process.stdout.write("");
    else if (typeof cur === "object") process.stdout.write(JSON.stringify(cur));
    else process.stdout.write(String(cur));
  ' "$BODY" "$1"
}

expect_status() { # name expected [reason-substring]
  local name="$1" expected="$2" reason="${3:-}"
  if [[ "$STATUS" == "$expected" ]]; then
    if [[ -z "$reason" ]] || grep -qi -- "$reason" <<<"$BODY"; then
      ok "$name → $STATUS"
    else
      bad "$name → $STATUS tapi alasan tidak memuat '$reason' (body: $(head -c 200 <<<"$BODY"))"
    fi
  else
    bad "$name → harap $expected, dapat $STATUS (body: $(head -c 200 <<<"$BODY"))"
  fi
}

sqlval() { # sqlval "SELECT ..." → nilai kolom pertama
  DB_PATH="$DB_FILE" node -e '
    const Database = require("better-sqlite3");
    const db = new Database(process.env.DB_PATH, { readonly: true });
    const row = db.prepare(process.argv[1]).get();
    if (row) process.stdout.write(String(Object.values(row)[0]));
  ' "$1"
}

login() { # login IDENT PASSWORD DEVICE → mengisi TOKEN, REFRESH
  req POST /auth/login "" "$3" "{\"username\":\"$1\",\"password\":\"$2\"}"
  if [[ "$STATUS" == "200" ]]; then
    TOKEN="$(jget access_token)"
    REFRESH="$(jget refresh_token)"
  else
    TOKEN=""; REFRESH=""
  fi
}

# ---------- siapkan DB + jalankan sistem ----------
printf '\n\033[1m== Sistem Nilai Zero Trust — E2E ==\033[0m\n'
rm -f "$DB_FILE" "$DB_FILE-wal" "$DB_FILE-shm"
if ! node db/seed.js >/dev/null 2>&1; then
  echo "Gagal seed DB. Cek: node db/seed.js"
  exit 1
fi

node scripts/start-all.js >"$LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if curl -s -m 1 "http://127.0.0.1:$NILAI_PORT/health" >/dev/null 2>&1 \
     && curl -s -m 1 "$BASE/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
if ! curl -s -m 1 "$BASE/health" >/dev/null 2>&1; then
  echo "Gateway tidak hidup. Log: $LOG"
  tail -20 "$LOG"
  exit 1
fi

GW_SECRET="$(grep -E '^GATEWAY_SECRET=' .env | cut -d= -f2-)"
SERVICE_CLIENT_ID="$(grep -E '^SERVICE_CLIENT_ID=' .env | cut -d= -f2-)"
SERVICE_CLIENT_SECRET="$(grep -E '^SERVICE_CLIENT_SECRET=' .env | cut -d= -f2-)"
JWT_SECRET="$(grep -E '^JWT_SECRET=' .env | cut -d= -f2-)"
NILAI_ID_101="$(sqlval "SELECT n.id FROM nilai n JOIN kelas k ON k.id=n.kelas_id WHERE k.kode='IF-101-A' LIMIT 1")"
NILAI_ID_102="$(sqlval "SELECT n.id FROM nilai n JOIN kelas k ON k.id=n.kelas_id WHERE k.kode='IF-102-B' LIMIT 1")"

# ---------- 1. Autentikasi ----------
printf '\n\033[1m[1] Autentikasi & token\033[0m\n'
login dosen01 'Dosen123!' DEV-DOSEN-01; DOSEN_TOKEN="$TOKEN"; DOSEN_REFRESH="$REFRESH"
req POST /auth/login "" DEV-DOSEN-01 '{"username":"dosen01","password":"Dosen123!"}'
expect_status "Login dosen01 + device terdaftar" 200

login 2024001 'Mhs123!' DEV-MHS-01; MHS_TOKEN="$TOKEN"; MHS_REFRESH="$REFRESH"
req POST /auth/login "" DEV-MHS-01 '{"nim":"2024001","password":"Mhs123!"}'
expect_status "Login mahasiswa via nim" 200

login admin01 'Admin123!' DEV-ADMIN-01; ADMIN_TOKEN="$TOKEN"
req POST /auth/login "" DEV-ADMIN-01 '{"username":"admin01","password":"Admin123!"}'
expect_status "Login admin01" 200

login dosen02 'Dosen123!' DEV-DOSEN-02; DOSEN2_TOKEN="$TOKEN"

req POST /auth/login "" DEV-MHS-02 '{"username":"dosen01","password":"Dosen123!"}'
expect_status "Login dengan device milik user lain" 403 "device tidak terdaftar"

req POST /auth/login "" DEV-DOSEN-01 '{"username":"dosen01","password":"Salah123!"}'
expect_status "Login password salah" 401 "kredensial tidak valid"

req POST /auth/login "" DEV-DOSEN-01 '{"username":"dosen02","password":"Dosen123!"}'
STATUS_CHECK="$STATUS"

# ---------- 2. Token service ----------
printf '\n\033[1m[2] Token service\033[0m\n'
req POST /auth/service "" "" "{\"client_id\":\"$SERVICE_CLIENT_ID\",\"client_secret\":\"$SERVICE_CLIENT_SECRET\"}"
expect_status "POST /auth/service kredensial benar" 200
SERVICE_TOKEN="$(jget access_token)"

req POST /auth/service "" "" "{\"client_id\":\"$SERVICE_CLIENT_ID\",\"client_secret\":\"salah\"}"
expect_status "POST /auth/service secret salah" 401 "client credential"

# ---------- 3. Tanpa token & device ----------
printf '\n\033[1m[3] Verifikasi setiap request\033[0m\n'
req GET /nilai
expect_status "GET /nilai tanpa token" 401 "access token"

req GET /nilai "token.tidak.valid" DEV-MHS-01
expect_status "GET /nilai token tidak valid" 401 "tidak valid"

EXPIRED_TOKEN="$(JWT_SECRET="$JWT_SECRET" node -e '
  const jwt = require("jsonwebtoken");
  console.log(jwt.sign({ sub: 4, role: "mahasiswa", typ: "user", nim: "2024001" }, process.env.JWT_SECRET, { expiresIn: -10 }));
')"
req GET /nilai "$EXPIRED_TOKEN" DEV-MHS-01
expect_status "GET /nilai token kedaluwarsa" 401 "kedaluwarsa"

req GET /nilai "$MHS_TOKEN" DEV-MHS-02
expect_status "GET /nilai device milik user lain" 403 "device tidak terdaftar"

# ---------- 4. Kepemilikan data ----------
printf '\n\033[1m[4] Kebijakan kepemilikan data\033[0m\n'
req GET /nilai "$MHS_TOKEN" DEV-MHS-01
expect_status "Mahasiswa GET /nilai" 200
OWN_ROWS="$(jget data)"
if node -e '
  const rows = JSON.parse(process.argv[1] || "[]");
  const bad = rows.filter((r) => String(r.nim) !== "2024001");
  process.exit(rows.length > 0 && bad.length === 0 ? 0 : 1);
' "$OWN_ROWS"; then
  ok "GET /nilai mahasiswa hanya berisi NIM sendiri"
else
  bad "GET /nilai mahasiswa memuat NIM orang lain / kosong: $(head -c 200 <<<"$OWN_ROWS")"
fi

req GET /nilai "$DOSEN_TOKEN" DEV-DOSEN-01
expect_status "Dosen GET /nilai" 200

req GET /nilai "$ADMIN_TOKEN" DEV-ADMIN-01
expect_status "Admin GET /nilai (tidak diizinkan tabel keputusan)" 403 "tidak diizinkan"

req GET /transkrip/2024002 "$MHS_TOKEN" DEV-MHS-01
expect_status "Mahasiswa akses transkrip NIM orang lain" 403 "NIM sendiri"

req GET /transkrip/2024001 "$MHS_TOKEN" DEV-MHS-01
expect_status "Mahasiswa akses transkrip sendiri" 200

req GET /transkrip/2024003 "$ADMIN_TOKEN" DEV-ADMIN-01
expect_status "Admin akses transkrip mahasiswa" 200

req GET /transkrip/2024003 "$DOSEN_TOKEN" DEV-DOSEN-01
expect_status "Dosen akses transkrip (tidak diizinkan)" 403

# ---------- 5. Perubahan nilai ----------
printf '\n\033[1m[5] Perubahan & finalisasi nilai\033[0m\n'
req PUT "/nilai/$NILAI_ID_102" "$DOSEN_TOKEN" DEV-DOSEN-01 '{"angka":90}'
expect_status "Dosen ubah nilai kelas bukan diampu" 403 "bukan diampu"

req PUT "/nilai/$NILAI_ID_101" "$MHS_TOKEN" DEV-MHS-01 '{"angka":100}'
expect_status "Mahasiswa ubah nilai" 403 "hanya untuk dosen"

req PUT "/nilai/$NILAI_ID_101" "$DOSEN_TOKEN" DEV-DOSEN-01 '{"angka":95}'
expect_status "Dosen ubah nilai kelas diampu" 200
if [[ "$(jget data.huruf)" == "A" ]]; then ok "Huruf otomatis dari angka (95 → A)"; else bad "Huruf tidak dihitung (dapat '$(jget data.huruf)')"; fi

req PUT "/nilai/$NILAI_ID_101" "$DOSEN_TOKEN" DEV-DOSEN-01 '{"angka":150}'
expect_status "Validasi angka > 100" 400 "0–100"

req POST /kelas/IF-101-A/finalisasi "$DOSEN_TOKEN" DEV-DOSEN-01
expect_status "Finalisasi kelas IF-101-A" 200
if [[ "$(jget sinkron.ok)" == "true" ]]; then ok "Sinkron transkrip otomatis lewat gateway"; else bad "Sinkron gagal: $(head -c 300 <<<"$BODY")"; fi

req PUT "/nilai/$NILAI_ID_101" "$DOSEN_TOKEN" DEV-DOSEN-01 '{"angka":80}'
expect_status "Ubah nilai setelah finalisasi" 403 "sudah difinalisasi"

req POST /kelas/IF-101-A/finalisasi "$DOSEN_TOKEN" DEV-DOSEN-01
expect_status "Finalisasi ulang kelas final" 403 "sudah difinalisasi"

req POST /kelas/IF-102-B/finalisasi "$DOSEN_TOKEN" DEV-DOSEN-01
expect_status "Dosen01 finalisasi kelas dosen02" 403 "bukan diampu"

# ---------- 6. Sinkron & transkrip ----------
printf '\n\033[1m[6] Sinkron transkrip\033[0m\n'
req GET /transkrip/2024001 "$ADMIN_TOKEN" DEV-ADMIN-01
expect_status "Transkrip mahasiswa ter-update setelah finalisasi" 200
if [[ "$(jget jumlah)" -ge 1 ]] 2>/dev/null; then
  ok "Transkrip 2024001 berisi $(jget jumlah) entri (IF-101-A tersinkron)"
else
  bad "Transkrip 2024001 kosong: $(head -c 300 <<<"$BODY")"
fi

req POST /transkrip/sinkron "$DOSEN_TOKEN" DEV-DOSEN-01 '{"kelas_id":1}'
expect_status "Token user panggil sinkron transkrip" 403 "hanya untuk service"

req POST /transkrip/sinkron "$MHS_TOKEN" DEV-MHS-01 '{"kelas_id":1}'
expect_status "Token mahasiswa panggil sinkron transkrip" 403 "hanya untuk service"

req POST /transkrip/sinkron "$SERVICE_TOKEN" "" '{"kode":"IF-101-A"}'
expect_status "Token service panggil sinkron transkrip" 200

# ---------- 7. Refresh & logout ----------
printf '\n\033[1m[7] Refresh & logout\033[0m\n'
req POST /auth/refresh "" "" "{\"refresh_token\":\"$MHS_REFRESH\"}"
expect_status "Refresh token valid" 200
FRESH_TOKEN="$(jget access_token)"
req GET /nilai "$FRESH_TOKEN" DEV-MHS-01
expect_status "Access token hasil refresh dipakai" 200

req POST /auth/logout "" "" "{\"refresh_token\":\"$MHS_REFRESH\"}"
expect_status "Logout mencabut refresh token" 200

req POST /auth/refresh "" "" "{\"refresh_token\":\"$MHS_REFRESH\"}"
expect_status "Refresh token lama setelah logout" 401 "sudah dicabut"

req POST /auth/logout "" "" "{\"refresh_token\":\"$MHS_REFRESH\"}"
expect_status "Logout ulang (idempoten)" 200

# ---------- 8. Akses langsung ke service ----------
printf '\n\033[1m[8] Akses langsung ke service\033[0m\n'
DIRECT="http://127.0.0.1:$NILAI_PORT"
C1="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$DIRECT/nilai")"
[[ "$C1" == "403" ]] && ok "GET :$NILAI_PORT/nilai tanpa gateway secret → 403" || bad "Akses langsung tanpa secret → $C1"

C2="$(curl -s -m 5 -o /dev/null -w '%{http_code}' -H "X-Gateway-Secret: $GW_SECRET" "$DIRECT/nilai")"
[[ "$C2" == "401" ]] && ok "Gateway secret tanpa token → 401 (verifikasi token tetap jalan)" || bad "Gateway secret tanpa token → $C2"

C3="$(curl -s -m 5 -o /dev/null -w '%{http_code}' -H "X-Gateway-Secret: $GW_SECRET" -H "Authorization: Bearer $DOSEN_TOKEN" "$DIRECT/nilai")"
[[ "$C3" == "200" ]] && ok "Gateway secret + token valid → 200" || bad "Gateway secret + token → $C3"

C4="$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$TRANSKRIP_PORT/transkrip/sinkron" -H 'Content-Type: application/json' -d '{"kelas_id":1}')"
[[ "$C4" == "403" ]] && ok "POST :$TRANSKRIP_PORT/transkrip/sinkron tanpa secret → 403" || bad "Akses langsung transkrip → $C4"

# ---------- 9. Jam akses ----------
printf '\n\033[1m[9] Jam akses (gateway kedua dengan JAM_MULAI=0 JAM_SELESAI=0)\033[0m\n'
PORT_GATEWAY="$CUTOFF_PORT" JAM_MULAI=0 JAM_SELESAI=0 node gateway/server.js >"$CUTOFF_LOG" 2>&1 &
CUTOFF_PID=$!
for _ in $(seq 1 30); do
  curl -s -m 1 "http://127.0.0.1:$CUTOFF_PORT/health" >/dev/null 2>&1 && break
  sleep 0.2
done
CUT_BASE="http://127.0.0.1:$CUTOFF_PORT"
CUT_LOGIN="$(curl -s -m 5 -X POST "$CUT_BASE/auth/login" -H 'Content-Type: application/json' -H 'X-Device-ID: DEV-DOSEN-02' -d '{"username":"dosen02","password":"Dosen123!"}')"
CUT_TOKEN="$(node -e 'try{process.stdout.write(JSON.parse(process.argv[1]).access_token||"")}catch{}' "$CUT_LOGIN")"
CUT_STATUS="$(curl -s -m 5 -o "$BODY_FILE" -w '%{http_code}' -X PUT "$CUT_BASE/nilai/$NILAI_ID_102" -H "Authorization: Bearer $CUT_TOKEN" -H 'X-Device-ID: DEV-DOSEN-02' -H 'Content-Type: application/json' -d '{"angka":70}')"
CUT_BODY="$(cat "$BODY_FILE")"
if [[ "$CUT_STATUS" == "403" ]] && grep -q 'di luar jam akses' <<<"$CUT_BODY"; then
  ok "Perubahan nilai di luar jam akses → 403 (${CUT_BODY:0:90})"
else
  bad "Di luar jam akses → $CUT_STATUS (${CUT_BODY:0:200})"
fi
kill "$CUTOFF_PID" 2>/dev/null; CUTOFF_PID=""

# ---------- 10. Audit log ----------
printf '\n\033[1m[10] Audit log\033[0m\n'
AUDIT_TOTAL="$(sqlval 'SELECT COUNT(*) FROM audit_log')"
AUDIT_ALLOW="$(sqlval "SELECT COUNT(*) FROM audit_log WHERE decision='allow'")"
AUDIT_DENY="$(sqlval "SELECT COUNT(*) FROM audit_log WHERE decision='deny'")"
[[ "${AUDIT_TOTAL:-0}" -gt 0 ]] && ok "audit_log berisi $AUDIT_TOTAL baris (allow=$AUDIT_ALLOW, deny=$AUDIT_DENY)" || bad "audit_log kosong"

DENY_TIME="$(sqlval "SELECT COUNT(*) FROM audit_log WHERE decision='deny' AND reason LIKE '%jam akses%'")"
[[ "${DENY_TIME:-0}" -gt 0 ]] && ok "Deny jam akses tercatat di audit_log" || bad "Deny jam akses tidak tercatat"

SERVICE_AUDIT="$(sqlval "SELECT COUNT(*) FROM audit_log WHERE subject_type='service' AND decision='allow'")"
[[ "${SERVICE_AUDIT:-0}" -gt 0 ]] && ok "Keputusan untuk token service tercatat (subject_type=service)" || bad "Audit token service tidak ada"

printf '\n  Contoh 5 baris terakhir audit_log:\n'
DB_PATH="$DB_FILE" node -e '
  const Database = require("better-sqlite3");
  const db = new Database(process.env.DB_PATH, { readonly: true });
  const rows = db.prepare("SELECT ts, subject_type, subject, role, method, endpoint, decision, reason FROM audit_log ORDER BY id DESC LIMIT 5").all();
  for (const r of rows.reverse()) {
    console.log(`   ${r.ts} | ${r.subject_type} | ${r.subject ?? "-"} | ${r.role ?? "-"} | ${r.method} ${r.endpoint} | ${r.decision} | ${r.reason}`);
  }
' 2>/dev/null

# ---------- ringkasan ----------
TOTAL=$((PASS + FAIL))
printf '\n\033[1m== Hasil: %d/%d lulus ==\033[0m\n' "$PASS" "$TOTAL"
if [[ "$FAIL" -gt 0 ]]; then
  printf '\033[31m%d gagal\033[0m — log server: %s\n\n' "$FAIL" "$LOG"
  exit 1
fi
printf '\033[32mSemua skenario lulus.\033[0m\n\n'
