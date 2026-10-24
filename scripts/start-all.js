'use strict';

/**
 * Jalankan gateway + kedua service sekaligus (satu komputer).
 * npm start
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const targets = [
  { name: 'gateway', file: path.join(ROOT, 'gateway', 'server.js'), color: '\x1b[36m' },
  { name: 'nilai', file: path.join(ROOT, 'services', 'nilai', 'server.js'), color: '\x1b[35m' },
  { name: 'transkrip', file: path.join(ROOT, 'services', 'transkrip', 'server.js'), color: '\x1b[33m' },
];

const RESET = '\x1b[0m';
const children = [];
let shuttingDown = false;

function prefixStream(stream, name, color) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.trim() === '') continue;
      process.stdout.write(`${color}[${name}]${RESET} ${line}\n`);
    }
  });
}

for (const target of targets) {
  const child = spawn(process.execPath, [target.file], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  prefixStream(child.stdout, target.name, target.color);
  prefixStream(child.stderr, target.name, target.color);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`[start-all] ${target.name} berhenti (code=${code}, signal=${signal}) — mematikan proses lain.`);
    shutdown(code ?? 1);
  });

  children.push(child);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 300).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[start-all] gateway :3000, nilai :3001, transkrip :3002');
