// pm2 cluster mode: one primary process accepts connections and hands them
// to WORKERS child processes (round-robin over IPC).
const WORKERS = Number(process.env.WORKERS ?? require('node:os').availableParallelism());

module.exports = {
  apps: [
    {
      name: 'bench',
      script: 'dist/main.js',
      exec_mode: 'cluster',
      instances: WORKERS,
      env: { NODE_ENV: 'production', PORT: 3000 },
      max_memory_restart: '1G',
    },
  ],
};
