/* =========================================
   RectoBase Admin Panel — Core JS Library
   ========================================= */

// ─── SVG Icons ───────────────────────────────────────────────────────────────
const Icons = {
  dashboard: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`,
  merchants: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  transactions: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>`,
  promotions: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
  bell: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  system: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  logout: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>`,
  search: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
  eye: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
  edit: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  trash: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  x: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  check: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  plus: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
  chevronLeft: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`,
  chevronRight: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
  chevronDown: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
  download: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`,
  externalLink: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>`,
  refresh: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`,
  pause: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
  play: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>`,
  mail: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`,
  alertTriangle: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
  info: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
  user: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  settings: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  store: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2v0a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12v0a2 2 0 0 1-2-2V7"/></svg>`,
  shoppingBag: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
  zap: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  dollarSign: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
  trendingUp: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`,
  trendingDown: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>`,
  send: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`,
  barChart: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/></svg>`,
  activity: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  cpu: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>`,
  database: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>`,
  wifi: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" x2="12.01" y1="20" y2="20"/></svg>`,
  lock: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  unlock: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`,
  users: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  moreVertical: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>`,
  arrowUp: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>`,
  arrowDown: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>`,
};

// ─── Admin API Client ─────────────────────────────────────────────────────────
class AdminAPI {
  constructor() {
    this.base = '/api/v1/admin';
    this.token = localStorage.getItem('admin_token') || null;
    this.demoMode = true; // Simulate API responses for demo
  }

  _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  async _request(method, path, body) {
    if (this.demoMode) {
      return this._mockRequest(method, path, body);
    }
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: this._headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    return res.json();
  }

  get(path, params) {
    if (params) {
      const q = new URLSearchParams(params).toString();
      path = `${path}?${q}`;
    }
    return this._request('GET', path);
  }

  post(path, body) { return this._request('POST', path, body); }
  put(path, body) { return this._request('PUT', path, body); }
  patch(path, body) { return this._request('PATCH', path, body); }
  delete(path) { return this._request('DELETE', path); }

  // ── Auth ──────────────────────────────────────────────────────────────────
  async login(email, password) {
    // Demo login
    if (email === 'admin@rectobase.id' && password === 'admin123') {
      const mockToken = 'demo_admin_token_' + Date.now();
      this.token = mockToken;
      localStorage.setItem('admin_token', mockToken);
      localStorage.setItem('admin_user', JSON.stringify({
        id: 1,
        name: 'Ahmad Rizki',
        email: 'admin@rectobase.id',
        role: 'super_admin',
      }));
      return { token: mockToken, user: { id: 1, name: 'Ahmad Rizki', email: 'admin@rectobase.id', role: 'super_admin' } };
    }
    throw new Error('Email atau password salah.');
  }

  async logout() {
    this.token = null;
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    window.location.href = 'index.html';
  }

  getCurrentUser() {
    try {
      return JSON.parse(localStorage.getItem('admin_user') || 'null');
    } catch {
      return null;
    }
  }

  isAuthenticated() {
    return !!localStorage.getItem('admin_token');
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  async getStats() {
    return {
      totalMerchants: 1847,
      activeSubscriptions: 1523,
      mrr: 428750000,
      trialMerchants: 124,
      newMerchantsThisMonth: 87,
      churnRate: 2.3,
      stats: [
        { id: 'total_merchants', label: 'Total Merchant', value: 1847, change: +12.4, trend: 'up' },
        { id: 'active_subs', label: 'Active Subscription', value: 1523, change: +8.2, trend: 'up' },
        { id: 'mrr', label: 'MRR', value: 428750000, change: +15.7, trend: 'up', format: 'currency' },
        { id: 'trial', label: 'Trial Merchant', value: 124, change: -5.1, trend: 'down' },
      ],
    };
  }

  async getRevenue(params) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const revenue = [285, 312, 298, 341, 378, 392, 415, 428, 456, 472, 498, 521];
    const orders = [1240, 1380, 1290, 1520, 1680, 1740, 1890, 2010, 2180, 2340, 2490, 2680];
    const monthIndex = new Date().getMonth();
    const slice = (arr) => [...arr.slice(-(12 + (12 - monthIndex - 1))), ...arr.slice(0, monthIndex + 1)];

    return {
      labels: months,
      revenue: revenue.map(v => v * 1000),
      orders: orders,
      mrr: revenue[monthIndex] * 1000,
      growth: 15.7,
    };
  }

  async getMerchantGrowth() {
    return [
      { month: 'Jan', count: 1240 },
      { month: 'Feb', count: 1356 },
      { month: 'Mar', count: 1402 },
      { month: 'Apr', count: 1487 },
      { month: 'Mei', count: 1523 },
      { month: 'Jun', count: 1598 },
      { month: 'Jul', count: 1645 },
      { month: 'Agu', count: 1712 },
      { month: 'Sep', count: 1767 },
      { month: 'Okt', count: 1798 },
      { month: 'Nov', count: 1823 },
      { month: 'Des', count: 1847 },
    ];
  }

  // ── Merchants ─────────────────────────────────────────────────────────────
  _mockMerchants() {
    const plans = ['starter', 'professional', 'enterprise'];
    const statuses = ['active', 'active', 'active', 'trial', 'expired', 'suspended'];
    const merchants = [
      { id: 1, name: 'Warung Kopi Nusantara', email: 'admin@warkop.co.id', phone: '+6281234567001', plan: 'professional', status: 'active', outlets: 3, staff: 18, created: '2024-03-15', mrr: 299000, owner: 'Budi Santoso', city: 'Jakarta Selatan' },
      { id: 2, name: 'Toko Grosir Berkah', email: 'owner@berkah.id', phone: '+6281234567002', plan: 'enterprise', status: 'active', outlets: 12, staff: 67, created: '2023-11-08', mrr: 899000, owner: 'Siti Aminah', city: 'Surabaya' },
      { id: 3, name: 'Restoran Sedap Rasa', email: 'hello@sedaprasa.id', phone: '+6281234567003', plan: 'starter', status: 'trial', outlets: 1, staff: 5, created: '2025-12-28', mrr: 0, owner: 'Hendra Wijaya', city: 'Bandung' },
      { id: 4, name: 'Apotek Sehat Farma', email: 'apotek@sehatfarma.com', phone: '+6281234567004', plan: 'professional', status: 'active', outlets: 5, staff: 28, created: '2024-07-22', mrr: 299000, owner: 'Dewi Lestari', city: 'Yogyakarta' },
      { id: 5, name: 'Mini Market Serba Ada', email: 'cs@serbada.id', phone: '+6281234567005', plan: 'starter', status: 'expired', outlets: 2, staff: 8, created: '2024-01-10', mrr: 99000, owner: 'Joko Pramono', city: 'Semarang' },
      { id: 6, name: 'Kedai Kopi Kenangan', email: 'kedai@kenangan.id', phone: '+6281234567006', plan: 'enterprise', status: 'active', outlets: 28, staff: 142, created: '2023-06-01', mrr: 1499000, owner: 'Reza Pahlevi', city: 'Jakarta Pusat' },
      { id: 7, name: 'Bengkel Motor Jaya', email: 'jaya@bengkel Jaya.id', phone: '+6281234567007', plan: 'starter', status: 'suspended', outlets: 1, staff: 4, created: '2024-09-05', mrr: 99000, owner: 'Tono Hartono', city: 'Malang' },
      { id: 8, name: 'Cafe Mocha Latte', email: 'info@mochalatte.com', phone: '+6281234567008', plan: 'professional', status: 'active', outlets: 4, staff: 22, created: '2024-05-18', mrr: 299000, owner: 'Anita Putri', city: 'Bali' },
      { id: 9, name: 'Swalayanmart Indonesia', email: 'corporate@swalayanmart.co.id', phone: '+6281234567009', plan: 'enterprise', status: 'active', outlets: 45, staff: 320, created: '2023-02-14', mrr: 2499000, owner: 'Gunawan Hidayat', city: 'Jakarta Barat' },
      { id: 10, name: 'Toko Elektronik Maju', email: 'sales@majuelektro.id', phone: '+6281234567010', plan: 'professional', status: 'trial', outlets: 2, staff: 11, created: '2025-12-20', mrr: 0, owner: 'Fajar Nugroho', city: 'Medan' },
      { id: 11, name: 'Kedai Ayam Geprek', email: 'order@geprek.id', phone: '+6281234567011', plan: 'starter', status: 'active', outlets: 1, staff: 3, created: '2025-01-08', mrr: 99000, owner: 'Rina Marlina', city: 'Makassar' },
      { id: 12, name: 'Fashion House Indonesia', email: 'fashion@fashionhouse.co.id', phone: '+6281234567012', plan: 'enterprise', status: 'active', outlets: 8, staff: 56, created: '2024-04-30', mrr: 899000, owner: 'Vivian Chen', city: 'Jakarta Selatan' },
      { id: 13, name: 'Rumah Makan Padang', email: 'rumahmakanpdg@gmail.com', phone: '+6281234567013', plan: 'professional', status: 'active', outlets: 2, staff: 14, created: '2024-08-12', mrr: 299000, owner: 'Rizky Ramadhan', city: 'Padang' },
      { id: 14, name: 'Pet Shop Anabul', email: 'hello@anabul.id', phone: '+6281234567014', plan: 'starter', status: 'active', outlets: 1, staff: 4, created: '2025-02-25', mrr: 99000, owner: 'Mega Suryani', city: 'Palembang' },
      { id: 15, name: 'Hotel Bintang Timur', email: 'reservation@hotellite.id', phone: '+6281234567015', plan: 'enterprise', status: 'active', outlets: 1, staff: 89, created: '2023-09-17', mrr: 1499000, owner: 'Arief Rahman', city: 'Jakarta Utara' },
    ];
    return merchants;
  }

  async getMerchants(params = {}) {
    let data = this._mockMerchants();

    if (params.search) {
      const q = params.search.toLowerCase();
      data = data.filter(m =>
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.owner.toLowerCase().includes(q)
      );
    }
    if (params.plan && params.plan !== 'all') {
      data = data.filter(m => m.plan === params.plan);
    }
    if (params.status && params.status !== 'all') {
      data = data.filter(m => m.status === params.status);
    }

    const page = parseInt(params.page) || 1;
    const limit = parseInt(params.limit) || 10;
    const total = data.length;
    const start = (page - 1) * limit;
    const items = data.slice(start, start + limit);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getMerchant(id) {
    const m = this._mockMerchants().find(m => m.id === parseInt(id));
    if (!m) throw new Error('Merchant tidak ditemukan.');
    return {
      ...m,
      orders: { total: Math.floor(Math.random() * 5000) + 200, value: Math.floor(Math.random() * 200000000) + 50000000 },
      topProducts: [
        { name: 'Kopi Hitam', sold: 4820, revenue: 24100000 },
        { name: 'Nasi Goreng', sold: 3210, revenue: 48150000 },
        { name: 'Teh Manis', sold: 5940, revenue: 17820000 },
        { name: 'Ayam Geprek', sold: 2680, revenue: 53600000 },
        { name: 'Mie Goreng', sold: 2150, revenue: 32250000 },
      ],
      customers: Math.floor(Math.random() * 3000) + 500,
      revenueByMonth: [28500000, 31200000, 29800000, 34100000, 37800000, 39200000],
      revenueLabels: ['Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov'],
      staff: [
        { id: 1, name: m.owner, email: m.email, role: 'owner', status: 'active', lastLogin: '2025-12-30' },
        { id: 2, name: 'Kasir Utama', email: 'kasir@' + m.email.split('@')[1], role: 'cashier', status: 'active', lastLogin: '2025-12-30' },
        { id: 3, name: 'Manager Outlet', email: 'manager@' + m.email.split('@')[1], role: 'manager', status: 'active', lastLogin: '2025-12-29' },
      ],
    };
  }

  async updateMerchant(id, data) {
    return { id: parseInt(id), ...data, updated: true };
  }

  async suspendMerchant(id) {
    return { id: parseInt(id), status: 'suspended' };
  }

  async activateMerchant(id) {
    return { id: parseInt(id), status: 'active' };
  }

  async deleteMerchant(id) {
    return { id: parseInt(id), deleted: true };
  }

  // ── Transactions ──────────────────────────────────────────────────────────
  _mockTransactions() {
    const methods = ['bank_transfer', 'ewallet', 'credit_card', 'qris', 'cash'];
    const statuses = ['success', 'success', 'success', 'pending', 'failed'];
    const merchants = this._mockMerchants();
    const transactions = [];
    for (let i = 1; i <= 80; i++) {
      const m = merchants[i % merchants.length];
      const amount = Math.floor(Math.random() * 5000000) + 50000;
      const date = new Date(2025, 11, Math.floor(Math.random() * 30) + 1);
      transactions.push({
        id: 'TXN' + String(100000 + i).padStart(7, '0'),
        merchant: m.name,
        merchantId: m.id,
        amount,
        method: methods[i % methods.length],
        status: statuses[i % statuses.length],
        date: date.toISOString(),
        reference: 'REF' + String(200000 + i),
        fee: Math.floor(amount * 0.025),
      });
    }
    return transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  async getTransactions(params = {}) {
    let data = this._mockTransactions();
    if (params.merchantId) data = data.filter(t => t.merchantId === parseInt(params.merchantId));
    if (params.status && params.status !== 'all') data = data.filter(t => t.status === params.status);
    if (params.search) {
      const q = params.search.toLowerCase();
      data = data.filter(t => t.id.toLowerCase().includes(q) || t.merchant.toLowerCase().includes(q) || t.reference.toLowerCase().includes(q));
    }
    const page = parseInt(params.page) || 1;
    const limit = parseInt(params.limit) || 15;
    const total = data.length;
    const items = data.slice((page - 1) * limit, page * limit);
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  // ── Promotions ────────────────────────────────────────────────────────────
  async getPromotions() {
    return [
      {
        id: 1, title: 'Diskon 20% Akhir Tahun', merchant: 'Kedai Kopi Kenangan',
        type: 'discount', status: 'active', sent: 4820, opened: 2892, clicked: 964,
        start: '2025-12-01', end: '2025-12-31', conversion: 4.2,
      },
      {
        id: 2, title: 'Buy 1 Get 1 Kopi', merchant: 'Warung Kopi Nusantara',
        type: 'bogo', status: 'active', sent: 1200, opened: 720, clicked: 360,
        start: '2025-12-15', end: '2025-12-31', conversion: 8.1,
      },
      {
        id: 3, title: 'Cashback 10% QRIS', merchant: 'Swalayanmart Indonesia',
        type: 'cashback', status: 'ended', sent: 12500, opened: 4375, clicked: 1875,
        start: '2025-11-01', end: '2025-11-30', conversion: 3.4,
      },
      {
        id: 4, title: 'Free Ongkir Min 100rb', merchant: 'Toko Grosir Berkah',
        type: 'shipping', status: 'active', sent: 3200, opened: 1600, clicked: 640,
        start: '2025-12-20', end: '2026-01-10', conversion: 5.7,
      },
      {
        id: 5, title: 'Promo Weekday Special', merchant: 'Restoran Sedap Rasa',
        type: 'discount', status: 'scheduled', sent: 0, opened: 0, clicked: 0,
        start: '2026-01-05', end: '2026-01-31', conversion: 0,
      },
    ];
  }

  // ── Notifications ────────────────────────────────────────────────────────
  async sendNotification(data) {
    return { success: true, id: 'notif_' + Date.now(), ...data };
  }

  async getNotificationHistory() {
    return [
      { id: 'notif_1', title: 'Maintenance Scheduled', target: 'all', sentAt: '2025-12-28T10:00:00Z', status: 'delivered', recipients: 1847 },
      { id: 'notif_2', title: 'New Feature: AI Reports', target: 'plan:enterprise', sentAt: '2025-12-20T09:00:00Z', status: 'delivered', recipients: 45 },
      { id: 'notif_3', title: 'Harga Promo Januari', target: 'all', sentAt: '2025-12-15T08:00:00Z', status: 'delivered', recipients: 1847 },
    ];
  }

  // ── System ────────────────────────────────────────────────────────────────
  async getSystemHealth() {
    return {
      api: { status: 'online', latency: 42, uptime: 99.97 },
      database: { status: 'online', connections: 87, maxConnections: 200, queryTime: 3.2 },
      whatsapp: { status: 'online', queue: 12, sentToday: 4832 },
      redis: { status: 'online', memoryUsed: '1.2GB', memoryTotal: '4GB' },
      storage: { used: 342, total: 500, percent: 68 },
    };
  }

  async getSystemLogs(params = {}) {
    const logs = [
      { ts: '2025-12-30T14:23:01Z', level: 'info', msg: 'GET /api/v1/merchants 200 42ms' },
      { ts: '2025-12-30T14:22:58Z', level: 'info', msg: 'POST /api/v1/auth/login 200 118ms' },
      { ts: '2025-12-30T14:22:45Z', level: 'warn', msg: 'Slow query detected: SELECT orders WHERE date > 2025-12-01 (892ms)' },
      { ts: '2025-12-30T14:21:30Z', level: 'error', msg: 'WhatsApp gateway timeout: connection refused after 5000ms' },
      { ts: '2025-12-30T14:21:05Z', level: 'info', msg: 'Payment TXN0000100 confirmed: Rp 2.450.000' },
      { ts: '2025-12-30T14:20:00Z', level: 'success', msg: 'Scheduled job: invoice_generation completed (847 invoices)' },
      { ts: '2025-12-30T14:18:33Z', level: 'info', msg: 'New merchant registered: Fashion House Indonesia' },
      { ts: '2025-12-30T14:15:00Z', level: 'debug', msg: 'Cache invalidated: merchant_stats_* (124 keys)' },
      { ts: '2025-12-30T14:12:47Z', level: 'info', msg: 'PUT /api/v1/merchants/9 200 65ms' },
      { ts: '2025-12-30T14:10:00Z', level: 'info', msg: 'Cron: subscription_check completed — 3 expired, 2 renewed' },
      { ts: '2025-12-30T14:05:22Z', level: 'warn', msg: 'Rate limit approaching for IP 103.87.xxx.xxx (890/1000 req/min)' },
      { ts: '2025-12-30T14:00:00Z', level: 'info', msg: 'Daily report generated and sent to admin@rectobase.id' },
    ];
    const page = parseInt(params.page) || 1;
    const limit = parseInt(params.limit) || 20;
    return { logs: logs.slice((page - 1) * limit, page * limit), total: logs.length, page, pages: 1 };
  }

  async pingService(service) {
    return { service, status: 'online', latency: Math.floor(Math.random() * 50) + 10 };
  }

  async clearCache() {
    return { success: true, keysCleared: 847 };
  }

  async sendTestEmail(email) {
    return { success: true, messageId: 'test_' + Date.now() };
  }

  // ── Mock request handler ──────────────────────────────────────────────────
  _mockRequest(method, path, body) {
    return new Promise((resolve, reject) => {
      setTimeout(() => resolve({ success: true }), 200 + Math.random() * 300);
    });
  }
}

// ─── Global API Instance ──────────────────────────────────────────────────────
const API = new AdminAPI();

// ─── Auth Guard ───────────────────────────────────────────────────────────────
function requireAuth() {
  if (!API.isAuthenticated() && !window.location.pathname.endsWith('index.html')) {
    window.location.href = 'index.html';
  }
}

// ─── Sidebar Navigation ───────────────────────────────────────────────────────
function initSidebar() {
  const user = API.getCurrentUser();
  const sidebarUserEl = document.getElementById('sidebar-user');
  if (sidebarUserEl && user) {
    const nameEl = sidebarUserEl.querySelector('.sidebar-user-name');
    const roleEl = sidebarUserEl.querySelector('.sidebar-user-role');
    const avatarEl = sidebarUserEl.querySelector('.sidebar-avatar');
    if (nameEl) nameEl.textContent = user.name;
    if (roleEl) roleEl.textContent = user.role === 'super_admin' ? 'Super Admin' : 'Admin';
    if (avatarEl) avatarEl.textContent = user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  }

  // Set active nav link based on current page
  const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
  document.querySelectorAll('.sidebar-nav-link[data-page]').forEach(link => {
    if (link.dataset.page === currentPage) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Logout
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', () => API.logout());

  // Mobile sidebar toggle
  const toggleBtn = document.getElementById('sidebar-toggle');
  const sidebar = document.querySelector('.admin-sidebar');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && !toggleBtn.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
  }
}

// ─── Toast Notifications ─────────────────────────────────────────────────────
const toastContainer = document.createElement('div');
toastContainer.className = 'toast-container';
document.body.appendChild(toastContainer);

const Toast = {
  _create(type, title, message) {
    const icons = {
      success: Icons.check,
      error: Icons.alertTriangle,
      warning: Icons.alertTriangle,
      info: Icons.info,
    };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || Icons.info}</span>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        ${message ? `<div class="toast-message">${message}</div>` : ''}
      </div>
      <button class="toast-close" aria-label="Close">${Icons.x}</button>
    `;
    toast.querySelector('.toast-close').addEventListener('click', () => this._remove(toast));
    toastContainer.appendChild(toast);
    setTimeout(() => this._remove(toast), 5000);
  },
  _remove(toast) {
    if (!toast.parentNode) return;
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 250);
  },
  success(title, message) { this._create('success', title, message); },
  error(title, message) { this._create('error', title, message); },
  warning(title, message) { this._create('warning', title, message); },
  info(title, message) { this._create('info', title, message); },
};

// ─── Modal System ─────────────────────────────────────────────────────────────
function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('open'));
  document.body.style.overflow = '';
}

// Close on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    closeAllModals();
  }
});

// Close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAllModals();
});

// ─── Confirm Dialog ───────────────────────────────────────────────────────────
function confirm({ title, message, confirmText = 'Ya, Lanjutkan', cancelText = 'Batal', danger = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header">
          <h3 class="modal-title">${title}</h3>
          <button class="modal-close" aria-label="Close">${Icons.x}</button>
        </div>
        <div class="modal-body">
          <p style="color: var(--color-text-secondary); font-size: 0.9375rem;">${message}</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="confirm-cancel">${cancelText}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-ok">${confirmText}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    overlay.querySelector('.modal-close').addEventListener('click', () => {
      overlay.remove();
      document.body.style.overflow = '';
      resolve(false);
    });
    overlay.querySelector('#confirm-cancel').addEventListener('click', () => {
      overlay.remove();
      document.body.style.overflow = '';
      resolve(false);
    });
    overlay.querySelector('#confirm-ok').addEventListener('click', () => {
      overlay.remove();
      document.body.style.overflow = '';
      resolve(true);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        document.body.style.overflow = '';
        resolve(false);
      }
    });
  });
}

// ─── CSV Export ───────────────────────────────────────────────────────────────
function exportCSV(data, filename) {
  if (!data || !data.length) return;
  const headers = Object.keys(data[0]);
  const rows = data.map(row => headers.map(h => {
    const val = String(row[h] ?? '');
    return val.includes(',') || val.includes('"') || val.includes('\n')
      ? `"${val.replace(/"/g, '""')}"`
      : val;
  }));
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ─── Table Renderer ──────────────────────────────────────────────────────────
class TableRenderer {
  constructor({ container, columns, rowRenderer, onSort, onPage, pagination = true }) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    this.columns = columns;
    this.rowRenderer = rowRenderer;
    this.onSort = onSort;
    this.onPage = onPage;
    this.pagination = pagination;
    this.currentPage = 1;
    this.sortCol = null;
    this.sortDir = 'asc';
    this.data = [];
    this.total = 0;
    this.limit = 10;
  }

  setData(items, total, page = 1, limit = 10) {
    this.data = items;
    this.total = total;
    this.currentPage = page;
    this.limit = limit;
    this.render();
  }

  render() {
    if (!this.container) return;
    const pages = Math.ceil(this.total / this.limit) || 1;

    const thead = this.columns.map(col => {
      let cls = col.thClass || '';
      if (col.sortable) cls += ' sortable';
      if (this.sortCol === col.key) cls += ` sort-${this.sortDir}`;
      return `<th class="${cls.trim()}" ${col.sortable ? `data-col="${col.key}"` : ''} ${col.width ? `style="width:${col.width}"` : ''}>${col.label}</th>`;
    }).join('');

    const tbody = this.data.length
      ? this.data.map(item => this.rowRenderer(item)).join('')
      : `<tr><td colspan="${this.columns.length}" style="text-align:center;padding:48px;color:var(--color-text-muted);">
          <div style="font-size:2rem;margin-bottom:8px;opacity:0.4;">${Icons.users}</div>
          Tidak ada data yang cocok.
        </td></tr>`;

    let paginationHTML = '';
    if (this.pagination && pages > 1) {
      const start = (this.currentPage - 1) * this.limit + 1;
      const end = Math.min(this.currentPage * this.limit, this.total);
      const pagesToShow = this._getPageNumbers(pages);
      paginationHTML = `
        <div class="pagination">
          <div class="pagination-info">Menampilkan ${start}–${end} dari ${this.total} data</div>
          <div class="pagination-controls">
            <button class="pagination-btn" data-page="${this.currentPage - 1}" ${this.currentPage <= 1 ? 'disabled' : ''}>${Icons.chevronLeft}</button>
            ${pagesToShow.map(p => p === '...'
              ? '<span class="pagination-btn" style="cursor:default">…</span>'
              : `<button class="pagination-btn ${p === this.currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`
            ).join('')}
            <button class="pagination-btn" data-page="${this.currentPage + 1}" ${this.currentPage >= pages ? 'disabled' : ''}>${Icons.chevronRight}</button>
          </div>
        </div>`;
    }

    this.container.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead><tr>${thead}</tr></thead>
          <tbody>${tbody}</tbody>
        </table>
        ${paginationHTML}
      </div>`;

    // Sort handlers
    this.container.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (this.sortCol === col) {
          this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortCol = col;
          this.sortDir = 'asc';
        }
        if (this.onSort) this.onSort(this.sortCol, this.sortDir);
      });
    });

    // Pagination handlers
    this.container.querySelectorAll('.pagination-btn[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = parseInt(btn.dataset.page);
        if (!isNaN(page) && page >= 1 && page <= pages) {
          this.currentPage = page;
          if (this.onPage) this.onPage(page);
        }
      });
    });
  }

  _getPageNumbers(total) {
    const cur = this.currentPage;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = [1];
    if (cur > 3) pages.push('...');
    for (let i = Math.max(2, cur - 1); i <= Math.min(total - 1, cur + 1); i++) pages.push(i);
    if (cur < total - 2) pages.push('...');
    pages.push(total);
    return pages;
  }
}

// ─── Format Utilities ─────────────────────────────────────────────────────────
const Format = {
  currency(num, symbol = 'Rp') {
    if (num === undefined || num === null) return '—';
    return `${symbol} ${Number(num).toLocaleString('id-ID')}`;
  },
  number(num) {
    if (num === undefined || num === null) return '—';
    return Number(num).toLocaleString('id-ID');
  },
  date(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  },
  datetime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  },
  relative(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Baru saja';
    if (mins < 60) return `${mins}m lalu`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}j lalu`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}h lalu`;
    return this.date(iso);
  },
  percent(num) {
    if (num === undefined || num === null) return '—';
    return `${Number(num).toLocaleString('id-ID')}%`;
  },
  plan(plan) {
    const map = { starter: 'Starter', professional: 'Professional', enterprise: 'Enterprise' };
    return map[plan] || plan;
  },
  method(method) {
    const map = {
      bank_transfer: 'Transfer Bank', ewallet: 'E-Wallet', credit_card: 'Kartu Kredit',
      qris: 'QRIS', cash: 'Tunai',
    };
    return map[method] || method;
  },
  status(status) {
    const map = {
      active: { label: 'Aktif', cls: 'badge-active' },
      trial: { label: 'Trial', cls: 'badge-trial' },
      expired: { label: 'Expired', cls: 'badge-expired' },
      suspended: { label: 'Suspended', cls: 'badge-suspended' },
      success: { label: 'Berhasil', cls: 'badge-active' },
      pending: { label: 'Pending', cls: 'badge-trial' },
      failed: { label: 'Gagal', cls: 'badge-expired' },
    };
    return map[status] || { label: status, cls: '' };
  },
};

// ─── Debounce ─────────────────────────────────────────────────────────────────
function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ─── Loading State ────────────────────────────────────────────────────────────
function setLoading(el, loading = true) {
  if (!el) return;
  if (loading) {
    el.dataset.originalHTML = el.innerHTML;
    el.disabled = true;
    el.innerHTML = '<span class="spinner-sm"></span> Memuat…';
  } else {
    el.disabled = false;
    el.innerHTML = el.dataset.originalHTML || el.innerHTML;
  }
}

// ─── Dropdown Toggle ─────────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-dropdown-toggle]');
  if (toggle) {
    e.preventDefault();
    const menu = toggle.nextElementSibling;
    const isOpen = menu && menu.classList.contains('open');
    document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
    if (!isOpen && menu) menu.parentElement.classList.add('open');
  } else if (!e.target.closest('.dropdown')) {
    document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
  }
});

// ─── Tabs ─────────────────────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (!tabBtn) return;
  const tabGroup = tabBtn.dataset.tabGroup;
  const tabId = tabBtn.dataset.tab;

  // Activate button
  document.querySelectorAll(`[data-tab="${tabId}"], [data-tab-group="${tabGroup}"]`).forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  tabBtn.classList.add('active');
  tabBtn.setAttribute('aria-selected', 'true');

  // Activate panel
  document.querySelectorAll(`.tab-panel[data-tab-panel="${tabGroup}"]`).forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(tabId);
  if (panel) {
    panel.classList.add('active');
    // Dispatch event for lazy loading
    panel.dispatchEvent(new CustomEvent('tabshown', { bubbles: true }));
  }
});
