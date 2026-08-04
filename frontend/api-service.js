/**
 * RectoBase API Service
 * Production API client replacing localStorage data layer.
 * Targets RectoBase backend at /api/v1/*
 *
 * @version 1.0.0
 * @license MIT
 */

'use strict';

// ─── Configuration ────────────────────────────────────────────────────────────

const API_CONFIG = {
  baseURL: window.API_BASE || 'https://base.rectoversomedia.com',
  timeout: 30_000,
  retryAttempts: 1,
  retryDelay: 1_000,
  tokenKey: 'rb_token',
  refreshTokenKey: 'rb_refresh_token',
  userKey: 'rb_user',
};

// ─── Storage Helpers ───────────────────────────────────────────────────────────

const Storage = {
  get(key) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn(`[Storage] Failed to write "${key}":`, e);
    }
  },

  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn(`[Storage] Failed to remove "${key}":`, e);
    }
  },

  clear() {
    try {
      localStorage.removeItem(API_CONFIG.tokenKey);
      localStorage.removeItem(API_CONFIG.refreshTokenKey);
      localStorage.removeItem(API_CONFIG.userKey);
    } catch (e) {
      console.warn('[Storage] Failed to clear auth:', e);
    }
  },
};

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Build a query string from a plain object.
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
function buildQuery(params) {
  if (!params || typeof params !== 'object') return '';
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `?${qs}` : '';
}

/**
 * Sleep utility for retry delays.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Deep-clone a value (strip reactivity / prototype chain).
 * @template T
 * @param {T} v
 * @returns {T}
 */
function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

// ─── API Error ────────────────────────────────────────────────────────────────

class ApiError extends Error {
  /**
   * @param {{
   *   status: number,
   *   message: string,
   *   errors?: Record<string, string[]>,
   *   code?: string,
   *   isNetworkError?: boolean,
   * }} cfg
   */
  constructor({ status, message, errors, code, isNetworkError }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
    this.code = code;
    this.isNetworkError = isNetworkError ?? false;
  }

  /** True for 4xx/5xx responses. */
  get isServerError() {
    return this.status >= 400;
  }

  /** Human-readable status label. */
  get statusLabel() {
    const map = {
      400: 'Permintaan Tidak Valid',
      401: 'Sesi Habis – Silakan Login Kembali',
      403: 'Akses Ditolak',
      404: 'Data Tidak Ditemukan',
      422: 'Validasi Gagal',
      429: 'Terlalu Banyak Permintaan',
      500: 'Kesalahan Server',
    };
    return map[this.status] ?? `Error ${this.status}`;
  }
}

// ─── Request Queue ─────────────────────────────────────────────────────────────

/** Manages pending request counts for loading indicators. */
class PendingRequests {
  #count = 0;
  #callbacks = [];

  increment() {
    this.#count++;
    this.#notify();
  }

  decrement() {
    if (this.#count > 0) this.#count--;
    this.#notify();
  }

  get count() {
    return this.#count;
  }

  get hasPending() {
    return this.#count > 0;
  }

  onChange(fn) {
    this.#callbacks.push(fn);
    return () => {
      this.#callbacks = this.#callbacks.filter((cb) => cb !== fn);
    };
  }

  #notify() {
    this.#callbacks.forEach((cb) => cb(this.#count));
  }
}

// ─── Abort Controller Pool ────────────────────────────────────────────────────

/** Registry of cancelable requests keyed by tag. */
const abortControllers = new Map();

function abortAll(tag) {
  if (!tag) return;
  const controllers = abortControllers.get(tag);
  if (controllers) {
    controllers.forEach((c) => c.abort());
    abortControllers.delete(tag);
  }
}

function registerAbort(tag, controller) {
  if (!tag) return;
  if (!abortControllers.has(tag)) {
    abortControllers.set(tag, new Set());
  }
  abortControllers.get(tag).add(controller);
}

// ─── Offline Queue ────────────────────────────────────────────────────────────

const OFFLINE_QUEUE_KEY = 'rb_offline_queue';

const OfflineQueue = {
  enqueue(operation, payload) {
    const queue = this.getAll();
    queue.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      operation,
      payload,
      timestamp: Date.now(),
      retries: 0,
    });
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    } catch {
      // Storage full — drop oldest non-critical items
      queue.shift();
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    }
  },

  getAll() {
    try {
      return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
    } catch {
      return [];
    }
  },

  remove(id) {
    const queue = this.getAll().filter((op) => op.id !== id);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  },

  update(id, patch) {
    const queue = this.getAll().map((op) =>
      op.id === id ? { ...op, ...patch } : op
    );
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  },

  clear() {
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
  },
};

// ─── Core Request Engine ──────────────────────────────────────────────────────

class ApiClient {
  #baseURL;
  #timeout;
  #retryAttempts;
  #retryDelay;
  #pending = new PendingRequests();

  /** True while a token refresh is in-flight; subsequent 401s queue behind it. */
  #refreshing = false;
  /** Queue of resolve/reject pairs for requests that hit 401 while refreshing. */
  #refreshWaiters = [];

  /** Emit to all tabs when auth state changes. */
  static #authChannel = new BroadcastChannel('rectobase:auth');

  constructor({
    baseURL = API_CONFIG.baseURL,
    timeout = API_CONFIG.timeout,
    retryAttempts = API_CONFIG.retryAttempts,
    retryDelay = API_CONFIG.retryDelay,
  } = {}) {
    this.#baseURL = baseURL;
    this.#timeout = timeout;
    this.#retryAttempts = retryAttempts;
    this.#retryDelay = retryDelay;

    // Listen for logout events from other tabs
    ApiClient.#authChannel.addEventListener('message', (ev) => {
      if (ev.data === 'logout') {
        this.clearAuth();
        window.location.hash = '#login';
      }
    });

    // Auto-refresh on tab focus if last activity > 5 minutes ago
    window.addEventListener('focus', () => {
      const last = sessionStorage.getItem('rb_last_activity');
      if (last && Date.now() - Number(last) > 5 * 60 * 1000) {
        if (Storage.get(API_CONFIG.tokenKey)) {
          AuthService.refreshToken().catch(() => {});
        }
      }
      sessionStorage.setItem('rb_last_activity', String(Date.now()));
    });

    sessionStorage.setItem('rb_last_activity', String(Date.now()));
  }

  // ── Auth helpers ─────────────────────────────────────────────────────────────

  get token() {
    return Storage.get(API_CONFIG.tokenKey);
  }

  set token(v) {
    if (v) Storage.set(API_CONFIG.tokenKey, v);
    else Storage.remove(API_CONFIG.tokenKey);
  }

  get refreshToken() {
    return Storage.get(API_CONFIG.refreshTokenKey);
  }

  set refreshToken(v) {
    if (v) Storage.set(API_CONFIG.refreshTokenKey, v);
    else Storage.remove(API_CONFIG.refreshTokenKey);
  }

  get user() {
    return Storage.get(API_CONFIG.userKey);
  }

  set user(v) {
    if (v) Storage.set(API_CONFIG.userKey, v);
    else Storage.remove(API_CONFIG.userKey);
  }

  get isAuthenticated() {
    return !!this.token;
  }

  clearAuth() {
    Storage.clear();
    this.#pending = new PendingRequests();
  }

  // ── Pending request tracking ─────────────────────────────────────────────────

  get pending() {
    return this.#pending;
  }

  // ── Core HTTP methods ────────────────────────────────────────────────────────

  /**
   * Low-level request. Handles token injection, refresh, retry, and offline.
   *
   * @param {string} method  GET|POST|PUT|DELETE|PATCH
   * @param {string} path
   * @param {object} [body]
   * @param {{ authenticated?: boolean, tag?: string, signal?: AbortSignal }} [opts]
   */
  async request(method, path, body, { authenticated = true, tag, signal } = {}) {
    const isOnline = navigator.onLine;
    const url = `${this.#baseURL}${path}`;

    // ── Build headers ──────────────────────────────────────────────────────────
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Client': 'rectobase-web/1.0',
      'X-Request-ID': crypto.randomUUID(),
    };

    if (authenticated && this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    // ── Build init ─────────────────────────────────────────────────────────────
    const init = {
      method: method.toUpperCase(),
      headers,
      credentials: 'same-origin',
      signal: signal ?? undefined,
    };

    if (body !== undefined && !['GET', 'HEAD'].includes(init.method)) {
      if (body instanceof FormData) {
        // Let browser set Content-Type with boundary for multipart
        delete headers['Content-Type'];
        init.body = body;
      } else {
        init.body = JSON.stringify(body);
      }
    }

    // ── Offline: enqueue if mutating ───────────────────────────────────────────
    if (!isOnline && authenticated) {
      const isMutating = !['GET', 'HEAD'].includes(method);
      if (isMutating) {
        OfflineQueue.enqueue({ method, path, body }, {
          url,
          authenticated,
        });
        // Return a resolved envelope so the UI stays responsive
        return { success: true, data: null, message: ' queued for when online', queued: true };
      }
      // For reads offline, try cache
      return { success: false, message: 'You are offline.', isNetworkError: true };
    }

    // ── Execute with retry ──────────────────────────────────────────────────────
    let lastError;

    for (let attempt = 0; attempt <= this.#retryAttempts; attempt++) {
      if (attempt > 0) await sleep(this.#retryDelay * attempt);

      try {
        this.#pending.increment();
        const res = await this.#fetchWithTimeout(url, init);
        this.#pending.decrement();

        // ── 401 — attempt token refresh ────────────────────────────────────────
        if (res.status === 401) {
          if (authenticated) {
            const refreshed = await this.#handle401(init, method, path, body);
            if (refreshed) {
              // Retry original request with fresh token
              const retryInit = { ...init, signal };
              retryInit.headers = {
                ...init.headers,
                Authorization: `Bearer ${this.token}`,
              };
              const retryRes = await this.#fetchWithTimeout(url, retryInit);
              return this.#parseResponse(retryRes);
            }
          }
          // Unauthenticated 401 or refresh failed → logout
          this.#logoutAllTabs();
          return this.#wrapError(res.status, 'Sesi habis. Silakan login kembali.');
        }

        return this.#parseResponse(res);
      } catch (err) {
        this.#pending.decrement();
        if (err.name === 'AbortError') {
          lastError = new ApiError({
            status: 0,
            message: 'Permintaan dibatalkan.',
            isNetworkError: true,
          });
        } else {
          lastError = new ApiError({
            status: 0,
            message: err.message || 'Koneksi gagal. Periksa internet Anda.',
            isNetworkError: true,
          });
        }
      }
    }

    return this.#wrapError(
      lastError?.status ?? 0,
      lastError?.message ?? 'Permintaan gagal setelah beberapa percobaan.'
    );
  }

  async #fetchWithTimeout(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeout);
    try {
      init.signal = controller.signal;
      const res = await fetch(url, init);
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async #handle401(init, method, path, body) {
    if (this.#refreshing) {
      // Wait for the in-flight refresh to complete
      return new Promise((resolve) => {
        this.#refreshWaiters.push({ resolve });
      }).then(() => !!this.token);
    }

    this.#refreshing = true;

    try {
      const refresh = this.refreshToken;
      if (!refresh) {
        this.#logoutAllTabs();
        return false;
      }

      const res = await fetch(`${this.#baseURL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ refresh_token: refresh }),
        credentials: 'same-origin',
      });

      if (!res.ok) {
        this.#logoutAllTabs();
        return false;
      }

      const json = await res.json();
      if (!json.success) {
        this.#logoutAllTabs();
        return false;
      }

      this.token = json.data?.access_token;
      this.refreshToken = json.data?.refresh_token;

      // Resolve all waiting requests
      this.#refreshWaiters.forEach(({ resolve }) => resolve(true));
      this.#refreshWaiters = [];
      return true;
    } catch {
      this.#refreshWaiters.forEach(({ resolve }) => resolve(false));
      this.#refreshWaiters = [];
      this.#logoutAllTabs();
      return false;
    } finally {
      this.#refreshing = false;
    }
  }

  #logoutAllTabs() {
    this.clearAuth();
    ApiClient.#authChannel.postMessage('logout');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('rb:logout'));
    }
  }

  async #parseResponse(res) {
    let data;
    const contentType = res.headers.get('Content-Type') || '';

    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = { success: res.ok, data: await res.text() };
    }

    if (res.ok) {
      return {
        success: true,
        data: data?.data ?? data,
        message: data?.message,
        meta: data?.meta,
      };
    }

    return this.#wrapError(
      res.status,
      data?.message ?? `HTTP ${res.status}`,
      data?.errors,
      data?.code
    );
  }

  #wrapError(status, message, errors, code) {
    return {
      success: false,
      message,
      errors,
      code,
      status,
      /** Convenience: throws as ApiError so callers can use try/catch. */
      throw() {
        throw new ApiError({ status, message, errors, code });
      },
    };
  }

  // ── Convenience HTTP methods ─────────────────────────────────────────────────
  // These all return { success, data, message, ... } (not throwing).

  get(path, params, opts) {
    return this.request('GET', `${path}${buildQuery(params)}`, undefined, opts);
  }

  post(path, body, opts) {
    return this.request('POST', path, body, opts);
  }

  put(path, body, opts) {
    return this.request('PUT', path, body, opts);
  }

  patch(path, body, opts) {
    return this.request('PATCH', path, body, opts);
  }

  delete(path, body, opts) {
    return this.request('DELETE', path, body, opts);
  }

  /** Returns a tagged AbortController; call .abort() to cancel. */
  createCancellable(tag) {
    abortAll(tag); // cancel any previous with same tag
    const controller = new AbortController();
    registerAbort(tag, controller);
    return controller;
  }
}

// ─── Singleton API instance ────────────────────────────────────────────────────

const api = new ApiClient();
window.ApiClient = ApiClient; // expose for testing / extensions

// ─── Auth Service ─────────────────────────────────────────────────────────────

const AuthService = {
  /** Returns the api client instance used for auth operations. */
  get client() {
    return api;
  },

  /**
   * @param {string} email
   * @param {string} password
   * @returns {Promise<object>}
   */
  async login(email, password) {
    const res = await api.post('/api/v1/auth/login', { email, password }, { authenticated: false });
    if (res.success) {
      this.#storeTokens(res.data);
    }
    return res;
  },

  /**
   * @param {{ name: string, outlet: string, phone: string, email: string, password: string }} data
   * @returns {Promise<object>}
   */
  async register(data) {
    const res = await api.post('/api/v1/auth/register', data, { authenticated: false });
    if (res.success) {
      this.#storeTokens(res.data);
    }
    return res;
  },

  /**
   * @param {string} idToken  Google OAuth ID token
   * @returns {Promise<object>}
   */
  async googleLogin(idToken) {
    const res = await api.post('/api/v1/auth/google-login', { id_token: idToken }, { authenticated: false });
    if (res.success) {
      this.#storeTokens(res.data);
    }
    return res;
  },

  /**
   * @returns {Promise<object>}
   */
  async refreshToken() {
    const refresh = api.refreshToken;
    if (!refresh) return { success: false, message: 'No refresh token' };

    const res = await api.post('/api/v1/auth/refresh', { refresh_token: refresh }, { authenticated: false });
    if (res.success) {
      this.#storeTokens(res.data);
    }
    return res;
  },

  /**
   * @param {string} email
   * @returns {Promise<object>}
   */
  async forgotPassword(email) {
    return api.post('/api/v1/auth/forgot-password', { email }, { authenticated: false });
  },

  /**
   * @param {string} token
   * @param {string} password
   * @returns {Promise<object>}
   */
  async resetPassword(token, password) {
    return api.put('/api/v1/auth/reset-password', { token, password }, { authenticated: false });
  },

  /**
   * Fetch current user from /me and sync local user data.
   * @returns {Promise<object>}
   */
  async me() {
    const res = await api.get('/api/v1/auth/me');
    if (res.success) {
      api.user = res.data;
    }
    return res;
  },

  /**
   * @param {Record<string, unknown>} data
   * @returns {Promise<object>}
   */
  async updateProfile(data) {
    const res = await api.put('/api/v1/auth/me', data);
    if (res.success) {
      api.user = res.data;
    }
    return res;
  },

  logout() {
    api.clearAuth();
    ApiClient.#authChannel.postMessage('logout');
    window.dispatchEvent(new CustomEvent('rb:logout'));
  },

  // ── Private ─────────────────────────────────────────────────────────────────

  #storeTokens(data) {
    if (!data) return;
    api.token = data.access_token ?? data.token;
    api.refreshToken = data.refresh_token;
    api.user = data.user ?? null;
  },
};

// ─── Outlet Service ───────────────────────────────────────────────────────────

const OutletService = {
  list(params) {
    return api.get('/api/v1/outlets', params);
  },

  get(id) {
    return api.get(`/api/v1/outlets/${id}`);
  },

  create(data) {
    return api.post('/api/v1/outlets', data);
  },

  update(id, data) {
    return api.put(`/api/v1/outlets/${id}`, data);
  },

  delete(id) {
    return api.delete(`/api/v1/outlets/${id}`);
  },
};

// ─── Product Service ──────────────────────────────────────────────────────────

const ProductService = {
  list(params) {
    return api.get('/api/v1/products', params);
  },

  get(id) {
    return api.get(`/api/v1/products/${id}`);
  },

  create(data) {
    return api.post('/api/v1/products', data);
  },

  update(id, data) {
    return api.put(`/api/v1/products/${id}`, data);
  },

  delete(id) {
    return api.delete(`/api/v1/products/${id}`);
  },

  /**
   * Adjust stock for a product.
   * @param {string|number} id
   * @param {{ quantity: number, type: 'in'|'out'|'adjustment', note?: string }} data
   */
  adjustStock(id, data) {
    return api.put(`/api/v1/products/${id}/stock`, data);
  },

  lowStock() {
    return api.get('/api/v1/products/low-stock');
  },

  /**
   * Bulk import from CSV/XLSX file.
   * @param {File} file
   */
  importFromFile(file) {
    const form = new FormData();
    form.append('file', file);
    return api.post('/api/v1/products/import', form);
  },
};

// ─── Category Service ─────────────────────────────────────────────────────────

const CategoryService = {
  list() {
    return api.get('/api/v1/categories');
  },

  create(data) {
    return api.post('/api/v1/categories', data);
  },

  update(id, data) {
    return api.put(`/api/v1/categories/${id}`, data);
  },

  delete(id) {
    return api.delete(`/api/v1/categories/${id}`);
  },
};

// ─── Order Service ────────────────────────────────────────────────────────────

const OrderService = {
  list(params) {
    return api.get('/api/v1/orders', params);
  },

  get(id) {
    return api.get(`/api/v1/orders/${id}`);
  },

  create(data) {
    return api.post('/api/v1/orders', data);
  },

  /**
   * @param {string|number} id
   * @param {'pending'|'confirmed'|'processing'|'completed'|'cancelled'} status
   */
  updateStatus(id, status) {
    return api.put(`/api/v1/orders/${id}/status`, { status });
  },

  /**
   * @param {string|number} id
   * @param {string} reason
   */
  cancel(id, reason) {
    return api.put(`/api/v1/orders/${id}/cancel`, { reason });
  },

  /**
   * @param {string|number} orderId
   * @param {{ product_id: number, quantity: number, price: number, note?: string }} item
   */
  addItem(orderId, item) {
    return api.post(`/api/v1/orders/${orderId}/items`, item);
  },

  /**
   * @param {string|number} orderId
   * @param {{ method: string, reference?: string }} data
   */
  processPayment(orderId, data) {
    return api.post(`/api/v1/orders/${orderId}/pay`, data);
  },
};

// ─── Customer / CRM Service ────────────────────────────────────────────────────

const CustomerService = {
  list(params) {
    return api.get('/api/v1/customers', params);
  },

  get(id) {
    return api.get(`/api/v1/customers/${id}`);
  },

  create(data) {
    return api.post('/api/v1/customers', data);
  },

  update(id, data) {
    return api.put(`/api/v1/customers/${id}`, data);
  },

  delete(id) {
    return api.delete(`/api/v1/customers/${id}`);
  },

  getActivities(id) {
    return api.get(`/api/v1/customers/${id}/activities`);
  },

  getOrders(id, params) {
    return api.get(`/api/v1/customers/${id}/orders`, params);
  },

  /**
   * @param {string|number} id
   * @param {{ points: number, note?: string }} data
   */
  addPoints(id, data) {
    return api.post(`/api/v1/customers/${id}/points`, data);
  },
};

// ─── Promotion Service ────────────────────────────────────────────────────────

const PromotionService = {
  list(params) {
    return api.get('/api/v1/promotions', params);
  },

  get(id) {
    return api.get(`/api/v1/promotions/${id}`);
  },

  create(data) {
    return api.post('/api/v1/promotions', data);
  },

  update(id, data) {
    return api.put(`/api/v1/promotions/${id}`, data);
  },

  delete(id) {
    return api.delete(`/api/v1/promotions/${id}`);
  },

  send(id) {
    return api.post(`/api/v1/promotions/${id}/send`);
  },

  getRecipients(id) {
    return api.get(`/api/v1/promotions/${id}/recipients`);
  },

  getStats(id) {
    return api.get(`/api/v1/promotions/${id}/stats`);
  },
};

// ─── Payment Service ──────────────────────────────────────────────────────────

const PaymentService = {
  /**
   * @param {string|number} orderId
   * @param {string} method  e.g. 'QRIS', 'VA_BCA', 'EWALLET'
   */
  create(orderId, method) {
    return api.post('/api/v1/payments/create', { order_id: orderId, method });
  },

  get(id) {
    return api.get(`/api/v1/payments/${id}`);
  },

  /** Verify a payment by reference (e.g. Tripay reference code). */
  verify(reference) {
    return api.get(`/api/v1/payments/verify/${reference}`);
  },
};

// ─── Report Service ────────────────────────────────────────────────────────────

const ReportService = {
  /** Daily sales breakdown. params: { date: 'YYYY-MM-DD', outlet?: number } */
  daily(params) {
    return api.get('/api/v1/reports/daily', params);
  },

  /** Summary over a period. params: { period: 'today'|'week'|'month'|'custom', start?, end? } */
  summary(params) {
    return api.get('/api/v1/reports/summary', params);
  },

  customerReport(params) {
    return api.get('/api/v1/reports/customers', params);
  },

  productReport(params) {
    return api.get('/api/v1/reports/products', params);
  },

  revenue(params) {
    return api.get('/api/v1/reports/revenue', params);
  },
};

// ─── WhatsApp Service ─────────────────────────────────────────────────────────

const WhatsAppService = {
  /**
   * @param {{ to: string, template: string, data?: Record<string,string> }} payload
   */
  send(payload) {
    return api.post('/api/v1/whatsapp/send', payload);
  },

  /**
   * Broadcast a promotion to a customer segment.
   * @param {{ promoId: number, segment: string }} payload
   */
  broadcast(payload) {
    return api.post('/api/v1/whatsapp/broadcast', payload);
  },

  /** List sent messages. params: { page, limit, template? } */
  getMessages(params) {
    return api.get('/api/v1/whatsapp/messages', params);
  },

  /** Schedule automatic birthday messages for today. */
  scheduleBirthday() {
    return api.post('/api/v1/whatsapp/templates/birthday');
  },

  /** Schedule win-back messages for inactive customers. */
  scheduleWinback() {
    return api.post('/api/v1/whatsapp/templates/winback');
  },
};

// ─── Upload Service ────────────────────────────────────────────────────────────

const UploadService = {
  /**
   * Upload a product image. Accepts File or Blob.
   * @param {File|Blob} file
   * @param {Record<string,string>} [extraFields]
   */
  productImage(file, extraFields = {}) {
    const form = new FormData();
    form.append('image', file);
    Object.entries(extraFields).forEach(([k, v]) => form.append(k, v));
    return api.post('/api/v1/upload/product-image', form);
  },
};

// ─── Named exports (ESM compat) ───────────────────────────────────────────────

export {
  api,
  ApiClient,
  ApiError,
  AuthService,
  OutletService,
  ProductService,
  CategoryService,
  OrderService,
  CustomerService,
  PromotionService,
  PaymentService,
  ReportService,
  WhatsAppService,
  UploadService,
  OfflineQueue,
  Storage,
};
