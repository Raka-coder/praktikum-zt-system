'use strict';

/**
 * Service Transkrip — Resource (port 3002).
 * Lapisan kedua: wajib X-Gateway-Secret + JWT valid.
 */

const express = require('express');
const config = require('../../lib/config');
const gatewaySecret = require('./middleware/gatewaySecret');
const verifyToken = require('./middleware/verifyToken');
const transkripRoutes = require('./routes/transkrip');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'transkrip' }));

app.use(gatewaySecret);
app.use(verifyToken);
app.use(transkripRoutes);

app.use((req, res) => res.status(404).json({ error: 'endpoint tidak dikenali' }));

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'body JSON tidak valid' });
  }
  console.error('[transkrip] error:', err);
  return res.status(500).json({ error: 'internal server error' });
});

if (require.main === module) {
  app.listen(config.PORT_TRANSKRIP, config.BIND_HOST, () => {
    console.log(`[transkrip] berjalan di http://${config.BIND_HOST}:${config.PORT_TRANSKRIP}`);
  });
}

module.exports = app;
