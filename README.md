# pm2 vs Watt — a NestJS load test

Same NestJS app, same build, same machine. The only thing that changes is the runner:

- **pm2 cluster mode**: one primary process accepts every connection and hands it to a worker *process* over IPC (round-robin).
- **Watt (`wattpm`)**: workers are *threads* in one process; each opens its own socket with `SO_REUSEPORT`, and the Linux kernel spreads connections between them.

Inspired by Booking.com's write-up on replacing pm2 with Watt.

## What's inside

```
app/                  NestJS app + both runner configs
  src/bench.controller.ts   4 endpoints (below)
  ecosystem.config.js       pm2 cluster config
  watt.json                 Watt config (@platformatic/nest)
k6/
  throughput.js       max throughput at fixed concurrency
  steps.js            fixed request rate at 50/80/100/120% of max
scripts/
  app.sh              start/stop a runner on the app instance
  run-all.sh          full test matrix from the load generator
  balance.mjs         requests-per-worker check
  collect-metrics.mjs CPU% + RSS per process, sampled to CSV
  summarize.js        merges results into one comparison table (SUMMARY.md)
  report.mjs          builds report.html: charts + table, for screenshots
monitoring/           Prometheus + Grafana (separate instance) and app-side exporters
  grafana/dashboards/pm2-vs-watt.json   live dashboard, loaded automatically
results/              output of each run
```

| Endpoint | Work | What it shows |
|---|---|---|
| `GET /ping` | returns `{ok:true}` | pure runtime overhead — where Watt should win most |
| `GET /cpu` | sort + JSON round-trip of 5,000 objects | CPU-bound work (tune with `CPU_ITEMS`) |
| `GET /io` | awaits a 20 ms timer | typical DB-waiting API (tune with `IO_DELAY_MS`) |
| `GET /whoami` | returns `pid:threadId` | which worker served the request |

## Important: run the real test on Linux

Watt only enables `SO_REUSEPORT` on **Linux with Node.js ≥ 22.12**. On macOS or Windows it falls back to a different mode, so a laptop run does not test what Booking.com tested. Use your Mac to try things out; use EC2 for numbers.

## Quick start (any machine)

```bash
cd app
npm install
npm run build

# pm2
WORKERS=2 npx pm2 start ecosystem.config.js
curl localhost:3000/whoami
npx pm2 delete bench

# Watt  (PLT_WORKERS sets the thread count; for plain `npx wattpm start`, first: cp .env.example .env)
PLT_WORKERS=2 npx wattpm start
curl localhost:3000/whoami
```

Or use the helper from the repo root: `./scripts/app.sh start pm2`, `./scripts/app.sh start watt`, `./scripts/app.sh stop`. It uses one worker per vCPU unless you set `WORKERS`.

## AWS setup

| Role | Instance | Why |
|---|---|---|
| App | `c7i.large` (2 vCPU) | Compute-optimized, no CPU credits. **Not T-series**: burst credits would throttle mid-test. |
| Load generator | `c7i.large` or larger | Must never be the bottleneck. Keep its CPU under ~70%. |
| Monitoring | `t3.small` | Mostly idle — burstable is fine here. |

All three in the same VPC/AZ; app in a private subnet. App security group allows `3000` (app) from the load generator, and `9100`, `9256`, `9091` (metrics) from the monitoring instance. Monitoring allows `9090` (k6 push) from the load generator and `3001` (Grafana) from wherever you tunnel in.

**App instance**
```bash
# Node 22 LTS (>= 22.12), git, docker
git clone <your-repo> ~/pm2-vs-watt
cd ~/pm2-vs-watt/app && npm ci && npm run build
cd .. && docker compose -f monitoring/app-exporters.compose.yml up -d
```

**Monitoring instance**
```bash
cd ~/pm2-vs-watt/monitoring
# edit prometheus.yml: replace 10.0.2.10 with the app's private IP
docker compose up -d        # Grafana on :3001 (admin/admin)
```

**Load generator**
```bash
# install k6 and Node 22; ssh key that can reach the app instance
git clone <your-repo> ~/pm2-vs-watt && cd ~/pm2-vs-watt
TARGET=http://<app-private-ip>:3000 \
APP_SSH=ec2-user@<app-private-ip> \
PROM_URL=http://<monitoring-private-ip>:9090 \
  ./scripts/run-all.sh
```
`PROM_URL` makes k6 push its live numbers to Prometheus, tagged with runner, endpoint, connection mode and run id. Leave it out if you only want the files.

## The test matrix

`run-all.sh` runs runners × endpoints × connection modes × repeats, alternating pm2/Watt order each repeat:

| Variable | Default | Env var |
|---|---|---|
| Endpoints | `ping cpu io` | `ENDPOINTS` |
| Connection mode | `ka` (keep-alive), `new` (new TCP connection per request) | `MODES` |
| Repeats | 3 | `REPEATS` |
| Concurrency | 100 VUs | `VUS` |
| Warmup / measured | 60s / 2m per test | `WARMUP`, `DURATION` |

Full run ≈ 1h15m. For each runner/repeat it also runs the balance check and saves process CPU/RSS samples.

## Seeing the results

There are two views. Use Grafana **during** the run, and the report **after** it.

### 1. Live: Grafana dashboard "pm2 vs Watt"

Open `http://<monitoring-ip>:3001` → Dashboards → Benchmarks → **pm2 vs Watt**. Grafana sits in a private subnet, so reach it with an SSH tunnel through the load generator (or a bastion):

```bash
ssh -L 3001:<monitoring-private-ip>:3001 ec2-user@<load-generator-public-ip>
# then open http://localhost:3001
```

Filters at the top pick the **Run**, **Endpoint** and **Connection** mode.

| Row | Panels | Source |
|---|---|---|
| Load (k6) | peak req/s, worst p99, error rate; req/s and p50/p99 over time, per runner | k6 → Prometheus |
| App server | peak memory (pm2 total vs Watt), **pm2 daemon CPU**, machine CPU; CPU and memory per process group, stacked | process-exporter, node_exporter |
| Watt internals | event-loop utilization and lag per worker thread | Watt's `/metrics` |

The two moments to watch: machine CPU reaching ~100% (that's when the gap opens) and the violet **pm2-daemon** slice in the CPU chart (the hand-off overhead Watt removes). If one Watt worker's event-loop line sits far above the others, connections aren't being spread evenly.

### 2. After the run: files in `results/<timestamp>/`

| File | What it is |
|---|---|
| `report.html` | **Open this.** Headline numbers, pm2-vs-Watt bar charts per test (throughput, p99, memory, hand-off CPU, worker balance) and a full table. Works offline, has a dark mode, and is good for screenshots. |
| `SUMMARY.md` | The same table as Markdown |
| `<runner>_<endpoint>_<conn>_r<n>.json / .log` | k6 summary per test |
| `<runner>_r<n>.procs.csv` | CPU % and RSS per process, every 2 s |
| `<runner>_balance_r<n>.txt / .json` | requests per worker |

Copy the folder to your laptop to open the report:
```bash
scp -r ec2-user@<load-generator-ip>:~/pm2-vs-watt/results/<timestamp> .
```
Rebuild it any time with `node scripts/report.mjs results/<timestamp>`.

**Latency vs load** (where the difference appears): first get `MAX_RPS` for pm2 from the summary, then for each runner:
```bash
k6 run -e TARGET=http://<app-ip>:3000 -e ENDPOINT=ping -e MAX_RPS=<max> k6/steps.js
```


**nginx round** (optional): put nginx in front of the app on the same instance, point `TARGET` at nginx, and rerun `node scripts/balance.mjs http://<nginx>:80 --new`. A `max/ideal ratio` well above 1.0 under Watt is the Booking.com imbalance.

## Fairness checklist

- [ ] Same instance, one runner at a time, same `WORKERS` = vCPU count
- [ ] Same Node version, `NODE_ENV=production`, same `dist/` build
- [ ] Load generator on a separate instance, CPU < 70% during runs
- [ ] Warmup before every measured run (built into `run-all.sh`)
- [ ] ≥ 3 repeats, report averages
- [ ] Report all results, including the ones where the two are equal

## Notes

- Under Watt, `src/main.ts` is not used: `@platformatic/nest` boots `AppModule` directly. Anything you add to `main.ts` (global prefix, pipes) must also go into a Watt `setup` file — see the `@platformatic/nest` docs.
- `APP_SSH=local ./scripts/run-all.sh` runs everything on one machine. Good for checking the scripts work; the numbers are meaningless because k6 and the app share CPU.
- Terminate all instances when you are done.
