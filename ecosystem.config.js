module.exports = {
  apps: [
    {
      name: 'scopa',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,            // Su 1/8 OCPU cluster peggiora — single instance
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      // OOM protection: pm2 riavvia se supera 800M (su 1GB RAM)
      max_memory_restart: '800M',
      // Node heap cap: V8 non alloca oltre, evita OOM kill dall'OS
      node_args: '--max-old-space-size=768',
      min_uptime: '30s',
      max_restarts: 10,
      restart_delay: 2000,
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      // Log
      out_file: './logs/scopa-out.log',
      error_file: './logs/scopa-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      time: true,
      // Health check (pm2 ping al processo)
      kill_timeout: 5000,
      listen_timeout: 10000
    }
  ]
};
