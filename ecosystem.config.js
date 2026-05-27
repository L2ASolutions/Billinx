module.exports = {
  apps: [
    {
      name: 'billinx-api',
      script: 'dist/src/main.js',
      cwd: '/workspaces/Billinx',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
      // Codespace has 8 GB RAM; give the API 3 GB heap.
      // The old 1536 MB limit was identical to Node's default and was
      // causing repeated OOM crashes under normal dev load.
      max_memory_restart: '2800M',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
        NODE_OPTIONS: '--max-old-space-size=3072',
        WORKER_CONCURRENCY: '1',
        BULK_WORKER_CONCURRENCY: '1',
        WEBHOOK_WORKER_CONCURRENCY: '1',
      },
    },
    {
      name: 'billinx-web',
      script: 'node_modules/.bin/next',
      args: 'start -p 3001',
      cwd: '/workspaces/Billinx/apps/web',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        API_URL: 'http://localhost:3000',
      },
    },
  ],
};
