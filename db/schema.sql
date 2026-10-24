PRAGMA foreign_keys = ON;

-- ============ IDENTITAS ============

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    UNIQUE,               -- untuk dosen/admin (NULL untuk mahasiswa)
  nim           TEXT    UNIQUE,               -- hanya untuk mahasiswa
  nama          TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('mahasiswa','dosen','admin')),
  password_hash TEXT    NOT NULL,             -- bcrypt
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS devices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id   TEXT    NOT NULL UNIQUE,        -- nilai header X-Device-ID
  label       TEXT,                           -- mis. "Laptop Raka"
  registered_at TEXT  NOT NULL DEFAULT (datetime('now'))
);

-- ============ TOKEN ============

CREATE TABLE IF NOT EXISTS refresh_token (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,        -- hash SHA-256, bukan token asli
  device_id   TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,               -- created + 1 hari
  revoked_at  TEXT                            -- NULL = belum dicabut
);

CREATE TABLE IF NOT EXISTS clients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     TEXT    NOT NULL UNIQUE,      -- mis. "nilai-service"
  secret_hash   TEXT    NOT NULL,             -- bcrypt
  service_name  TEXT    NOT NULL              -- mis. "service-nilai"
);

-- ============ AKADEMIK ============

CREATE TABLE IF NOT EXISTS kelas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kode        TEXT    NOT NULL UNIQUE,        -- mis. "IF-101-A"
  nama_mk     TEXT    NOT NULL,
  dosen_id    INTEGER NOT NULL REFERENCES users(id),
  status      TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','final'))
);

CREATE TABLE IF NOT EXISTS kelas_mahasiswa (
  kelas_id    INTEGER NOT NULL REFERENCES kelas(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (kelas_id, user_id)
);

CREATE TABLE IF NOT EXISTS nilai (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kelas_id    INTEGER NOT NULL REFERENCES kelas(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  angka       REAL    CHECK (angka IS NULL OR (angka >= 0 AND angka <= 100)),
  huruf       TEXT,
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kelas_id, user_id)
);

-- Hasil sinkron di Service Transkrip
CREATE TABLE IF NOT EXISTS transkrip_entry (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nim           TEXT    NOT NULL,
  kode_kelas    TEXT    NOT NULL,
  nama_mk       TEXT    NOT NULL,
  angka         REAL,
  huruf         TEXT,
  synced_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, kode_kelas)
);

-- ============ AUDIT ============

CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT    NOT NULL DEFAULT (datetime('now')),
  subject_type TEXT    NOT NULL CHECK (subject_type IN ('user','service','anonymous')),
  subject      TEXT,
  role         TEXT,
  method       TEXT    NOT NULL,
  endpoint     TEXT    NOT NULL,
  device_id    TEXT,
  decision     TEXT    NOT NULL CHECK (decision IN ('allow','deny')),
  reason       TEXT    NOT NULL,
  ip           TEXT
);

-- ============ INDEX ============

CREATE INDEX IF NOT EXISTS idx_devices_user      ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_user      ON refresh_token(user_id);
CREATE INDEX IF NOT EXISTS idx_kelas_dosen       ON kelas(dosen_id);
CREATE INDEX IF NOT EXISTS idx_nilai_kelas       ON nilai(kelas_id);
CREATE INDEX IF NOT EXISTS idx_nilai_user        ON nilai(user_id);
CREATE INDEX IF NOT EXISTS idx_transkrip_nim     ON transkrip_entry(nim);
CREATE INDEX IF NOT EXISTS idx_audit_ts          ON audit_log(ts);
