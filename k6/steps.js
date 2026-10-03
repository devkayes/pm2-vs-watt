// Stepped-load test: fixed request rate at 50/80/100/120% of MAX_RPS.
// Shows where latency starts to diverge between pm2 and Watt.
//
//   k6 run -e TARGET=http://10.0.2.10:3000 -e ENDPOINT=ping -e MAX_RPS=8000 k6/steps.js
//
// MAX_RPS: measure first with throughput.js against pm2.
import http from 'k6/http';
import { check } from 'k6';

const TARGET = __ENV.TARGET || 'http://localhost:3000';
const ENDPOINT = __ENV.ENDPOINT || 'ping';
const MAX = Number(__ENV.MAX_RPS || 1000);
const REUSE = (__ENV.REUSE || '1') === '1';
const HOLD = __ENV.HOLD || '2m';

const step = (pct) => [
  { target: Math.round(MAX * pct), duration: '30s' },
  { target: Math.round(MAX * pct), duration: HOLD },
];

export const options = {
  noConnectionReuse: !REUSE,
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    steps: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 2000,
      stages: [...step(0.5), ...step(0.8), ...step(1.0), ...step(1.2)],
    },
  },
};

export default function () {
  const res = http.get(`${TARGET}/${ENDPOINT}`);
  check(res, { 'status 200': (r) => r.status === 200 });
}
