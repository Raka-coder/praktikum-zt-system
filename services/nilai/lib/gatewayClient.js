'use strict';

/**
 * Klien internal Service Nilai → Gateway.
 * Sinkron transkrip TIDAK memanggil Service Transkrip langsung, tetapi lewat gateway
 * (sesuai soal: seluruh akses diperiksa gateway, termasuk antar-service).
 */

const config = require('../../../lib/config');

async function requestJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

/** FR-AUTH-05: ambil token service (role service, TTL 5 menit). */
async function getServiceToken() {
  return requestJson(`${config.GATEWAY_URL}/auth/service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.SERVICE_CLIENT_ID,
      client_secret: config.SERVICE_CLIENT_SECRET,
    }),
  });
}

/** Panggil POST /transkrip/sinkron lewat gateway memakai token service. */
async function sinkronTranskrip(kelasId) {
  const tokenRes = await getServiceToken();
  if (!tokenRes.ok || !tokenRes.body?.access_token) {
    return {
      ok: false,
      stage: 'auth/service',
      status: tokenRes.status,
      body: tokenRes.body,
    };
  }

  const syncRes = await requestJson(`${config.GATEWAY_URL}/transkrip/sinkron`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenRes.body.access_token}`,
    },
    body: JSON.stringify({ kelas_id: kelasId }),
  });

  return { ...syncRes, stage: 'transkrip/sinkron' };
}

module.exports = { getServiceToken, sinkronTranskrip };
