module.exports = {
  apps: [
    {
      name: 'scopa',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
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
