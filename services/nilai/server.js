'use strict';

/**
 * Service Nilai — Resource (port 3001).
 * Lapisan kedua: wajib X-Gateway-Secret + JWT valid, walau gateway sudah memeriksa.
 */

const express = require('express');
const config = require('../../lib/config');
const gatewaySecret = require('./middleware/gatewaySecret');
const verifyToken = require('./middleware/verifyToken');
const nilaiRoutes = require('./routes/nilai');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'nilai' }));

app.use(gatewaySecret); // 403 akses langsung ke service ditolak
app.use(verifyToken); // 401 token tidak valid
app.use(nilaiRoutes);

app.use((req, res) => res.status(404).json({ error: 'endpoint tidak dikenali' }));

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'body JSON tidak valid' });
  }
  console.error('[nilai] error:', err);
  return res.status(500).json({ error: 'internal server error' });
});

if (require.main === module) {
  app.listen(config.PORT_NILAI, config.BIND_HOST, () => {
    console.log(`[nilai] berjalan di http://${config.BIND_HOST}:${config.PORT_NILAI}`);
  });
}

module.exports = app;
