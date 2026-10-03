#!/usr/bin/env node
// Run on the APP instance (Linux) during a test. Every INTERVAL seconds it
// records real CPU% (from /proc deltas) and RSS for the pm2 / Watt processes.
//   node scripts/collect-metrics.mjs results/pm2.procs.csv
// For pm2, the "PM2 ... God Daemon" row is the primary that hands off
// connections — the overhead Watt removes. Sum all rows for total memory.
import { readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const out = process.argv[2] ?? 'proc-metrics.csv';
const interval = Number(process.env.INTERVAL ?? 2) * 1000;
const TICKS = 100; // Linux USER_HZ
const MATCH = /PM2|dist\/main\.js|wattpm|platformatic/;
const SKIP = /npm exec|collect-metrics/;

writeFileSync(out, 'time,pid,cpu_pct,rss_mb,threads,role,command\n');
let prev = new Map();
let prevTime = process.hrtime.bigint();

function role(cmd) {
  if (/God Daemon/.test(cmd)) return 'pm2-daemon';
  if (/dist\/main\.js/.test(cmd)) return 'pm2-worker';
  return 'watt';
}

function sample() {
  const now = process.hrtime.bigint();
  const secs = Number(now - prevTime) / 1e9;
  const cur = new Map();
  const lines = [];
  for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
      if (!MATCH.test(cmd) || SKIP.test(cmd)) continue;
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const ticks = Number(f[11]) + Number(f[12]); // utime + stime
      const threads = f[17];
      const rss = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0) / 1024;
      cur.set(pid, ticks);
      if (!prev.has(pid)) continue; // need two samples for a CPU delta
      const cpu = ((ticks - prev.get(pid)) / TICKS / secs) * 100;
      lines.push([Math.floor(Date.now() / 1000), pid, cpu.toFixed(1), rss.toFixed(1), threads,
        role(cmd), cmd.slice(0, 80).replace(/,/g, ' ')].join(','));
    } catch { /* process exited */ }
  }
  if (lines.length) appendFileSync(out, lines.join('\n') + '\n');
  prev = cur; prevTime = now;
}

sample();
setInterval(sample, interval);
