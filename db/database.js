'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('../lib/config');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });

const db = new Database(config.DB_PATH);

// WAL: gateway dan kedua service membuka file DB yang sama.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

module.exports = { db, DB_PATH: config.DB_PATH };
