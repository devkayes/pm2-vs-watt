import { Controller, Get } from '@nestjs/common';
import { threadId, isMainThread } from 'node:worker_threads';
import { cpuWork, ioWork } from './workload';

@Controller()
export class BenchController {
  @Get('ping')
  ping() {
    return { ok: true };
  }

  @Get('cpu')
  cpu() {
    return cpuWork();
  }

  @Get('io')
  async io() {
    await ioWork();
    return { ok: true };
  }

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
