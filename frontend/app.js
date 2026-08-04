/**
 * RectoBase App Initialization & Global State
 * Boots the application, manages state, screen routing, and network events.
 *
 * @version 1.0.0
 */

'use strict';

// ─── Global App State ──────────────────────────────────────────────────────────

/** @type {import('./api-service').ApiClient} */
const apiClient = api; // from api-service.js (script order ensures this)

window.RB = {
  // Auth & user
  user: Storage.get(API_CONFIG.userKey) ?? null,
  token: Storage.get(API_CONFIG.tokenKey) ?? null,
  tenant: null,

  // Outlet selection
  outlet: Storage.get('rb_outlet') ?? null,
  outlets: [],

  // Connectivity
  isOnline: navigator.onLine,
  isLoading: true,
  bootError: null,

  // Screen cache: { screenName: { data, timestamp, version } }
  screens: {},

  // Pending offline operations
  pendingOps: [],

  // Current hash / route
  currentScreen: 'beranda',

  // API client reference
  api: apiClient,

  // ── Outlet helpers ──────────────────────────────────────────────────────────
  setOutlet(outlet) {
    this.outlet = outlet;
    if (outlet) {
      localStorage.setItem('rb_outlet', JSON.stringify(outlet));
    } else {
      localStorage.removeItem('rb_outlet');
    }
    // Bust screen cache when outlet changes
    this.screens = {};
    this.dispatch('outlet:changed', outlet);
  },

  // ── Event bus ───────────────────────────────────────────────────────────────
  _handlers: {},
  on(event, handler) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(handler);
    return () => this.off(event, handler);
  },
  off(event, handler) {
    if (!this._handlers[event]) return;
    this._handlers[event] = this._handlers[event].filter((h) => h !== handler);
  },
  emit(event, data) {
    (this._handlers[event] || []).forEach((h) => {
      try { h(data); } catch (e) { console.error(`[RB:emit] ${event}:`, e); }
    });
    window.dispatchEvent(new CustomEvent(`rb:${event}`, { detail: data }));
  },
};

// ─── Boot Sequence ─────────────────────────────────────────────────────────────

/**
 * Main entry point. Loads auth, fetches user profile, then mounts the app.
 * @returns {Promise<void>}
 */
async function boot() {
  // Mark boot start
  window.RB.isLoading = true;
  window.RB.bootError = null;
  window.RB.emit('boot:start');

  try {
    // 1. Check stored token
    const token = window.RB.token;
    const hasAuth = !!token;

    if (!hasAuth) {
      // No token — go straight to login screen
      mountLogin();
      return;
    }

    // 2. Validate token by calling /me
    const meRes = await AuthService.me();

    if (!meRes.success) {
      // Token invalid / expired
      AuthService.logout();
      mountLogin();
      return;
    }

    // 3. Hydrate state from /me response
    window.RB.user = meRes.data?.user ?? meRes.data;
    window.RB.tenant = meRes.data?.tenant ?? null;
    window.RB.outlets = meRes.data?.outlets ?? [];

    // 4. Restore last selected outlet (or default to first)
    const storedOutlet = window.RB.outlet;
    if (storedOutlet) {
      const match = window.RB.outlets.find(
        (o) => String(o.id) === String(storedOutlet.id)
      );
      if (match) window.RB.outlet = match;
      else window.RB.outlet = window.RB.outlets[0] ?? null;
    } else {
      window.RB.outlet = window.RB.outlets[0] ?? null;
    }

    // 5. Mount main app shell
    mountApp();

    // 6. Warm up screen caches asynchronously (non-blocking)
    prewarmScreens();

  } catch (err) {
    console.error('[boot] Fatal error:', err);
    window.RB.bootError = err?.message ?? 'Gagal memulai aplikasi.';
    mountError(window.RB.bootError);
  } finally {
    window.RB.isLoading = false;
    window.RB.emit('boot:done');
  }
}

// ─── Screen Pre-warming ────────────────────────────────────────────────────────

/** Fetch critical data in the background without blocking mount. */
async function prewarmScreens() {
  // Fire off requests in parallel; failures are silent — screens load on demand
  const warm = [
    loadScreenData('dashboard'),
    loadScreenData('products'),
    loadScreenData('customers'),
  ];
  // Fire and forget — errors are handled inside loadScreenData
  warm.forEach((p) => p.catch(() => {}));
}

// ─── Screen Data Loader with Caching ───────────────────────────────────────────

const SCREEN_CACHE_TTL = 60_000; // 60 seconds

/**
 * Fetch and cache data for a named screen.
 *
 * Cache is invalidated when:
 *  - TTL expires
 *  - A mutation operation completes (handled via emit('screen:invalidated', name))
 *  - Outlet changes (handled in RB.setOutlet)
 *
 * @param {string} screen  One of: dashboard, products, customers, orders,
 *                         promotions, reports, kasir, settings
 * @param {object} [params]  Additional query params to merge into cache key
 * @param {boolean} [force]  Skip cache and force a fresh fetch
 * @returns {Promise<object|null>}
 */
async function loadScreenData(screen, params = {}, force = false) {
  const key = `${screen}:${JSON.stringify(params)}`;
  const cached = window.RB.screens[key];

  // Return cached if fresh
  if (!force && cached && Date.now() - cached.timestamp < SCREEN_CACHE_TTL) {
    return cached.data;
  }

  try {
    const data = await fetchScreenData(screen, params);
    window.RB.screens[key] = { data, timestamp: Date.now() };
    window.RB.emit('screen:loaded', { screen, data });
    return data;
  } catch (err) {
    // On error, return stale cache if available (graceful degradation)
    if (cached) {
      window.RB.emit('screen:error', { screen, error: err, stale: true });
      return cached.data;
    }
    window.RB.emit('screen:error', { screen, error: err, stale: false });
    throw err;
  }
}

/**
 * Invalidate cached data for a screen (call after mutations).
 * @param {string} [screen]  Omit to clear all.
 */
function invalidateScreen(screen) {
  if (screen) {
    Object.keys(window.RB.screens)
      .filter((k) => k.startsWith(`${screen}:`))
      .forEach((k) => delete window.RB.screens[k]);
    window.RB.emit('screen:invalidated', screen);
  } else {
    window.RB.screens = {};
    window.RB.emit('screen:invalidated', null);
  }
}

/**
 * Actually fetch data for a given screen from the API.
 * @private
 */
async function fetchScreenData(screen, params = {}) {
  const outletId = window.RB.outlet?.id;
  const baseParams = outletId ? { ...params, outlet_id: outletId } : params;

  switch (screen) {
    case 'dashboard':
      return (await Promise.allSettled([
        ReportService.summary({ period: 'today' }),
        ReportService.daily({ date: new Date().toISOString().slice(0, 10) }),
        OrderService.list({ status: 'pending', limit: 5 }),
        CustomerService.list({ limit: 5 }),
        ProductService.lowStock(),
      ])).map((r) => (r.status === 'fulfilled' ? r.value : null));

    case 'products':
      return (await ProductService.list({ ...baseParams, limit: 100 })).data ?? [];

    case 'customers':
      return (await CustomerService.list({ ...baseParams, limit: 50 })).data ?? [];

    case 'orders':
      return (await OrderService.list(baseParams)).data ?? [];

    case 'promotions':
      return (await PromotionService.list(baseParams)).data ?? [];

    case 'reports':
      return (await ReportService.revenue(baseParams)).data ?? {};

    case 'kasir':
      return {
        products: (await ProductService.list({ ...baseParams, limit: 500 })).data ?? [],
        customers: (await CustomerService.list({ ...baseParams, limit: 100 })).data ?? [],
      };

    case 'settings':
      return {
        outlets: window.RB.outlets,
        user: window.RB.user,
        tenant: window.RB.tenant,
      };

    default:
      return null;
  }
}

// ─── Mount Functions ───────────────────────────────────────────────────────────

/**
 * Mount the login / register screen.
 * In the full migration, this hides the existing SPA and shows an auth view.
 * For now it redirects to the login hash.
 */
function mountLogin() {
  window.RB.isLoading = false;
  window.RB.emit('auth:required');
  // In the existing app, #login is the auth screen
  if (!window.location.hash || window.location.hash === '#' || window.location.hash === '#beranda') {
    window.location.hash = '#login';
  }
}

/**
 * Mount the main application shell.
 * Called after successful authentication.
 */
function mountApp() {
  window.RB.isLoading = false;
  window.RB.emit('app:mounted');

  // Route to default screen or preserved hash
  const hash = window.location.hash.replace('#', '') || 'beranda';
  window.RB.currentScreen = hash;

  // Hide any splash / loading overlay
  const splash = document.getElementById('splash-screen') || document.getElementById('loading-screen');
  if (splash) splash.style.display = 'none';

  // Show main content
  const main = document.getElementById('app-main') || document.getElementById('main-content') || document.body;
  main.style.display = '';

  // Dispatch ready
  window.dispatchEvent(new CustomEvent('rb:ready'));
}

/**
 * Mount a fatal error screen.
 * @param {string} message
 */
function mountError(message) {
  window.RB.isLoading = false;
  window.RB.emit('boot:error', message);
  // For a POS app, show an inline error rather than crashing
  const el = document.getElementById('app-main') || document.getElementById('main-content') || document.body;
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;font-family:sans-serif;background:#1a1a2e;color:#e0e0e0;text-align:center;padding:24px;">
      <div style="font-size:48px;">⚠️</div>
      <h2 style="margin:0;font-size:20px;">Gagal Memuat Aplikasi</h2>
      <p style="margin:0;max-width:360px;line-height:1.6;">${escapeHtml(message)}</p>
      <button onclick="location.reload()" style="margin-top:8px;padding:12px 24px;background:#4361ee;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;">
        Coba Lagi
      </button>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Hash Router ───────────────────────────────────────────────────────────────

const VALID_SCREENS = new Set([
  'beranda', 'kasir', 'pelanggan', 'promo',
  'insight', 'tools', 'login', 'register', 'settings',
]);

/** Listen to hash changes and route accordingly. */
function initRouter() {
  const handleHash = async () => {
    const hash = window.location.hash.replace('#', '') || 'beranda';
    window.RB.currentScreen = hash;

    // If no token and trying to access protected screen → login
    const protectedScreens = new Set([...VALID_SCREENS].filter((s) => s !== 'login' && s !== 'register'));
    if (!window.RB.token && protectedScreens.has(hash)) {
      window.location.hash = '#login';
      return;
    }

    // Invalidate stale caches for the incoming screen
    invalidateScreen(hash);

    // Emit route event for existing SPA router to handle
    window.RB.emit('route:change', { screen: hash });

    // For new screens (not handled by existing index.html),
    // dynamically load screen modules here in the future
  };

  window.addEventListener('hashchange', handleHash);
  handleHash(); // handle initial hash
}

// ─── Network Status Handlers ───────────────────────────────────────────────────

function initNetworkHandlers() {
  const bannerId = 'rb-offline-banner';

  function showBanner() {
    if (window.RB.isOnline) return; // already shown
    window.RB.isOnline = false;
    window.RB.emit('network:offline');

    // Avoid duplicates
    if (document.getElementById(bannerId)) return;

    const banner = document.createElement('div');
    banner.id = bannerId;
    banner.setAttribute('role', 'alert');
    Object.assign(banner.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      zIndex: '99999',
      background: '#f59e0b',
      color: '#000',
      textAlign: 'center',
      padding: '8px 16px',
      fontSize: '13px',
      fontFamily: 'sans-serif',
      fontWeight: '600',
    });
    banner.textContent = '⚡ Anda sedang offline. Perubahan akan disinkronkan saat koneksi kembali.';
    document.body.prepend(banner);

    // If POS mode, show full-screen offline lock
    if (window.RB.currentScreen === 'kasir') {
      showOfflineKasirLock();
    }
  }

  function hideBanner() {
    if (!window.RB.isOnline) return;
    window.RB.emit('network:online');

    const banner = document.getElementById(bannerId);
    if (banner) banner.remove();

    // Sync pending operations when back online
    syncPendingOperations();
  }

  function showOfflineKasirLock() {
    // Block the kasir screen when offline (cannot process real payments)
    const overlay = document.createElement('div');
    overlay.id = 'rb-kasir-offline-lock';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '9998',
      background: 'rgba(26,26,46,0.92)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '12px', color: '#e0e0e0',
      fontFamily: 'sans-serif', textAlign: 'center', padding: '24px',
    });
    overlay.innerHTML = `
      <div style="font-size:64px;">📡</div>
      <h2 style="margin:0;font-size:22px;">Koneksi Terputus</h2>
      <p style="margin:0;max-width:300px;line-height:1.6;">
        Mode kasir memerlukan koneksi internet untuk memproses pembayaran.
        Harap periksa koneksi Anda.
      </p>
    `;
    document.body.appendChild(overlay);
  }

  window.addEventListener('online', () => {
    window.RB.isOnline = true;
    hideBanner();
    const lock = document.getElementById('rb-kasir-offline-lock');
    if (lock) lock.remove();
  });

  window.addEventListener('offline', () => {
    window.RB.isOnline = false;
    showBanner();
  });

  // Set initial state
  window.RB.isOnline = navigator.onLine;
  if (!navigator.onLine) showBanner();
}

// ─── Offline Operation Queue ─────────────────────────────────────────────────────

/**
 * Enqueue a pending operation (called by api-service when offline).
 * Exposed on window.RB for easy access.
 */
window.RB.addPendingOp = (op) => {
  window.RB.pendingOps.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ...op,
    enqueuedAt: Date.now(),
    retries: 0,
  });
  savePendingOps();
};

/**
 * Persist pending ops to localStorage.
 */
function savePendingOps() {
  try {
    localStorage.setItem('rb_pending_ops', JSON.stringify(window.RB.pendingOps));
  } catch {
    // Storage full — remove oldest
    window.RB.pendingOps.shift();
    savePendingOps();
  }
}

/**
 * Load pending ops from localStorage on boot.
 */
function loadPendingOps() {
  try {
    const raw = localStorage.getItem('rb_pending_ops');
    window.RB.pendingOps = raw ? JSON.parse(raw) : [];
  } catch {
    window.RB.pendingOps = [];
  }
}

/**
 * Sync all pending operations when back online.
 * Uses server-wins conflict resolution and notifies the UI.
 */
async function syncPendingOperations() {
  if (!window.RB.isOnline || window.RB.pendingOps.length === 0) return;

  window.RB.emit('sync:start', { count: window.RB.pendingOps.length });

  const failed = [];

  for (const op of [...window.RB.pendingOps]) {
    try {
      const { operation, payload } = op;
      // operation = { method, path }
      const res = await apiClient.request(operation.method, operation.path, payload, {
        authenticated: true,
      });

      if (res.success || res.queued) {
        // Remove from queue on success
        window.RB.pendingOps = window.RB.pendingOps.filter((o) => o.id !== op.id);
        window.RB.emit('sync:item:success', op);
      } else {
        op.retries++;
        if (op.retries >= 3) {
          failed.push(op);
          window.RB.pendingOps = window.RB.pendingOps.filter((o) => o.id !== op.id);
          window.RB.emit('sync:item:failed', op);
        }
        window.RB.emit('sync:item:retry', op);
      }
    } catch (err) {
      op.retries++;
      if (op.retries >= 3) {
        failed.push(op);
        window.RB.pendingOps = window.RB.pendingOps.filter((o) => o.id !== op.id);
      }
    }
  }

  savePendingOps();

  window.RB.emit('sync:complete', { failed });

  if (failed.length > 0) {
    window.RB.emit('toast', {
      type: 'error',
      message: `${failed.length} operasi gagal disinkronkan dan dihapus.`,
    });
  } else if (window.RB.pendingOps.length === 0) {
    window.RB.emit('toast', {
      type: 'success',
      message: 'Semua perubahan berhasil disinkronkan.',
    });
  }
}

// ─── Session Activity Tracking ───────────────────────────────────────────────────

/** Track last user activity for auto-refresh logic in api-service. */
function initActivityTracking() {
  const update = () => sessionStorage.setItem('rb_last_activity', String(Date.now()));
  ['click', 'keydown', 'touchstart', 'scroll'].forEach((evt) =>
    window.addEventListener(evt, update, { passive: true })
  );
}

// ─── PWA Update Detection ───────────────────────────────────────────────────────

function initPWAUpdateCheck() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // New SW has taken over — reload to get fresh app
    window.RB.emit('toast', {
      type: 'info',
      message: 'Pembaruan tersedia. Memuat ulang…',
      duration: 4000,
    });
    setTimeout(() => location.reload(), 1500);
  });

  // Check for updates every 5 minutes
  setInterval(() => {
    navigator.serviceWorker.ready.then((reg) => {
      reg.update();
    });
  }, 5 * 60 * 1000);
}

// ─── Tab Visibility: Pause/resume background sync ────────────────────────────────

function initVisibilityHandler() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      window.RB.emit('app:resume');
      // Re-validate token if tab was hidden > 5 minutes
      const last = Number(sessionStorage.getItem('rb_last_activity') ?? 0);
      if (Date.now() - last > 5 * 60 * 1000 && window.RB.token) {
        AuthService.me().catch(() => {
          AuthService.logout();
        });
      }
    } else {
      window.RB.emit('app:pause');
    }
  });
}

// ─── Toast / Notification System ────────────────────────────────────────────────

/**
 * Show a toast notification.
 * @param {{ type: 'success'|'error'|'warning'|'info', message: string, duration?: number }} opts
 */
function showToast({ type = 'info', message, duration = 3500 }) {
  const id = `toast-${Date.now()}`;
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const colors = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#4361ee',
  };

  const el = document.createElement('div');
  el.id = id;
  el.setAttribute('role', 'alert');
  Object.assign(el.style, {
    position: 'fixed',
    bottom: '80px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '99998',
    background: '#1e1e2e',
    color: '#fff',
    padding: '10px 20px',
    borderRadius: '10px',
    fontSize: '14px',
    fontFamily: 'sans-serif',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    borderLeft: `4px solid ${colors[type] ?? colors.info}`,
    maxWidth: '360px',
    animation: 'rb-toast-in 0.25s ease',
    whiteSpace: 'nowrap',
  });
  el.innerHTML = `<span style="color:${colors[type] ?? colors.info};font-size:16px;">${icons[type] ?? icons.info}</span> ${escapeHtml(message)}`;
  document.body.appendChild(el);

  // Inject keyframes once
  if (!document.getElementById('rb-toast-styles')) {
    const style = document.createElement('style');
    style.id = 'rb-toast-styles';
    style.textContent = `
      @keyframes rb-toast-in { from { opacity:0; transform: translateX(-50%) translateY(10px); } to { opacity:1; transform: translateX(-50%) translateY(0); } }
      @keyframes rb-toast-out { from { opacity:1; } to { opacity:0; transform: translateX(-50%) translateY(10px); } }
    `;
    document.head.appendChild(style);
  }

  setTimeout(() => {
    el.style.animation = 'rb-toast-out 0.2s ease forwards';
    setTimeout(() => el.remove(), 200);
  }, duration);
}

// Wire toast to global event
window.RB.on('toast', showToast);

// ─── Boot ─────────────────────────────────────────────────────────────────────

loadPendingOps();
initNetworkHandlers();
initActivityTracking();
initVisibilityHandler();
initRouter();
initPWAUpdateCheck();

// Start boot after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// ─── Public API ─────────────────────────────────────────────────────────────────

window.RB.boot = boot;
window.RB.loadScreenData = loadScreenData;
window.RB.invalidateScreen = invalidateScreen;
window.RB.syncPendingOperations = syncPendingOperations;
window.RB.showToast = showToast;
