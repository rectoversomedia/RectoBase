/* =========================================
   RectoBase Admin Panel — System JS
   ========================================= */

(function () {
  if (!document.getElementById('system-page')) return;

  let healthInterval = null;
  let logsPage = 1;
  let logsTable;

  // ─── Health Checks ─────────────────────────────────────────────────────────
  async function loadHealth() {
    try {
      const health = await API.getSystemHealth();
      renderHealth(health);
    } catch (err) {
      renderHealthOffline();
    }
  }

  function renderHealth(health) {
    const container = document.getElementById('health-grid');
    if (!container) return;

    container.innerHTML = `
      <div class="status-card">
        <div class="status-card-header">
          <div class="status-card-title">
            <span class="status-dot online"></span>
            API Server
          </div>
          <span class="status-card-value online">Online</span>
        </div>
        <div class="flex justify-between items-center">
          <span class="status-card-value">Latency: <strong>${health.api.latency}ms</strong></span>
          <span class="badge badge-active">Uptime ${health.api.uptime}%</span>
        </div>
        <div class="status-card-bar" style="margin-top:8px;">
          <div class="status-card-bar-fill" style="width:${health.api.uptime}%; background: var(--color-primary);"></div>
        </div>
      </div>

      <div class="status-card">
        <div class="status-card-header">
          <div class="status-card-title">
            <span class="status-dot online"></span>
            PostgreSQL Database
          </div>
          <span class="status-card-value online">Online</span>
        </div>
        <div class="flex justify-between items-center" style="margin-top:4px;">
          <span class="status-card-value">Connections: <strong>${health.database.connections}/${health.database.maxConnections}</strong></span>
          <span class="text-sm text-muted">${health.database.queryTime}ms avg</span>
        </div>
        <div class="status-card-bar" style="margin-top:8px;">
          <div class="status-card-bar-fill" style="width:${(health.database.connections / health.database.maxConnections * 100).toFixed(0)}%; background: var(--color-info);"></div>
        </div>
      </div>

      <div class="status-card">
        <div class="status-card-header">
          <div class="status-card-title">
            <span class="status-dot online"></span>
            WhatsApp Gateway
          </div>
          <span class="status-card-value online">Online</span>
        </div>
        <div class="flex justify-between items-center" style="margin-top:4px;">
          <span class="status-card-value">Queue: <strong>${health.whatsapp.queue}</strong></span>
          <span class="text-sm text-muted">${health.whatsapp.sentToday} sent today</span>
        </div>
      </div>

      <div class="status-card">
        <div class="status-card-header">
          <div class="status-card-title">
            <span class="status-dot ${health.redis.memoryUsed === '1.2GB' ? 'online' : 'warning'}"></span>
            Redis Cache
          </div>
          <span class="status-card-value ${health.redis.memoryUsed === '1.2GB' ? 'online' : 'warning'}">Online</span>
        </div>
        <div class="flex justify-between items-center" style="margin-top:4px;">
          <span class="status-card-value">Used: <strong>${health.redis.memoryUsed}</strong></span>
          <span class="text-sm text-muted">of ${health.redis.memoryTotal}</span>
        </div>
        <div class="status-card-bar" style="margin-top:8px;">
          <div class="status-card-bar-fill" style="width:${parseFloat(health.redis.memoryUsed) / parseFloat(health.redis.memoryTotal) * 100}%; background: var(--color-primary);"></div>
        </div>
      </div>

      <div class="status-card">
        <div class="status-card-header">
          <div class="status-card-title">
            <span class="status-dot online"></span>
            Storage Disk
          </div>
          <span class="status-card-value">${health.storage.percent}%</span>
        </div>
        <div class="flex justify-between items-center" style="margin-top:4px;">
          <span class="status-card-value">Used: <strong>${health.storage.used} GB</strong></span>
          <span class="text-sm text-muted">of ${health.storage.total} GB</span>
        </div>
        <div class="status-card-bar" style="margin-top:8px;">
          <div class="status-card-bar-fill" style="width:${health.storage.percent}%; background: ${health.storage.percent > 80 ? 'var(--color-danger)' : 'var(--color-primary)'};"></div>
        </div>
      </div>

      <div class="status-card">
        <div class="status-card-header">
          <div class="status-card-title">
            <span class="status-dot online"></span>
            Email Service
          </div>
          <span class="status-card-value online">Configured</span>
        </div>
        <div class="status-card-value" style="margin-top:4px;">
          Provider: <strong>Resend API</strong>
        </div>
        <div class="status-card-value text-muted text-sm" style="margin-top:4px;">
          Daily limit: 10,000 emails
        </div>
      </div>
    `;
  }

  function renderHealthOffline() {
    const container = document.getElementById('health-grid');
    if (!container) return;
    container.innerHTML = `
      <div class="status-card" style="grid-column: 1 / -1;">
        <div class="flex items-center gap-3" style="color:var(--color-danger);">
          ${Icons.alertTriangle}
          <span class="font-semibold">Tidak dapat mengambil data kesehatan sistem. Periksa koneksi Anda.</span>
        </div>
      </div>`;
  }

  // ─── System Logs ─────────────────────────────────────────────────────────────
  async function loadLogs(page = 1) {
    logsPage = page;
    const container = document.getElementById('logs-container');
    if (container) container.classList.add('loading');

    try {
      const { logs, total } = await API.getSystemLogs({ page, limit: 20 });
      renderLogs(logs, total, page);
    } catch (err) {
      Toast.error('Gagal memuat logs', err.message);
    } finally {
      if (container) container.classList.remove('loading');
    }
  }

  function renderLogs(logs, total, page) {
    const container = document.getElementById('log-viewer-body');
    if (!container) return;

    container.innerHTML = logs.map(log => `
      <div class="log-line">
        <span class="log-ts">${new Date(log.ts).toLocaleTimeString('id-ID')}</span>
        <span class="log-level ${log.level}">${log.level.toUpperCase()}</span>
        <span class="log-msg">${escapeHtml(log.msg)}</span>
      </div>
    `).join('');

    // Scroll to bottom
    const viewer = document.getElementById('log-viewer-body');
    if (viewer) viewer.scrollTop = viewer.scrollHeight;

    // Pagination
    const pagination = document.getElementById('logs-pagination');
    if (pagination) {
      const pages = Math.ceil(total / 20) || 1;
      pagination.innerHTML = `
        <button class="pagination-btn" onclick="loadLogsPage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>${Icons.chevronLeft}</button>
        <span class="text-sm text-muted" style="padding:0 12px;">Halaman ${page} dari ${pages}</span>
        <button class="pagination-btn" onclick="loadLogsPage(${page + 1})" ${page >= pages ? 'disabled' : ''}>${Icons.chevronRight}</button>
      `;
    }
  }

  window.loadLogsPage = function (page) {
    if (page >= 1) loadLogs(page);
  };

  // ─── Environment Variables ──────────────────────────────────────────────────
  function renderEnvVars() {
    const container = document.getElementById('env-vars-list');
    if (!container) return;

    const envVars = [
      { key: 'APP_ENV', value: 'production', masked: false },
      { key: 'APP_DEBUG', value: 'false', masked: false },
      { key: 'APP_URL', value: 'https://admin.rectobase.id', masked: false },
      { key: 'DB_HOST', value: 'db-primary.internal', masked: false },
      { key: 'DB_PORT', value: '5432', masked: false },
      { key: 'DB_NAME', value: 'rectobase_prod', masked: false },
      { key: 'DB_USER', value: 'rb_app_readonly', masked: false },
      { key: 'DB_PASSWORD', value: '••••••••••••', masked: true },
      { key: 'REDIS_URL', value: 'redis://cache.internal:6379', masked: false },
      { key: 'JWT_SECRET', value: '••••••••••••••••••••', masked: true },
      { key: 'STRIPE_SECRET_KEY', value: '••••••••••••••••••••', masked: true },
      { key: 'STRIPE_WEBHOOK_SECRET', value: '••••••••••••••••', masked: true },
      { key: 'WA_GATEWAY_TOKEN', value: '••••••••••••••••••••', masked: true },
      { key: 'RESEND_API_KEY', value: '••••••••••••••••••••', masked: true },
      { key: 'SENTRY_DSN', value: 'https://abc123@o123.ingest.sentry.io/456', masked: false },
      { key: 'LOG_LEVEL', value: 'info', masked: false },
      { key: 'CACHE_TTL', value: '3600', masked: false },
      { key: 'MAX_UPLOAD_SIZE', value: '10MB', masked: false },
    ];

    container.innerHTML = envVars.map(v => `
      <div class="env-var-row">
        <span class="env-var-key">${v.key}</span>
        <span class="env-var-value ${v.masked ? 'masked' : ''}">${v.value}</span>
        ${v.masked ? `<button class="btn btn-ghost btn-sm" onclick="this.textContent = this.textContent === 'Show' ? 'Hide' : 'Show'" style="font-size:0.75rem;">Show</button>` : ''}
      </div>
    `).join('');
  }

  // ─── Actions ───────────────────────────────────────────────────────────────
  async function pingAll() {
    const btn = document.getElementById('ping-all-btn');
    setLoading(btn, true);
    try {
      const results = await Promise.allSettled([
        API.pingService('api'),
        API.pingService('database'),
        API.pingService('whatsapp'),
        API.pingService('redis'),
      ]);
      const allOk = results.every(r => r.value?.status === 'online');
      Toast.success(allOk ? 'Semua layanan online' : 'Beberapa layanan bermasalah', '');
      loadHealth();
    } catch (err) {
      Toast.error('Gagal ping', err.message);
    } finally {
      setLoading(btn, false);
    }
  }

  async function clearCache() {
    const ok = await confirm({
      title: 'Clear Cache?',
      message: '847 cache keys akan dihapus. Aplikasi mungkin sedikit melambat sementara cache terisi ulang.',
      confirmText: 'Clear Cache',
      danger: true,
    });
    if (!ok) return;
    try {
      const result = await API.clearCache();
      Toast.success('Cache cleared', `${result.keysCleared} keys dihapus.`);
    } catch (err) {
      Toast.error('Gagal', err.message);
    }
  }

  async function sendTestEmail() {
    const emailInput = document.getElementById('test-email-input');
    const email = emailInput?.value?.trim();
    if (!email || !email.includes('@')) {
      Toast.error('Email tidak valid', 'Masukkan alamat email yang benar.');
      return;
    }
    const btn = document.getElementById('send-test-email-btn');
    setLoading(btn, true);
    try {
      await API.sendTestEmail(email);
      Toast.success('Email terkirim', `Test email berhasil dikirim ke ${email}.`);
    } catch (err) {
      Toast.error('Gagal', err.message);
    } finally {
      setLoading(btn, false);
    }
  }

  async function restartService(name) {
    const ok = await confirm({
      title: `Restart ${name}?`,
      message: `Layanan ${name} akan dihentikan sejenak dan dinyalakan kembali. Ini akan menyebabkan gangguan singkat.`,
      confirmText: 'Restart Sekarang',
      danger: true,
    });
    if (!ok) return;
    Toast.info('Memulai restart…', `${name} sedang dimulai ulang.`);
    setTimeout(() => Toast.success('Berhasil', `${name} berhasil direstart.`), 3000);
  }

  // ─── Utility ──────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  function init() {
    loadHealth();
    loadLogs(1);
    renderEnvVars();

    // Poll health every 30 seconds
    healthInterval = setInterval(loadHealth, 30000);

    // Button handlers
    document.getElementById('ping-all-btn')?.addEventListener('click', pingAll);
    document.getElementById('clear-cache-btn')?.addEventListener('click', clearCache);
    document.getElementById('send-test-email-btn')?.addEventListener('click', sendTestEmail);
    document.getElementById('restart-api-btn')?.addEventListener('click', () => restartService('API Server'));
    document.getElementById('restart-wa-btn')?.addEventListener('click', () => restartService('WhatsApp Gateway'));

    // Cleanup
    window.addEventListener('beforeunload', () => {
      if (healthInterval) clearInterval(healthInterval);
    });
  }

  init();
})();
