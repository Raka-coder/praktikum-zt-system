'use strict';

const { db } = require('../../db/database');
const { deny } = require('./audit');

const findDevice = db.prepare(
  'SELECT device_id FROM devices WHERE device_id = ? AND user_id = ?',
);

function deviceCheck(req, res, next) {
  if (!req.subject || req.subject.type === 'service') return next();

  const deviceId = req.get('X-Device-ID');
  if (!deviceId) {
    return deny(req, res, 403, 'header X-Device-ID wajib diisi');
  }

  const device = findDevice.get(deviceId, req.subject.id);
  if (!device) {
    return deny(req, res, 403, 'device tidak terdaftar untuk user ini');
  }

  req.deviceId = deviceId;
  return next();
}

module.exports = deviceCheck;
