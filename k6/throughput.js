// Max-throughput test: a fixed number of virtual users hammer one endpoint.
// Measures requests/sec and latency at saturation.
//
//   k6 run -e TARGET=http://10.0.2.10:3000 -e ENDPOINT=ping -e REUSE=1 k6/throughput.js
//
// ENDPOINT : ping | cpu | io
// REUSE    : 1 = keep-alive connections, 0 = new TCP connection per request
// VUS      : concurrent virtual users (default 100)
// DURATION : test duration (default 2m). Do a short warmup run first.
import http from 'k6/http';
import { check } from 'k6';

const TARGET = __ENV.TARGET || 'http://localhost:3000';
const ENDPOINT = __ENV.ENDPOINT || 'ping';
const REUSE = (__ENV.REUSE || '1') === '1';
const VUS = Number(__ENV.VUS || 100);
const DURATION = __ENV.DURATION || '2m';

export const options = {
  noConnectionReuse: !REUSE,
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
  vus: VUS,
  duration: DURATION,
};

export default function () {
  const res = http.get(`${TARGET}/${ENDPOINT}`);
  check(res, { 'status 200': (r) => r.status === 200 });
}
