/* =========================================
   RectoBase Admin Panel — Dashboard JS
   ========================================= */

(function () {
  if (!document.getElementById('dashboard-page')) return;

  let revenueChart = null;
  let growthChart = null;

  // ─── Stats Cards ──────────────────────────────────────────────────────────
  async function loadStats() {
    try {
      const data = await API.getStats();

      const stats = [
        {
          id: 'totalMerchants',
          label: 'Total Merchant',
          value: data.totalMerchants,
          change: '+12.4%',
          trend: 'up',
          icon: Icons.merchants,
          iconCls: 'green',
        },
        {
          id: 'activeSubscriptions',
          label: 'Active Subscription',
          value: data.activeSubscriptions,
          change: '+8.2%',
          trend: 'up',
          icon: Icons.zap,
          iconCls: 'blue',
        },
        {
          id: 'mrr',
          label: 'Monthly Recurring Revenue',
          value: Format.currency(data.mrr),
          change: '+15.7%',
          trend: 'up',
          icon: Icons.dollarSign,
          iconCls: 'green',
        },
        {
          id: 'trialMerchants',
          label: 'Trial Merchant',
          value: data.trialMerchants,
          change: '-5.1%',
          trend: 'down',
          icon: Icons.activity,
          iconCls: 'amber',
        },
      ];

      const container = document.getElementById('stats-grid');
      if (!container) return;

      container.innerHTML = stats.map(s => `
        <div class="stat-card">
          <div class="stat-icon ${s.iconCls}">${s.icon}</div>
          <div class="stat-content">
            <div class="stat-label">${s.label}</div>
            <div class="stat-value">${s.value}</div>
            <span class="stat-change ${s.trend}">${s.trend === 'up' ? Icons.trendingUp : Icons.trendingDown} ${s.change} bulan ini</span>
          </div>
        </div>
      `).join('');
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }

  // ─── Revenue Chart ──────────────────────────────────────────────────────────
  async function loadRevenueChart() {
    try {
      const data = await API.getRevenue();
      const ctx = document.getElementById('revenueChart');
      if (!ctx) return;

      if (revenueChart) revenueChart.destroy();

      revenueChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: data.labels,
          datasets: [
            {
              label: 'Revenue (jt)',
              data: data.revenue.map(v => v / 1000000),
              borderColor: '#16a34a',
              backgroundColor: 'rgba(22, 163, 74, 0.08)',
              borderWidth: 2.5,
              pointRadius: 4,
              pointBackgroundColor: '#16a34a',
              pointBorderColor: '#ffffff',
              pointBorderWidth: 2,
              fill: true,
              tension: 0.4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false,
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#0f172a',
              titleColor: '#e2e8f0',
              bodyColor: '#94a3b8',
              borderColor: '#1e293b',
              borderWidth: 1,
              padding: 12,
              callbacks: {
                label: (ctx) => ` Revenue: Rp ${ctx.parsed.y.toFixed(1)} jt`,
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: '#94a3b8', font: { size: 12 } },
              border: { display: false },
            },
            y: {
              grid: { color: '#f1f5f9' },
              ticks: {
                color: '#94a3b8',
                font: { size: 12 },
                callback: (v) => `Rp ${v} jt`,
              },
              border: { display: false, dash: [4, 4] },
            },
          },
        },
      });
    } catch (err) {
      console.error('Failed to load revenue chart:', err);
    }
  }

  // ─── Merchant Growth Chart ─────────────────────────────────────────────────
  async function loadGrowthChart() {
    try {
      const data = await API.getMerchantGrowth();
      const ctx = document.getElementById('growthChart');
      if (!ctx) return;

      if (growthChart) growthChart.destroy();

      growthChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: data.map(d => d.month),
          datasets: [
            {
              label: 'Merchant Count',
              data: data.map(d => d.count),
              backgroundColor: 'rgba(37, 99, 235, 0.7)',
              borderColor: '#2563eb',
              borderWidth: 1.5,
              borderRadius: 6,
              borderSkipped: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#0f172a',
              titleColor: '#e2e8f0',
              bodyColor: '#94a3b8',
              borderColor: '#1e293b',
              borderWidth: 1,
              padding: 12,
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: '#94a3b8', font: { size: 11 } },
              border: { display: false },
            },
            y: {
              grid: { color: '#f1f5f9' },
              ticks: { color: '#94a3b8', font: { size: 12 } },
              border: { display: false, dash: [4, 4] },
            },
          },
        },
      });
    } catch (err) {
      console.error('Failed to load growth chart:', err);
    }
  }

  // ─── Recent Signups ─────────────────────────────────────────────────────────
  async function loadRecentSignups() {
    try {
      const data = await API.getMerchants({ limit: 8 });
      const container = document.getElementById('recent-signups');
      if (!container) return;

      container.innerHTML = data.items.slice(0, 6).map(m => {
        const status = Format.status(m.status);
        return `
          <div class="activity-item">
            <div class="activity-icon green">${Icons.user}</div>
            <div class="activity-content">
              <div class="activity-text">
                <strong>${m.name}</strong> — ${Format.plan(m.plan)} plan
              </div>
              <div class="activity-time">${Format.date(m.created)} &middot; ${m.city}</div>
            </div>
            <span class="badge ${status.cls}">${status.label}</span>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load recent signups:', err);
    }
  }

  // ─── System Status ──────────────────────────────────────────────────────────
  async function loadSystemStatus() {
    try {
      const health = await API.getSystemHealth();
      const container = document.getElementById('system-status-grid');
      if (!container) return;

      const items = [
        { label: 'API Status', value: health.api.latency + 'ms', status: health.api.status },
        { label: 'Database', value: health.database.connections + '/' + health.database.maxConnections, status: health.database.status },
        { label: 'WhatsApp', value: health.whatsapp.sentToday + ' hari ini', status: health.whatsapp.status },
        { label: 'Redis Cache', value: health.redis.memoryUsed, status: health.redis.status },
      ];

      container.innerHTML = items.map(item => `
        <div class="status-card">
          <div class="status-card-header">
            <div class="status-card-title">
              <span class="status-dot ${item.status}"></span>
              ${item.label}
            </div>
            <span class="status-card-value ${item.status}">${item.status === 'online' ? 'Online' : 'Offline'}</span>
          </div>
          <div class="status-card-value">${item.value}</div>
        </div>
      `).join('');
    } catch (err) {
      console.error('Failed to load system status:', err);
    }
  }

  // ─── Recent Activity Feed ─────────────────────────────────────────────────
  async function loadActivityFeed() {
    try {
      const { logs } = await API.getSystemLogs({ limit: 7 });
      const container = document.getElementById('activity-feed');
      if (!container) return;

      const activityMap = {
        info: { icon: Icons.info, cls: 'blue' },
        warn: { icon: Icons.alertTriangle, cls: 'amber' },
        error: { icon: Icons.alertTriangle, cls: 'red' },
        success: { icon: Icons.check, cls: 'green' },
        debug: { icon: Icons.settings, cls: 'gray' },
      };

      container.innerHTML = logs.slice(0, 7).map(log => {
        const a = activityMap[log.level] || activityMap.info;
        return `
          <div class="activity-item">
            <div class="activity-icon ${a.cls}">${a.icon}</div>
            <div class="activity-content">
              <div class="activity-text">${log.msg}</div>
              <div class="activity-time">${Format.relative(log.ts)}</div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load activity feed:', err);
    }
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    await Promise.all([
      loadStats(),
      loadRevenueChart(),
      loadGrowthChart(),
      loadRecentSignups(),
      loadSystemStatus(),
      loadActivityFeed(),
    ]);
  }

  init();
})();
