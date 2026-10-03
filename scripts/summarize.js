#!/usr/bin/env node
// Merges k6 summary exports into one comparison table (averaged over repeats).
//   node scripts/summarize.js results/20261003-1200
const fs = require('node:fs');
const path = require('node:path');

const dir = process.argv[2];
if (!dir) { console.error('usage: summarize.js <results-dir>'); process.exit(1); }

const groups = {};
for (const f of fs.readdirSync(dir)) {
  const m = f.match(/^(pm2|watt)_(\w+)_(ka|new)_r(\d+)\.json$/);
  if (!m) continue;
  const [, runner, ep, mode] = m;
  const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).metrics;
  const dur = s.http_req_duration, reqs = s.http_reqs, fail = s.http_req_failed;
  const key = `${ep}|${mode}`;
  (groups[key] ??= { pm2: [], watt: [] })[runner].push({
    rps: reqs.rate, p50: dur['p(50)'], p99: dur['p(99)'], err: (fail.value ?? fail.rate ?? 0) * 100,
  });
}

const avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / (a.length || 1);
const f = (n, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '-');
const pct = (a, b) => (a && b ? `${b > a ? '+' : ''}${(((b - a) / a) * 100).toFixed(1)}%` : '-');

let out = '| Endpoint | Conn | pm2 req/s | Watt req/s | Δ req/s | pm2 p99 ms | Watt p99 ms | Δ p99 | errors pm2/Watt % | runs |\n';
out += '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|\n';
for (const key of Object.keys(groups).sort()) {
  const [ep, mode] = key.split('|');
  const { pm2, watt } = groups[key];
  const a = { rps: avg(pm2, 'rps'), p99: avg(pm2, 'p99'), err: avg(pm2, 'err') };
  const b = { rps: avg(watt, 'rps'), p99: avg(watt, 'p99'), err: avg(watt, 'err') };
  out += `| /${ep} | ${mode === 'ka' ? 'keep-alive' : 'new conn'} | ${f(a.rps)} | ${f(b.rps)} | ${pct(a.rps, b.rps)} | ${f(a.p99, 1)} | ${f(b.p99, 1)} | ${pct(a.p99, b.p99)} | ${f(a.err, 2)} / ${f(b.err, 2)} | ${pm2.length}/${watt.length} |\n`;
}
console.log(out);
