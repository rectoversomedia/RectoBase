// =============================================================================
// RectoBase PM2 Ecosystem Configuration
// Production process manager configuration
// =============================================================================

module.exports = {
  /**
   * Application instances configuration
   * Single server deployment - can scale horizontally later
   */
  apps: [
    {
      // ─── Identitas Aplikasi ───────────────────────────────────────────────
      name: 'rectobase',
      script: 'dist/index.js',

      // Working directory
      cwd: '/opt/rectobase',

      // ─── Execution Mode ───────────────────────────────────────────────────
      // cluster mode untuk multi-core utilization
      // instances: 1 untuk single-server deployment
      instances: 1,
      exec_mode: 'cluster',

      // ─── Resource Limits ──────────────────────────────────────────────────
      // Restart jika memory melebihi 512MB
      max_memory_restart: '512M',

      // ─── Environment Variables ─────────────────────────────────────────────
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        // Load dari /etc/rectobase/env
      },

      // ─── Logging ───────────────────────────────────────────────────────────
      // Merge semua worker logs ke satu file
      merge_logs: true,

      // Log file paths
      log_file: '/var/log/rectobase/app.log',
      error_file: '/var/log/rectobase/error.log',
      out_file: '/var/log/rectobase/out.log',

      // Log format dengan timestamp
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // PID file
      pid_file: '/var/run/rectobase.pid',

      // ─── Restart Policy ────────────────────────────────────────────────────
      // Watch disabled untuk production
      watch: false,

      // Ignore watch directories
      ignore_watch: [
        'node_modules',
        '.git',
        'logs',
        'uploads',
        '.cache',
        'dist', // Watch rebuilds, not source
      ],

      // Max restart attempts dalam waktu singkat
      max_restarts: 10,
      min_uptime: '60s',

      // Delay antar restart (ms)
      restart_delay: 4000,

      // Auto restart saat crash
      autorestart: true,

      // ─── Timeouts ─────────────────────────────────────────────────────────
      // Waktu max untuk aplikasi acknowledge start
      listen_timeout: 8000,

      // Waktu max untuk graceful shutdown
      kill_timeout: 5000,

      // ─── Advanced Options ──────────────────────────────────────────────────
      // Metrik untuk pm2-server-monit (optional)
      instance_var: 'INSTANCE_ID',

      // ─── Source Map Support ────────────────────────────────────────────────
      // Aktifkan jika ada source maps di build
      source_map_support: true,

      // ─── Post-deploy Actions ───────────────────────────────────────────────
      // Dijalankan setelah pm2 start/restart
      post_update: [
        'npm run migrate && pm2 restart rectobase',
      ],

      // ─── Shutdown ─────────────────────────────────────────────────────────
      // Graceful shutdown command
      // shutdown_with_message: false, // default: false

      // ─── Node Flags ───────────────────────────────────────────────────────
      node_args: [
        '--max-old-space-size=450',
        '--expose-gc',
        // '--inspect' // Uncomment untuk remote debugging
      ],

      // ─── Env File ─────────────────────────────────────────────────────────
      // Load dari external env file
      env_production_file: '/etc/rectobase/env',
    },
  ],

  /**
   * Deployment Configuration
   * Dijalankan oleh: pm2 deploy ecosystem.config.js production setup
   */
  deploy: {
    production: {
      user: 'rectobase',
      host: '0.0.0.0',
      port: 22,
      ref: 'origin/main',
      repo: 'git@github.com:rectobase/rectobase.git',
      path: '/opt/rectobase',
      'pre-deploy-local': '',
      'post-deploy':
        'source /etc/rectobase/env && npm ci --production && npm run migrate && pm2 restart rectobase',
      'pre-setup': '',
      'ssh_options':
        'StrictHostKeyChecking=no',
      'post-setup':
        'chown -R rectobase:rectobase /opt/rectobase && pm2 start ecosystem.config.js && pm2 save',
    },
    staging: {
      user: 'rectobase',
      host: '0.0.0.0',
      port: 22,
      ref: 'origin/staging',
      repo: 'git@github.com:rectobase/rectobase.git',
      path: '/opt/rectobase-staging',
      'pre-deploy-local': '',
      'post-deploy':
        'source /etc/rectobase/env.staging && npm ci --production && npm run migrate && pm2 restart rectobase-staging',
      'pre-setup': '',
      'ssh_options':
        'StrictHostKeyChecking=no',
      'post-setup':
        'chown -R rectobase:rectobase /opt/rectobase-staging && pm2 start ecosystem.config.js && pm2 save',
    },
  },
};
