/**
 * RectoBase Offline Sync
 * Provides offline-first data management with localStorage-backed operation queue.
 *
 * Conflict resolution: server wins (last-write-wins with server authoritative data).
 * The UI is notified of conflicts so the user can review them.
 *
 * @version 1.0.0
 */

'use strict';

// ─── Constants ─────────────────────────────────────────────────────────────────

const OFFLINE_SYNC_KEY = 'rb_sync_queue';
const OFFLINE_META_KEY = 'rb_sync_meta';
const MAX_RETRIES = 3;
const SYNC_INTERVAL = 30_000; // 30s auto-sync when online
const STALE_THRESHOLD = 24 * 60 * 60 * 1000; // 24h — stale ops are dropped

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SyncOperation
 * @property {string}  id          Unique operation ID
 * @property {'create'|'update'|'delete'} type
 * @property {'order'|'product'|'customer'|'promotion'|'payment'} resource
 * @property {object}   payload     The request body / params
 * @property {number}   timestamp   When the op was queued (Date.now())
 * @property {number}   retries     How many times this op has been retried
 * @property {string}   [userId]    Who created the op (for attribution)
 * @property {string}   [screen]    Which screen the op originated from
 */

/**
 * @typedef {Object} SyncConflict
 * @property {SyncOperation} operation  The failed operation
 * @property {object}         serverData  What the server has now
 * @property {object}         localData  What the local state tried to write
 * @property {string}         reason    Why it conflicted
 * @property {number}         timestamp
 */

// ─── OfflineSync Class ─────────────────────────────────────────────────────────

class OfflineSync {
  /** @type {SyncOperation[]} */
  static #queue = [];

  /** @type {SyncConflict[]} */
  static #conflicts = [];

  /** @type {number|null} */
  static #syncTimer = null;

  /** @type {boolean} */
  static #isSyncing = false;

  /** @type {Set<string>} Active operation IDs to avoid double-sync */
  static #inflight = new Set();

  // ── Queue Management ───────────────────────────────────────────────────────

  /**
   * Add an operation to the offline queue.
   *
   * @param {'create'|'update'|'delete'} type
   * @param {'order'|'product'|'customer'|'promotion'|'payment'} resource
   * @param {object} payload
   * @param {{ userId?: string, screen?: string, id?: string }} [meta]
   * @returns {SyncOperation}
   */
  static enqueue(type, resource, payload, meta = {}) {
    const op = {
      id: meta.id ?? this.#newId(),
      type,
      resource,
      payload,
      timestamp: Date.now(),
      retries: 0,
      userId: meta.userId ?? window.RB?.user?.id,
      screen: meta.screen ?? window.RB?.currentScreen,
    };

    this.#queue.push(op);
    this.#persist();
    this.#scheduleSync();

    window.RB?.emit('sync:enqueued', op);
    return op;
  }

  /**
   * Convenience: queue a create operation.
   * @param {'order'|'product'|'customer'|'promotion'} resource
   * @param {object} payload
   * @param {object} [meta]
   */
  static enqueueCreate(resource, payload, meta) {
    return this.enqueue('create', resource, payload, meta);
  }

  /**
   * Convenience: queue an update operation.
   * @param {'order'|'product'|'customer'|'promotion'} resource
   * @param {string|number} id
   * @param {object} payload
   * @param {object} [meta]
   */
  static enqueueUpdate(resource, id, payload, meta) {
    return this.enqueue('update', resource, { id, ...payload }, meta);
  }

  /**
   * Convenience: queue a delete operation.
   * @param {'order'|'product'|'customer'|'promotion'} resource
   * @param {string|number} id
   * @param {object} [meta]
   */
  static enqueueDelete(resource, id, meta) {
    return this.enqueue('delete', resource, { id }, meta);
  }

  /**
   * Remove a specific operation from the queue.
   * @param {string} id
   */
  static remove(id) {
    this.#queue = this.#queue.filter((op) => op.id !== id);
    this.#inflight.delete(id);
    this.#persist();
  }

  /**
   * Get all queued operations.
   * @returns {SyncOperation[]}
   */
  static getQueue() {
    return [...this.#queue];
  }

  /**
   * Get the count of pending (not-yet-synced) operations.
   * @returns {number}
   */
  static getPendingCount() {
    return this.#queue.length;
  }

  /**
   * Check if there are pending operations.
   * @returns {boolean}
   */
  static hasPending() {
    return this.#queue.length > 0;
  }

  /**
   * Clear the entire queue.
   * @param {boolean} [emit=true]  Whether to emit events
   */
  static clearQueue(emit = true) {
    const count = this.#queue.length;
    this.#queue = [];
    this.#inflight.clear();
    this.#persist();
    if (emit) window.RB?.emit('sync:cleared', { count });
  }

  // ── Sync ─────────────────────────────────────────────────────────────────

  /**
   * Process the entire queue, sending each operation to the API.
   * Resolves when all operations have been attempted (success or permanently failed).
   *
   * @param {{ onProgress?: (op, result) => void, force?: boolean }} [opts]
   * @returns {Promise<{ succeeded: number, failed: number, conflicts: SyncConflict[] }>}
   */
  static async processQueue({ onProgress, force = false } = {}) {
    if (this.#isSyncing && !force) return { succeeded: 0, failed: 0, conflicts: [] };
    if (!navigator.onLine) return { succeeded: 0, failed: 0, conflicts: [] };

    this.#isSyncing = true;
    window.RB?.emit('sync:start', { count: this.#queue.length });

    let succeeded = 0;
    let failed = 0;
    const conflicts = [];

    // Sort queue: creates first, then updates, then deletes (safer ordering)
    const sorted = this.#sortQueue([...this.#queue]);

    for (const op of sorted) {
      // Skip if already being processed
      if (this.#inflight.has(op.id)) continue;
      this.#inflight.add(op.id);

      // Drop stale operations (> 24h)
      if (Date.now() - op.timestamp > STALE_THRESHOLD) {
        this.remove(op.id);
        failed++;
        window.RB?.emit('sync:item:stale', op);
        continue;
      }

      try {
        const result = await this.#executeOp(op);

        if (result.success) {
          succeeded++;
          this.remove(op.id); // remove from queue on success
          window.RB?.emit('sync:item:success', { op, data: result.data });
        } else if (result.conflict) {
          // Server conflict — server wins
          failed++;
          const conflict = {
            operation: op,
            serverData: result.serverData,
            localData: op.payload,
            reason: result.message ?? 'Konflik data dengan server',
            timestamp: Date.now(),
          };
          conflicts.push(conflict);
          this.#conflicts.push(conflict);
          this.remove(op.id);
          window.RB?.emit('sync:conflict', conflict);
        } else {
          // Retryable error
          op.retries++;
          if (op.retries >= MAX_RETRIES) {
            failed++;
            this.remove(op.id);
            window.RB?.emit('sync:item:failed', { op, reason: result.message });
          } else {
            this.#updateOp(op);
            window.RB?.emit('sync:item:retry', { op, reason: result.message });
          }
        }

        onProgress?.(op, result);
      } catch (err) {
        failed++;
        op.retries++;
        if (op.retries >= MAX_RETRIES) {
          this.remove(op.id);
        } else {
          this.#updateOp(op);
        }
        window.RB?.emit('sync:item:error', { op, error: err.message });
      }
    }

    this.#isSyncing = false;
    this.#persistConflicts();

    window.RB?.emit('sync:complete', { succeeded, failed, conflicts });

    return { succeeded, failed, conflicts };
  }

  /**
   * Start auto-sync timer.
   * Call once during app init.
   */
  static startAutoSync() {
    this.stopAutoSync();
    this.#syncTimer = setInterval(() => {
      if (navigator.onLine && this.#queue.length > 0 && !this.#isSyncing) {
        this.processQueue().catch(() => {});
      }
    }, SYNC_INTERVAL);
  }

  /**
   * Stop auto-sync timer.
   */
  static stopAutoSync() {
    if (this.#syncTimer !== null) {
      clearInterval(this.#syncTimer);
      this.#syncTimer = null;
    }
  }

  /**
   * Trigger an immediate sync attempt.
   */
  static async syncNow() {
    return this.processQueue();
  }

  // ── Conflict Management ────────────────────────────────────────────────────

  /**
   * Get all recorded conflicts.
   * @returns {SyncConflict[]}
   */
  static getConflicts() {
    return [...this.#conflicts];
  }

  /**
   * Dismiss / acknowledge a conflict (removes from conflict log).
   * @param {string} conflictId
   */
  static dismissConflict(conflictId) {
    // Conflicts are stored as JSON so we use a heuristic id
    this.#conflicts = this.#conflicts.filter(
      (_, i) => `conflict-${i}` !== conflictId
    );
    this.#persistConflicts();
  }

  /**
   * Clear all recorded conflicts.
   */
  static clearConflicts() {
    this.#conflicts = [];
    this.#persistConflicts();
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  /** Load queue from localStorage. Call at boot. */
  static hydrate() {
    try {
      const raw = localStorage.getItem(OFFLINE_SYNC_KEY);
      this.#queue = raw ? JSON.parse(raw) : [];
    } catch {
      this.#queue = [];
    }
    try {
      const rawMeta = localStorage.getItem(OFFLINE_META_KEY);
      // Meta could store last sync time, etc.
    } catch {
      // ignore
    }
  }

  /** Write queue to localStorage. */
  static #persist() {
    try {
      localStorage.setItem(OFFLINE_SYNC_KEY, JSON.stringify(this.#queue));
    } catch {
      // Storage full — drop oldest non-create ops
      const creates = this.#queue.filter((o) => o.type === 'create');
      const others = this.#queue.filter((o) => o.type !== 'create');
      if (others.length > 0) {
        others.shift(); // drop oldest non-create
        this.#queue = [...creates, ...others];
        try {
          localStorage.setItem(OFFLINE_SYNC_KEY, JSON.stringify(this.#queue));
        } catch {
          // Last resort: keep only creates
          this.#queue = creates;
          localStorage.setItem(OFFLINE_SYNC_KEY, JSON.stringify(this.#queue));
        }
      }
    }
  }

  static #persistConflicts() {
    try {
      // Only keep last 50 conflicts
      const recent = this.#conflicts.slice(-50);
      localStorage.setItem('rb_sync_conflicts', JSON.stringify(recent));
    } catch {
      // ignore
    }
  }

  // ── Operation Execution ───────────────────────────────────────────────────

  /**
   * Execute a single operation against the API.
   * @private
   */
  static async #executeOp(op) {
    const { type, resource, payload } = op;
    const endpoint = this.#endpoint(resource, payload.id);

    switch (type) {
      case 'create': {
        const res = await api.post(endpoint, payload);
        if (res.success) {
          // Invalidate relevant screen cache
          invalidateScreen(resource === 'order' ? 'orders' : resource === 'customer' ? 'customers' : null);
          return { success: true, data: res.data };
        }
        // 409 = conflict, 422 = validation error (not retryable)
        if (res.status === 409) {
          return { success: false, conflict: true, serverData: res.data, message: res.message };
        }
        return { success: false, message: res.message };
      }

      case 'update': {
        const res = await api.put(`${endpoint}/${payload.id}`, payload);
        if (res.success) {
          invalidateScreen(resource);
          return { success: true, data: res.data };
        }
        if (res.status === 409) {
          return { success: false, conflict: true, serverData: res.data, message: res.message };
        }
        return { success: false, message: res.message };
      }

      case 'delete': {
        const res = await api.delete(`${endpoint}/${payload.id}`);
        if (res.success) {
          invalidateScreen(resource);
          return { success: true };
        }
        return { success: false, message: res.message };
      }

      default:
        return { success: false, message: `Unknown operation type: ${type}` };
    }
  }

  static #endpoint(resource, id) {
    const map = {
      order:     '/api/v1/orders',
      product:   '/api/v1/products',
      customer:  '/api/v1/customers',
      promotion: '/api/v1/promotions',
      payment:   '/api/v1/payments',
    };
    return map[resource] ?? `/api/v1/${resource}`;
  }

  // ── Queue Helpers ─────────────────────────────────────────────────────────

  static #newId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  static #sortQueue(queue) {
    const order = { create: 0, update: 1, delete: 2 };
    return queue.sort((a, b) => (order[a.type] ?? 3) - (order[b.type] ?? 3));
  }

  static #updateOp(updated) {
    this.#queue = this.#queue.map((op) => (op.id === updated.id ? updated : op));
    this.#persist();
  }

  static #scheduleSync() {
    // Debounced sync: if online, sync within 2 seconds
    if (!navigator.onLine) return;
    setTimeout(() => {
      if (this.#queue.length > 0 && !this.#isSyncing) {
        this.processQueue().catch(() => {});
      }
    }, 2_000);
  }
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────────

// Hydrate from localStorage on load
OfflineSync.hydrate();

// Auto-sync when coming back online
window.addEventListener('online', () => {
  if (OfflineSync.hasPending()) {
    OfflineSync.syncNow();
  }
});

// Start background sync interval
OfflineSync.startAutoSync();

// ─── Expose on window ───────────────────────────────────────────────────────────

window.OfflineSync = OfflineSync;
