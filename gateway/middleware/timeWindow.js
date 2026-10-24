'use strict';

const { needsTimeWindow, withinWindow, REASON } = require('../../lib/timeWindow');
const { deny } = require('./audit');

function timeWindow(req, res, next) {
  if (!needsTimeWindow(req.method, req.path)) return next();
  if (withinWindow()) return next();
  return deny(req, res, 403, REASON);
}

module.exports = timeWindow;
module.exports.REASON = REASON;
