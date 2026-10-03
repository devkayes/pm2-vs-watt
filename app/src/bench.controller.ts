import { Controller, Get } from '@nestjs/common';
import { threadId, isMainThread } from 'node:worker_threads';
import { cpuWork, ioWork } from './workload';

@Controller()
export class BenchController {
  /** Pure runtime overhead: where the process model matters most. */
  @Get('ping')
  ping() {
    return { ok: true };
  }

  /** CPU-bound: sort + JSON round-trip of a fixed-size array. */
  @Get('cpu')
  cpu() {
    return cpuWork();
  }

  /** I/O-bound: awaits a timer that stands in for a DB call. */
  @Get('io')
  async io() {
    await ioWork();
    return { ok: true };
  }

  /** Which worker served this request? Used to check load balance. */
  @Get('whoami')
  whoami() {
    return {
      pid: process.pid,
      threadId,
      worker: `${process.pid}:${threadId}`,
      mode: isMainThread ? 'process' : 'thread',
    };
  }
}
