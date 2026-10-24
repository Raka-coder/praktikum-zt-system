# ---------- base image ----------
FROM node:24-bookworm-slim

WORKDIR /app

# better-sqlite3 butuh prebuild; fallback build tools bila prebuild tidak tersedia
COPY package*.json ./
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && npm ci --omit=dev \
 && apt-get purge -y python3 make g++ \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

COPY . .

ENV NODE_ENV=production \
    BIND_HOST=0.0.0.0 \
    DB_PATH=/app/db/sistem_nilai.db

EXPOSE 3000 3001 3002

# seed idempoten (data demo selalu siap) lalu jalankan ketiga proses
CMD ["sh", "-c", "node db/seed.js && node scripts/start-all.js"]
