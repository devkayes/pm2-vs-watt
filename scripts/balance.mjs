#!/usr/bin/env node
// Worker-balance check: counts how many requests each worker served via /whoami.
// Even split = balanced. One worker with most = the Booking.com-style imbalance.
//
//   node scripts/balance.mjs http://10.0.2.10:3000 [--new] [--concurrency 50] [--seconds 20] [--out file.json]
//
// --new : open a new TCP connection per request (Connection: close).
//         This is where SO_REUSEPORT's kernel hashing decides the worker.
import http from 'node:http';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const target = new URL(args.find((a) => a.startsWith('http')) ?? 'http://localhost:3000');
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const newConn = args.includes('--new');
const concurrency = Number(opt('--concurrency', 50));
const seconds = Number(opt('--seconds', 20));
const out = opt('--out');

const agent = new http.Agent({ keepAlive: !newConn, maxSockets: concurrency });
const counts = new Map();
let errors = 0;
const deadline = Date.now() + seconds * 1000;

function once() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: target.hostname, port: target.port || 80, path: '/whoami', agent,
        headers: newConn ? { connection: 'close' } : {} },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try { const w = JSON.parse(body).worker; counts.set(w, (counts.get(w) ?? 0) + 1); }
          catch { errors++; }
          resolve();
        });
      });
    req.on('error', () => { errors++; resolve(); });
  });
}

async function loop() { while (Date.now() < deadline) await once(); }
await Promise.all(Array.from({ length: concurrency }, loop));
agent.destroy();

const rows = [...counts].sort((a, b) => b[1] - a[1]);
const total = rows.reduce((s, [, c]) => s + c, 0) || 1;
console.log(`\nRequests per worker (pid:threadId) — ${newConn ? 'new connection per request' : 'keep-alive'}, ${total} requests, ${errors} errors`);
for (const [w, c] of rows) {
  const pct = (c / total) * 100;
  console.log(`  ${w.padEnd(12)} ${String(c).padStart(8)}  ${pct.toFixed(1).padStart(5)}%  ${'#'.repeat(Math.round(pct / 2))}`);
}
if (rows.length > 1) {
  const ideal = total / rows.length;
  console.log(`  max/ideal ratio: ${(rows[0][1] / ideal).toFixed(2)}  (1.00 = perfectly even)`);
}
if (out) writeFileSync(out, JSON.stringify({ newConn, total, errors, workers: Object.fromEntries(rows) }, null, 2));
