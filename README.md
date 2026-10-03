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

You need Node.js 22.12 or newer and [k6](https://k6.io).

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

## Start one runner by hand

Run from the repo root:

```bash
WORKERS=2 ./scripts/app.sh start pm2     # or: start watt
curl localhost:3000/whoami
./scripts/app.sh stop
```

## Run the test

Everything on one machine, short version (about 5 minutes):

```bash
TARGET=http://localhost:3000 APP_SSH=local WORKERS=2 \
REPEATS=1 WARMUP=5s DURATION=20s \
  ./scripts/run-all.sh
```

This starts pm2, tests it, then does the same for Watt. Remove the second line for the full run (about 1h15m).

To test an app on another machine, use its address and SSH login instead. The repo must be at `~/pm2-vs-watt` on that machine, already built.

```bash
TARGET=http://<app-ip>:3000 APP_SSH=<user>@<app-ip> ./scripts/run-all.sh
```

When it finishes, open `results/<timestamp>/report.html`.
