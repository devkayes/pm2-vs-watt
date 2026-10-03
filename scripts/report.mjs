#!/usr/bin/env node
// Builds a self-contained HTML report (charts + table) from a results folder.
//   node scripts/report.mjs results/20261003-1200
// Opens in any browser, no internet needed. Screenshot it for your post.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir || !existsSync(dir)) { console.error('usage: report.mjs <results-dir>'); process.exit(1); }
const read = (f) => readFileSync(path.join(dir, f), 'utf8');
const files = readdirSync(dir);
const RUNNERS = ['pm2', 'watt'];
const LABEL = { pm2: 'pm2', watt: 'Watt' };

// ---------- k6 summaries ----------
const tests = {}; // "ping|new" -> { pm2: [{rps,p50,p99,err}], watt: [...] }
for (const f of files) {
  const m = f.match(/^(pm2|watt)_(\w+)_(ka|new)_r(\d+)\.json$/);
  if (!m) continue;
  const [, runner, ep, mode] = m;
  const s = JSON.parse(read(f)).metrics;
  const fail = s.http_req_failed ?? {};
  ((tests[`${ep}|${mode}`] ??= { pm2: [], watt: [] })[runner]).push({
    rps: s.http_reqs.rate, p50: s.http_req_duration['p(50)'], p99: s.http_req_duration['p(99)'],
    err: (fail.value ?? fail.rate ?? 0) * 100,
  });
}
const EP_ORDER = ['ping', 'cpu', 'io'];
const testKeys = Object.keys(tests).sort((a, b) => {
  const [ea, ma] = a.split('|'), [eb, mb] = b.split('|');
  return (EP_ORDER.indexOf(ea) - EP_ORDER.indexOf(eb)) || ma.localeCompare(mb);
});
const avg = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const stats = (arr, k) => {
  const v = arr.map((x) => x[k]);
  return { mean: avg(v), min: Math.min(...v), max: Math.max(...v), n: v.length };
};
const testName = (k) => { const [ep, mode] = k.split('|'); return { ep: `/${ep}`, conn: mode === 'ka' ? 'keep-alive' : 'new connection' }; };

// ---------- process samples ----------
function procSummary(runner) {
  const peaks = [], idles = [], daemonBusy = [];
  for (const f of files.filter((x) => x.startsWith(`${runner}_r`) && x.endsWith('.procs.csv'))) {
    const rows = read(f).trim().split('\n').slice(1).map((l) => l.split(','));
    const byT = new Map();
    for (const [t, , cpu, rss, , role] of rows) {
      const e = byT.get(t) ?? { rss: 0, cpu: 0, daemon: 0 };
      e.rss += Number(rss); e.cpu += Number(cpu);
      if (role === 'pm2-daemon') e.daemon += Number(cpu);
      byT.set(t, e);
    }
    const samples = [...byT.values()];
    if (!samples.length) continue;
    peaks.push(Math.max(...samples.map((s) => s.rss)));
    idles.push(samples[0].rss);
    // "busy" = app using at least half a core in total
    daemonBusy.push(...samples.filter((s) => s.cpu > 50).map((s) => s.daemon));
  }
  return peaks.length ? { peak: avg(peaks), idle: avg(idles), daemon: daemonBusy.length ? avg(daemonBusy) : 0 } : null;
}
const procs = Object.fromEntries(RUNNERS.map((r) => [r, procSummary(r)]));

// ---------- balance ----------
function balance(runner) {
  const f = files.filter((x) => x.startsWith(`${runner}_balance_r`) && x.endsWith('.json')).sort()[0];
  if (!f) return null;
  const b = JSON.parse(read(f));
  const workers = Object.entries(b.workers).sort((a, c) => c[1] - a[1]);
  const ideal = b.total / (workers.length || 1);
  return { total: b.total, workers, ratio: workers.length ? workers[0][1] / ideal : 1 };
}
const bal = Object.fromEntries(RUNNERS.map((r) => [r, balance(r)]));

// ---------- helpers ----------
const fmt = (n, d = 0) => Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '–';
const pct = (a, b) => (a && b ? ((b - a) / a) * 100 : NaN);
const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Horizontal bar, square at the baseline, 4px rounded at the data end.
function hbar(x, y, w, h, r = 4) {
  if (w <= 0) return '';
  r = Math.min(r, w, h / 2);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}

// Two-bar comparison chart (pm2 vs Watt) with optional min–max whiskers.
function pairChart(rows, { unit, digits = 0, better }) {
  const W = 320, labelW = 46, valueW = 74, barH = 22, gap = 10, padT = 6;
  const max = Math.max(...rows.map((r) => r.max ?? r.value)) || 1;
  const plotW = W - labelW - valueW;
  const sx = (v) => (v / max) * plotW;
  const H = padT + rows.length * (barH + gap);
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(rows.map((r) => `${r.label} ${fmt(r.value, digits)} ${unit}`).join(', '))}">`;
  svg += `<line x1="${labelW}" x2="${labelW}" y1="0" y2="${H - gap + 2}" class="axis"/>`;
  rows.forEach((r, i) => {
    const y = padT + i * (barH + gap);
    const tip = `${r.label}: ${fmt(r.value, digits)} ${unit}` + (r.n > 1 ? ` (avg of ${r.n} runs, range ${fmt(r.min, digits)}–${fmt(r.max, digits)})` : '');
    svg += `<text x="${labelW - 8}" y="${y + barH / 2}" class="lbl" text-anchor="end" dominant-baseline="central">${esc(r.label)}</text>`;
    svg += `<path d="${hbar(labelW, y, sx(r.value), barH)}" class="bar ${r.key}"/>`;
    if (r.n > 1 && r.max > r.min) {
      const cy = y + barH / 2;
      svg += `<g class="whisker"><line x1="${labelW + sx(r.min)}" x2="${labelW + sx(r.max)}" y1="${cy}" y2="${cy}"/>` +
        `<line x1="${labelW + sx(r.min)}" x2="${labelW + sx(r.min)}" y1="${cy - 5}" y2="${cy + 5}"/>` +
        `<line x1="${labelW + sx(r.max)}" x2="${labelW + sx(r.max)}" y1="${cy - 5}" y2="${cy + 5}"/></g>`;
    }
    svg += `<text x="${labelW + Math.max(sx(r.max ?? r.value), sx(r.value)) + 8}" y="${y + barH / 2}" class="val" dominant-baseline="central">${fmt(r.value, digits)}</text>`;
    svg += `<rect x="0" y="${y - gap / 2}" width="${W}" height="${barH + gap}" class="hit" data-tip="${esc(tip)}"/>`;
  });
  return svg + '</svg>';
}

function deltaBadge(a, b, better) {
  const d = pct(a, b);
  if (!Number.isFinite(d)) return '';
  const good = better === 'higher' ? d > 0 : d < 0;
  const flat = Math.abs(d) < 3;
  const cls = flat ? 'flat' : good ? 'win' : 'loss';
  const word = flat ? 'about equal' : good ? 'Watt better' : 'pm2 better';
  return `<span class="delta ${cls}">Watt ${sign(d)}${fmt(Math.abs(d), 1)}% · ${word}</span>`;
}

// ---------- sections ----------
function metricSection(key, title, unit, digits, better, note) {
  const cards = testKeys.map((k) => {
    const t = tests[k];
    const { ep, conn } = testName(k);
    const rows = RUNNERS.filter((r) => t[r].length).map((r) => ({ key: r, label: LABEL[r], ...stats(t[r], key), value: stats(t[r], key).mean }));
    const [a, b] = [rows.find((r) => r.key === 'pm2'), rows.find((r) => r.key === 'watt')];
    return `<figure class="card"><figcaption><b>${ep}</b> <span class="muted">${conn}</span></figcaption>
      ${pairChart(rows, { unit, digits, better })}
      ${a && b ? deltaBadge(a.value, b.value, better) : ''}</figure>`;
  }).join('');
  return `<section><h2>${title}</h2><p class="note">${note}</p><div class="grid">${cards}</div></section>`;
}

function headline() {
  const tiles = testKeys.map((k) => {
    const t = tests[k]; const { ep, conn } = testName(k);
    if (!t.pm2.length || !t.watt.length) return '';
    const d = pct(stats(t.pm2, 'rps').mean, stats(t.watt, 'rps').mean);
    return `<div class="tile"><div class="big">${sign(d)}${fmt(Math.abs(d), 0)}%</div><div class="cap">Watt req/s vs pm2<br><b>${ep}</b> · ${conn}</div></div>`;
  });
  if (procs.pm2 && procs.watt) {
    const d = pct(procs.pm2.peak, procs.watt.peak);
    tiles.push(`<div class="tile"><div class="big">${sign(d)}${fmt(Math.abs(d), 0)}%</div><div class="cap">Watt peak memory vs pm2<br>all processes</div></div>`);
  }
  if (procs.pm2?.daemon) {
    tiles.push(`<div class="tile"><div class="big">${fmt(procs.pm2.daemon, 0)}%</div><div class="cap">of a CPU core used by pm2's daemon<br>handing off connections</div></div>`);
  }
  return `<section class="tiles">${tiles.join('')}</section>`;
}

function serverSection() {
  if (!procs.pm2 && !procs.watt) return '';
  const rowsFor = (k) => RUNNERS.filter((r) => procs[r]).map((r) => ({ key: r, label: LABEL[r], value: procs[r][k], n: 1 }));
  const daemon = procs.pm2 ? [{ key: 'daemon', label: 'pm2', value: procs.pm2.daemon, n: 1 }, { key: 'watt', label: 'Watt', value: 0, n: 1 }] : [];
  return `<section><h2>App server cost</h2>
    <p class="note">From <code>collect-metrics.mjs</code>: summed over every pm2/Watt process. Lower is better.</p>
    <div class="grid">
      <figure class="card"><figcaption><b>Peak memory</b> <span class="muted">RSS, MB</span></figcaption>${pairChart(rowsFor('peak'), { unit: 'MB', digits: 0 })}
        ${procs.pm2 && procs.watt ? deltaBadge(procs.pm2.peak, procs.watt.peak, 'lower') : ''}</figure>
      <figure class="card"><figcaption><b>Idle memory</b> <span class="muted">RSS at start, MB</span></figcaption>${pairChart(rowsFor('idle'), { unit: 'MB', digits: 0 })}
        ${procs.pm2 && procs.watt ? deltaBadge(procs.pm2.idle, procs.watt.idle, 'lower') : ''}</figure>
      ${daemon.length ? `<figure class="card"><figcaption><b>Connection hand-off overhead</b> <span class="muted">% of one core, while busy</span></figcaption>${pairChart(daemon, { unit: '% CPU', digits: 0 })}
        <span class="delta flat">Watt has no hand-off process</span></figure>` : ''}
    </div></section>`;
}

function balanceSection() {
  if (!bal.pm2 && !bal.watt) return '';
  const cards = RUNNERS.filter((r) => bal[r]).map((r) => {
    const b = bal[r];
    const rows = b.workers.map(([w, c], i) => ({ key: r, label: `#${i + 1}`, value: (c / b.total) * 100, n: 1, worker: w }));
    const even = 100 / (rows.length || 1);
    const verdict = b.ratio < 1.15 ? ['win', 'balanced'] : b.ratio < 1.5 ? ['flat', 'slightly uneven'] : ['loss', 'imbalanced'];
    return `<figure class="card"><figcaption><b>${LABEL[r]}</b> <span class="muted">share of requests per worker, %</span></figcaption>
      ${pairChart(rows, { unit: '% of requests', digits: 1 })}
      <span class="delta ${verdict[0]}">busiest worker ${fmt(b.ratio, 2)}× its fair share (${fmt(even, 0)}%) · ${verdict[1]}</span></figure>`;
  }).join('');
  return `<section><h2>Worker balance</h2><p class="note">New connection per request against <code>/whoami</code>. pm2 hands out connections round-robin; Watt lets the Linux kernel hash them (SO_REUSEPORT). 1.00× = perfectly even.</p><div class="grid">${cards}</div></section>`;
}

function table() {
  const rows = testKeys.map((k) => {
    const t = tests[k]; const { ep, conn } = testName(k);
    const c = (r, key, d) => (t[r].length ? fmt(stats(t[r], key).mean, d) : '–');
    const d = (key) => (t.pm2.length && t.watt.length ? `${sign(pct(stats(t.pm2, key).mean, stats(t.watt, key).mean))}${fmt(Math.abs(pct(stats(t.pm2, key).mean, stats(t.watt, key).mean)), 1)}%` : '–');
    return `<tr><td>${ep}</td><td>${conn}</td><td>${c('pm2', 'rps')}</td><td>${c('watt', 'rps')}</td><td>${d('rps')}</td>
      <td>${c('pm2', 'p50', 1)}</td><td>${c('watt', 'p50', 1)}</td><td>${c('pm2', 'p99', 1)}</td><td>${c('watt', 'p99', 1)}</td><td>${d('p99')}</td>
      <td>${c('pm2', 'err', 2)} / ${c('watt', 'err', 2)}</td><td>${t.pm2.length}/${t.watt.length}</td></tr>`;
  }).join('');
  return `<section><h2>All numbers</h2><div class="tablewrap"><table>
    <thead><tr><th>Endpoint</th><th>Connection</th><th>pm2 req/s</th><th>Watt req/s</th><th>Δ req/s</th><th>pm2 p50 ms</th><th>Watt p50 ms</th><th>pm2 p99 ms</th><th>Watt p99 ms</th><th>Δ p99</th><th>errors % pm2/Watt</th><th>runs</th></tr></thead>
    <tbody>${rows}</tbody></table></div></section>`;
}

const runs = Math.max(0, ...testKeys.flatMap((k) => RUNNERS.map((r) => tests[k][r].length)));
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>pm2 vs Watt results</title>
<style>
:root{color-scheme:light;--surface:#fcfcfb;--card:#ffffff;--border:#e4e3df;--text:#0b0b0b;--text2:#52514e;--muted:#7a7974;
 --pm2:#eb6834;--watt:#2a78d6;--daemon:#4a3aa7;--win:#1a7f37;--loss:#b42318;--flatc:#52514e}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--surface:#1a1a19;--card:#232321;--border:#383835;--text:#ffffff;--text2:#c3c2b7;--muted:#97968f;
 --pm2:#d95926;--watt:#3987e5;--daemon:#9085e9;--win:#5cc97a;--loss:#f2837b;--flatc:#c3c2b7}}
:root[data-theme="dark"]{color-scheme:dark;--surface:#1a1a19;--card:#232321;--border:#383835;--text:#ffffff;--text2:#c3c2b7;--muted:#97968f;
 --pm2:#d95926;--watt:#3987e5;--daemon:#9085e9;--win:#5cc97a;--loss:#f2837b;--flatc:#c3c2b7}
*{box-sizing:border-box}
body{margin:0;background:var(--surface);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1080px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:28px;margin:0 0 4px;letter-spacing:-.01em}h2{font-size:19px;margin:40px 0 4px}
.sub,.note,.muted{color:var(--text2)}.note{margin:0 0 14px;font-size:14px}
.legend{display:flex;gap:18px;margin:14px 0 0;font-size:14px;color:var(--text2)}
.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:24px}
.tile{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
.big{font-size:30px;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.cap{font-size:13px;color:var(--text2);line-height:1.35}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:12px}
.card{margin:0;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px 16px}
figcaption{font-size:14px;margin-bottom:8px}
svg{display:block;overflow:visible;max-width:340px}
.bar.pm2{fill:var(--pm2)}.bar.watt{fill:var(--watt)}.bar.daemon{fill:var(--daemon)}
.axis{stroke:var(--border);stroke-width:1}
.whisker line{stroke:var(--text);stroke-opacity:.55;stroke-width:1.5}
.lbl{fill:var(--text2);font-size:13px}.val{fill:var(--text);font-size:13px;font-variant-numeric:tabular-nums;font-weight:600}
.hit{fill:transparent;cursor:default}.hit:hover{fill:var(--text);fill-opacity:.04}
.delta{display:inline-block;margin-top:10px;font-size:13px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid currentColor}
.delta.win{color:var(--win)}.delta.loss{color:var(--loss)}.delta.flat{color:var(--flatc)}
.tablewrap{overflow-x:auto;border:1px solid var(--border);border-radius:12px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}
th,td{padding:8px 10px;text-align:right;border-bottom:1px solid var(--border);white-space:nowrap}
th:nth-child(-n+2),td:nth-child(-n+2){text-align:left}th{color:var(--text2);font-weight:600}
tr:last-child td{border-bottom:0}
code{font-size:13px}
#tip{position:fixed;pointer-events:none;background:var(--text);color:var(--surface);font-size:12px;padding:6px 9px;border-radius:6px;opacity:0;transition:opacity .1s;max-width:280px;z-index:9}
footer{margin-top:40px;font-size:13px;color:var(--muted)}
</style></head><body><main>
<h1>pm2 vs Watt</h1>
<div class="sub">Same NestJS app, same machine, one runner at a time · run <code>${esc(path.basename(path.resolve(dir)))}</code> · ${runs} repeat${runs === 1 ? '' : 's'} per test</div>
<div class="legend"><span><i style="background:var(--pm2)"></i>pm2 cluster mode</span><span><i style="background:var(--watt)"></i>Watt (worker threads + SO_REUSEPORT)</span></div>
${headline()}
${metricSection('rps', 'Throughput', 'req/s', 0, 'higher', 'Requests per second at fixed concurrency. Higher is better. Whiskers show the range across repeats.')}
${metricSection('p99', 'Tail latency (p99)', 'ms', 1, 'lower', '99th-percentile response time in milliseconds. Lower is better.')}
${serverSection()}
${balanceSection()}
${table()}
<footer>Generated by scripts/report.mjs from k6 summaries, collect-metrics.mjs samples and balance.mjs counts.</footer>
</main><div id="tip" role="tooltip"></div>
<script>
const tip=document.getElementById('tip');
document.addEventListener('mousemove',e=>{const t=e.target.closest('[data-tip]');
 if(!t){tip.style.opacity=0;return}tip.textContent=t.dataset.tip;tip.style.opacity=1;
 const x=Math.min(e.clientX+14,innerWidth-tip.offsetWidth-8);tip.style.left=x+'px';tip.style.top=(e.clientY+14)+'px';});
</script></body></html>`;

const out = path.join(dir, 'report.html');
writeFileSync(out, html);
console.log(`Report: ${out}`);
