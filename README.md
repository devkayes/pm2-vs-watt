# pm2 vs Watt

A small load test: the same NestJS app run two ways.

- **pm2**: several worker processes behind one primary process.
- **Watt**: several worker threads in one process.

## Endpoints

| Endpoint | What it does |
|---|---|
| `GET /ping` | returns `{ok:true}` |
| `GET /cpu` | CPU-heavy work |
| `GET /io` | waits 20 ms, like a database call |
| `GET /whoami` | shows which worker answered |

## Setup

You need Node.js 22.19 or newer and [k6](https://k6.io).

```bash
cd app
npm install
npm run build
```

## Dev mode

```bash
cd app
npm run dev      # http://localhost:3000, restarts on file changes
```

## Config

All settings live in one file:

```bash
cp .env.example .env
```

| Setting | Meaning |
|---|---|
| `APP_HOST` | IP of the app machine. Empty = everything on this machine. |
| `APP_USER` | SSH user on the app machine |
| `PROM_URL` | Prometheus address. Empty = no Grafana. |
| `MODES`, `REPEATS`, `WARMUP`, `DURATION` | test settings |

## Run the test

```bash
docker compose --env-file .env -f monitoring/docker-compose.yml up -d   # Grafana, optional
./scripts/run-all.sh
```

This starts pm2, tests it, then does the same for Watt.

- Live dashboard: `http://localhost:3001/d/pm2-vs-watt` (admin / admin)
- Report when it finishes: `results/<timestamp>/report.html`

The full run takes about 20 minutes. For a 2-minute check that everything is connected:

```bash
./scripts/run-all.sh quick
```

When `APP_HOST` is another machine, the repo must be at `~/pm2-vs-watt` there, already built, and reachable over SSH without a password.
