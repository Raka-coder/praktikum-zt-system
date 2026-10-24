'use strict';

/**
 * API Gateway — Policy Enforcement Point (PEP), port 3000.
 * Satu-satunya pintu masuk. Urutan: authenticate → deviceCheck → timeWindow →
 * policy.decide → audit → proxy ke service dengan X-Gateway-Secret.
 */

const express = require('express');
const { createProxyMiddleware, fixRequestBody } = require('http-proxy-middleware');
const config = require('../lib/config');
const authenticate = require('./middleware/authenticate');
const deviceCheck = require('./middleware/deviceCheck');
const timeWindow = require('./middleware/timeWindow');
const { allow, deny } = require('./middleware/audit');
const policy = require('./policy');
const authRouter = require('./routes/auth');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// ---------- Health check (tanpa token, hanya untuk ops) ----------
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'gateway' }));

// ---------- /auth/*: ditangani PE/PA di gateway ----------
app.use('/auth', authRouter);

// ---------- Pipeline zero trust untuk semua endpoint lain ----------
app.use(authenticate); // 401
app.use(deviceCheck); // 403
app.use(timeWindow); // 403 (hanya PUT /nilai/:id, POST /kelas/:id/finalisasi)
app.use((req, res, next) => {
  const { allow: ok, reason } = policy.decide(req.subject, req.method, req.path, req.body);
  if (!ok) return deny(req, res, 403, reason);
  allow(req, reason); // FR-AUD-01: allow pun dicatat
  return next();
});

// ---------- Proxy ke service (service tidak bisa diakses langsung) ----------
function buildProxy(target, name) {
  return createProxyMiddleware({
    target,
    changeOrigin: false,
    xfwd: false,
    on: {
      proxyReq: (proxyReq, req) => {
        // Header dari client selalu ditimpa, jadi tidak bisa dipalsukan.
        proxyReq.setHeader('X-Gateway-Secret', config.GATEWAY_SECRET);
        // Body sudah diparse express.json(), tulis ulang ke request proxy.
        fixRequestBody(proxyReq, req);
      },
      error: (err, req, res) => {
        console.error(`[gateway] proxy ke ${name} gagal:`, err.message);
        if (res.headersSent) return;
        if (typeof res.status === 'function') {
          res.status(502).json({ error: `${name} tidak tersedia`, reason: err.message });
        } else {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `${name} tidak tersedia` }));
        }
      },
    },
  });
}

const nilaiProxy = buildProxy(config.NILAI_URL, 'service-nilai');
const transkripProxy = buildProxy(config.TRANSKRIP_URL, 'service-transkrip');

app.use((req, res, next) => {
  const p = req.path;
  if (p === '/nilai' || p.startsWith('/nilai/') || p === '/kelas' || p.startsWith('/kelas/')) {
    return nilaiProxy(req, res, next);
  }
  if (p === '/transkrip' || p.startsWith('/transkrip/')) {
    return transkripProxy(req, res, next);
  }
  // Default deny (policy sudah menangani, ini jaring pengaman).
  return deny(req, res, 404, 'endpoint tidak dikenali');
});

// ---------- Error handler ----------
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'body JSON tidak valid' });
  }
  console.error('[gateway] error:', err);
  return res.status(500).json({ error: 'internal server error' });
});

if (require.main === module) {
  app.listen(config.PORT_GATEWAY, config.BIND_HOST, () => {
    console.log(`[gateway] PEP berjalan di http://${config.BIND_HOST}:${config.PORT_GATEWAY}`);
    console.log(`[gateway] → nilai ${config.NILAI_URL} | transkrip ${config.TRANSKRIP_URL}`);
    console.log(`[gateway] jam akses ${config.JAM_MULAI}.00–${config.JAM_SELESAI}.00 (${config.TZ})`);
  });
}

module.exports = app;
