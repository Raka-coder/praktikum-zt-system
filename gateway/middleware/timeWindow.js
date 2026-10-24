'use strict';

/**
 * Middleware langkah 4 pipeline gateway: jam akses untuk aksi yang mengubah nilai.
 * Logikanya ada di lib/timeWindow.js karena dipakai ulang oleh Service Nilai.
 */

const { needsTimeWindow, withinWindow, REASON } = require('../../lib/timeWindow');
const { deny } = require('./audit');

function timeWindow(req, res, next) {
  if (!needsTimeWindow(req.method, req.path)) return next();
  if (withinWindow()) return next();
  return deny(req, res, 403, REASON);
}

module.exports = timeWindow;
module.exports.REASON = REASON;
