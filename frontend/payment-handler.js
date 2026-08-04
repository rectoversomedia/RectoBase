/**
 * RectoBase Payment Handler
 * Manages the Tripay payment flow: create → poll → confirm → receipt.
 *
 * Supports QRIS, Virtual Account, and e-Wallet channels.
 * Handles deep links on mobile (rectobase://payment?reference=XXX).
 *
 * @version 1.0.0
 */

'use strict';

// ─── Payment Status ──────────────────────────────────────────────────────────────

/** Tripay payment status → internal status. */
const PAYMENT_STATUS_MAP = {
  UNPAID:     'pending',
  PAID:       'paid',
  EXPIRED:    'expired',
  FAILED:     'failed',
  CANCELLED:  'cancelled',
  REFUNDED:   'refunded',
};

/** Internal status → human-readable label (Bahasa Indonesia). */
const STATUS_LABEL = {
  pending:  'Menunggu Pembayaran',
  paid:     'Lunas',
  expired:  'Kedaluwarsa',
  failed:   'Gagal',
  cancelled:'Dibatalkan',
  refunded: 'Dikembalikan',
};

/** Icon map for each status. */
const STATUS_ICON = {
  pending:  '⏳',
  paid:     '✅',
  expired:  '⌛',
  failed:   '❌',
  cancelled:'🚫',
  refunded: '↩️',
};

// ─── Payment Handler ─────────────────────────────────────────────────────────────

class PaymentHandler {
  /** @type {HTMLElement|null} */
  static #modal = null;

  /** @type {number|null} */
  static #pollTimer = null;

  /** @type {number|null} */
  static #expireTimer = null;

  /** @type {number} */
  static #maxPollAttempts = 60; // 10s each = 10 minutes

  /** @type {object|null} Current active payment context */
  static #context = null;

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Full payment flow: create → modal → poll → resolve.
   *
   * @param {{
   *   orderId: number,
   *   amount: number,
   *   method: string,
   *   customer?: object,
   *   items?: object[],
   *   onSuccess?: (order, payment) => void,
   *   onFailure?: (reason) => void,
   * }} opts
   */
  static async initiate({ orderId, amount, method, customer, items, onSuccess, onFailure } = {}) {
    // Cancel any in-flight payment
    this.cancel();

    try {
      // 1. Create payment on backend
      const createRes = await PaymentService.create(orderId, method);

      if (!createRes.success) {
        throw new Error(createRes.message ?? 'Gagal membuat pembayaran.');
      }

      const paymentData = createRes.data;

      // 2. Show payment modal with instructions
      this.#context = {
        orderId,
        payment: paymentData,
        method,
        amount,
        customer,
        items,
        reference: paymentData.reference,
        expiredAt: paymentData.expired_at ? new Date(paymentData.expired_at) : null,
        onSuccess,
        onFailure,
      };

      this.showPaymentModal(paymentData);

      // 3. Start polling
      this.startPolling(paymentData.reference, orderId);

      // 4. Set expiration timer if backend provides it
      if (this.#context.expiredAt) {
        const msUntilExpiry = this.#context.expiredAt - Date.now();
        if (msUntilExpiry > 0) {
          this.#expireTimer = setTimeout(() => {
            this.#handleExpiry();
          }, msUntilExpiry);
        }
      }

    } catch (err) {
      this.#dismissModal();
      (onFailure ?? (() => {}))(err.message);
      window.RB?.emit('toast', { type: 'error', message: err.message });
    }
  }

  /**
   * Dismiss any active modal and stop polling.
   */
  static cancel() {
    this.#stopPolling();
    if (this.#expireTimer) {
      clearTimeout(this.#expireTimer);
      this.#expireTimer = null;
    }
    this.#context = null;
    this.#dismissModal();
  }

  /**
   * Start polling the payment status every 10 seconds.
   *
   * @param {string} reference
   * @param {number} orderId
   * @param {number} [maxAttempts=60]
   */
  static startPolling(reference, orderId, maxAttempts = 60) {
    this.#stopPolling();
    this.#maxPollAttempts = maxAttempts;

    let attempts = 0;

    const poll = async () => {
      if (!this.#context || this.#context.reference !== reference) return;

      attempts++;
      const res = await PaymentService.verify(reference);

      if (res.success) {
        const status = this.#normalizeStatus(res.data?.status);

        if (status === 'paid') {
          this.#stopPolling();
          await this.#handlePaid(res.data, orderId);
          return;
        }

        if (status === 'failed' || status === 'expired' || status === 'cancelled') {
          this.#stopPolling();
          this.#handleFailure(status, res.data);
          return;
        }
      }

      if (attempts >= this.#maxPollAttempts) {
        this.#stopPolling();
        this.#handleExpiry();
        return;
      }

      // Schedule next poll
      this.#pollTimer = setTimeout(poll, 10_000);
    };

    // Start first poll after 2 seconds (don't hammer on open)
    this.#pollTimer = setTimeout(poll, 2_000);
  }

  /**
   * Stop the current polling loop.
   */
  static #stopPolling() {
    if (this.#pollTimer !== null) {
      clearTimeout(this.#pollTimer);
      this.#pollTimer = null;
    }
  }

  // ── Modal ──────────────────────────────────────────────────────────────────

  /**
   * Render and show the payment modal with instructions.
   * @param {object} payment  Backend response data
   */
  static showPaymentModal(payment) {
    this.#dismissModal();

    const method = payment.method ?? payment.channel ?? 'UNKNOWN';
    const isQRIS = method === 'QRIS';
    const isVA = String(method).startsWith('VA_');
    const isEWallet = ['EWALLET', 'OVO', 'DANA', 'LINKAJA', 'SHOPEEPAY'].includes(method);

    const reference = payment.reference ?? '';
    const amount = payment.amount ?? payment.amount_formatted ?? payment.total ?? 0;
    const expiredAt = payment.expired_at
      ? this.#formatExpiry(new Date(payment.expired_at))
      : null;
    const instructions = payment.instructions ?? [];

    const icon = isQRIS ? '🔲' : isVA ? '🏦' : isEWallet ? '📱' : '💳';
    const methodLabel = this.#channelLabel(method);

    const modal = document.createElement('div');
    modal.id = 'rb-payment-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.style.cssText = `
      position:fixed;inset:0;z-index:99990;
      background:rgba(0,0,0,0.7);
      display:flex;align-items:center;justify-content:center;
      font-family:system-ui,-apple-system,sans-serif;
      animation:rb-modal-fadein 0.2s ease;
    `;

    modal.innerHTML = `
      <div style="
        background:#1e1e2e;color:#e0e0e0;
        border-radius:16px;padding:0;max-width:420px;width:92%;
        box-shadow:0 24px 48px rgba(0,0,0,0.5);
        overflow:hidden;
      ">
        <!-- Header -->
        <div style="background:#2a2a3e;padding:20px 24px;display:flex;align-items:center;gap:12px;">
          <span style="font-size:28px;">${icon}</span>
          <div>
            <div style="font-weight:700;font-size:16px;">Pembayaran ${methodLabel}</div>
            <div style="font-size:12px;opacity:0.6;">${expiredAt ? `Berakhir: ${expiredAt}` : ''}</div>
          </div>
          <button id="rb-pm-close" aria-label="Tutup" style="
            margin-left:auto;background:none;border:none;color:#e0e0e0;
            font-size:22px;cursor:pointer;line-height:1;padding:4px 8px;
          ">×</button>
        </div>

        <!-- Amount -->
        <div style="text-align:center;padding:24px 24px 8px;">
          <div style="font-size:12px;opacity:0.6;margin-bottom:4px;">Total Bayar</div>
          <div style="font-size:36px;font-weight:800;letter-spacing:-1px;color:#4ade80;">
            Rp ${this.#formatMoney(amount)}
          </div>
          <div id="rb-pm-ref" style="font-size:12px;opacity:0.5;margin-top:6px;word-break:break-all;">
            Ref: ${reference}
          </div>
        </div>

        <!-- Status indicator -->
        <div id="rb-pm-status-bar" style="
          margin:0 24px 16px;border-radius:10px;
          background:#2a2a3e;padding:12px 16px;
          display:flex;align-items:center;gap:10px;
          font-size:13px;
        ">
          <span id="rb-pm-spinner" style="font-size:18px;">⏳</span>
          <span id="rb-pm-status-text">Menunggu pembayaran…</span>
        </div>

        ${isQRIS && payment.qr_string
          ? this.#qrisPanel(payment.qr_string, reference)
          : instructions.length > 0
            ? this.#instructionsPanel(instructions)
            : this.#copyablePanel(reference, payment)
        }

        <!-- Actions -->
        <div style="padding:16px 24px 24px;display:flex;flex-direction:column;gap:10px;">
          <button id="rb-pm-copy" style="
            width:100%;padding:13px;border:1px solid #4361ee;
            background:transparent;color:#4361ee;border-radius:10px;
            font-size:14px;font-weight:600;cursor:pointer;
          ">
            Salin Kode Pembayaran
          </button>
          <button id="rb-pm-done" style="
            width:100%;padding:13px;border:none;
            background:#4361ee;color:#fff;border-radius:10px;
            font-size:14px;font-weight:600;cursor:pointer;
          ">
            Saya Sudah Bayar
          </button>
          <button id="rb-pm-cancel" style="
            width:100%;padding:10px;border:none;background:none;
            color:#888;font-size:13px;cursor:pointer;
          ">
            Batal & Kembali
          </button>
        </div>
      </div>

      <style>
        @keyframes rb-modal-fadein { from { opacity:0; } to { opacity:1; } }
        .rb-pm-step { display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #2a2a3e; }
        .rb-pm-step:last-child { border-bottom:none; }
        .rb-pm-num { min-width:24px;height:24px;border-radius:50%;background:#4361ee;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center; }
        .rb-pm-text { font-size:13px;line-height:1.5;padding-top:2px; }
      </style>
    `;

    document.body.appendChild(modal);
    this.#modal = modal;

    // ── Event listeners ────────────────────────────────────────────────────────

    modal.querySelector('#rb-pm-close')?.addEventListener('click', () => this.cancel());
    modal.querySelector('#rb-pm-cancel')?.addEventListener('click', () => this.cancel());

    modal.querySelector('#rb-pm-copy')?.addEventListener('click', () => {
      this.copyToClipboard(reference);
    });

    modal.querySelector('#rb-pm-done')?.addEventListener('click', async () => {
      // Manual "I've paid" → immediate verification
      await this.#verifyNow(reference, orderId);
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.cancel();
    });

    // Close on Escape
    const onKey = (e) => { if (e.key === 'Escape') { this.cancel(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
  }

  static #qrisPanel(qrString, reference) {
    return `
      <div style="padding:0 24px 8px;text-align:center;">
        <div id="rb-pm-qr" style="display:inline-block;background:#fff;padding:12px;border-radius:12px;margin-bottom:8px;">
          <!-- QR code rendered by JS below -->
        </div>
        <div style="font-size:11px;opacity:0.5;">Pindai dengan aplikasi bank atau e-wallet</div>
      </div>
      <script>
        // Generate QR code via an embedded canvas approach
        // Requires qrcode.js loaded separately; graceful fallback
        (function() {
          var container = document.getElementById('rb-pm-qr');
          if (typeof QRCode === 'undefined') {
            container.innerHTML = '<div style="width:180px;height:180px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#888;font-size:12px;">QR tidak tersedia</div>';
            return;
          }
          var qr = new QRCode(container, { text: ${JSON.stringify(qrString)}, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M });
        })();
      <\/script>
    `;
  }

  static #instructionsPanel(instructions) {
    const html = Array.isArray(instructions)
      ? instructions.map((step, i) => `
          <div class="rb-pm-step">
            <div class="rb-pm-num">${i + 1}</div>
            <div class="rb-pm-text">${escapeHtml(step)}</div>
          </div>
        `).join('')
      : '';

    return `
      <div style="margin:0 24px 16px;background:#2a2a3e;border-radius:10px;padding:14px 16px;">
        <div style="font-size:12px;font-weight:600;opacity:0.6;margin-bottom:10px;">Cara Bayar</div>
        ${html}
      </div>
    `;
  }

  static #copyablePanel(reference, payment) {
    const payCode = payment.pay_code ?? payment.account_number ?? reference;
    return `
      <div style="margin:0 24px 16px;background:#2a2a3e;border-radius:10px;padding:14px 16px;text-align:center;">
        <div style="font-size:11px;opacity:0.5;margin-bottom:6px;">Kode Pembayaran</div>
        <div style="font-size:18px;font-weight:700;letter-spacing:2px;font-family:monospace;word-break:break-all;">
          ${escapeHtml(String(payCode))}
        </div>
      </div>
    `;
  }

  // ── Status Updates ─────────────────────────────────────────────────────────

  /** Update the modal's status bar. */
  static #updateStatusUI(status, text) {
    if (!this.#modal) return;
    const spinner = this.#modal.querySelector('#rb-pm-spinner');
    const statusText = this.#modal.querySelector('#rb-pm-status-text');
    const statusBar = this.#modal.querySelector('#rb-pm-status-bar');
    if (spinner) spinner.textContent = STATUS_ICON[status] ?? '⏳';
    if (statusText) statusText.textContent = text;
    if (statusBar) {
      const colorMap = {
        pending: '#f59e0b', paid: '#10b981',
        expired: '#ef4444', failed: '#ef4444', cancelled: '#888',
      };
      statusBar.style.borderLeft = `4px solid ${colorMap[status] ?? '#888'}`;
    }
  }

  // ── Payment resolution ─────────────────────────────────────────────────────

  static async #handlePaid(paymentData, orderId) {
    this.#updateStatusUI('paid', 'Pembayaran berhasil!');
    window.RB?.emit('toast', { type: 'success', message: 'Pembayaran berhasil!' });

    // Update order status on backend
    try {
      await OrderService.updateStatus(orderId, 'completed');
      invalidateScreen('orders');
      invalidateScreen('dashboard');
    } catch {
      // Non-fatal — backend may have already updated
    }

    // Send WhatsApp receipt if customer phone available
    const ctx = this.#context;
    if (ctx?.customer?.phone) {
      WhatsAppService.send({
        to: ctx.customer.phone,
        template: 'receipt',
        data: {
          order_id: String(orderId),
          amount: this.#formatMoney(ctx.amount),
          reference: paymentData.reference ?? ctx.reference,
        },
      }).catch(() => {}); // non-fatal
    }

    // Show success then dismiss
    await this.#showSuccessScreen(paymentData);

    this.#context?.onSuccess?.(orderId, paymentData);
    this.#context = null;

    setTimeout(() => this.#dismissModal(), 3000);
  }

  static #handleFailure(status, paymentData) {
    const label = STATUS_LABEL[status] ?? status;
    this.#updateStatusUI(status, label);
    window.RB?.emit('toast', { type: 'error', message: `Pembayaran ${label.toLowerCase()}.` });
    this.#context?.onFailure?.(status, paymentData);
    this.#context = null;
    setTimeout(() => this.#dismissModal(), 4000);
  }

  static #handleExpiry() {
    this.#stopPolling();
    this.#handleFailure('expired', null);
  }

  static async #verifyNow(reference, orderId) {
    this.#updateStatusUI('pending', 'Memverifikasi…');
    const res = await PaymentService.verify(reference);
    if (res.success) {
      const status = this.#normalizeStatus(res.data?.status);
      if (status === 'paid') {
        await this.#handlePaid(res.data, orderId);
      } else {
        this.#updateStatusUI(status, STATUS_LABEL[status] ?? 'Status tidak diketahui');
      }
    } else {
      this.#updateStatusUI('pending', 'Menunggu pembayaran…');
      window.RB?.emit('toast', { type: 'info', message: 'Pembayaran belum tercatat. Silakan tunggu beberapa saat.' });
    }
  }

  // ── Success Screen ─────────────────────────────────────────────────────────

  static async #showSuccessScreen(paymentData) {
    if (!this.#modal) return;
    const body = this.#modal.querySelector('div[style*="border-radius:16px"]');
    if (!body) return;

    body.innerHTML = `
      <div style="text-align:center;padding:40px 24px;">
        <div style="font-size:72px;margin-bottom:16px;">✅</div>
        <h2 style="margin:0 0 8px;font-size:22px;color:#10b981;">Pembayaran Berhasil!</h2>
        <p style="margin:0 0 24px;opacity:0.7;font-size:14px;">
          ${paymentData?.reference ? `Referensi: ${escapeHtml(paymentData.reference)}` : ''}
        </p>
        <button onclick="document.getElementById('rb-payment-modal')?.remove();window.RB?.emit('payment:complete', {})" style="
          padding:14px 32px;background:#10b981;color:#fff;border:none;
          border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;
        ">Lihat Struk</button>
      </div>
    `;
  }

  // ── Deep Link ─────────────────────────────────────────────────────────────

  /**
   * Handle rectobase://payment deep links on mobile.
   * Call this from your app's deep-link handler or universal link router.
   *
   * @param {string} url  Full URL from the deep link
   */
  static handleDeepLink(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'rectobase:') return;

      const reference = parsed.searchParams.get('reference');
      const status    = parsed.searchParams.get('status');
      const orderId   = parsed.searchParams.get('order_id');

      if (reference) {
        // Deep link arrived with payment result
        if (status === 'success') {
          this.#handlePaid({ reference, status: 'PAID' }, Number(orderId));
        } else if (status === 'failed' || status === 'expired') {
          this.#handleFailure(status, { reference });
        } else {
          // Just verify the reference
          if (orderId) this.#verifyNow(reference, Number(orderId));
        }
      }
    } catch {
      // Not a valid URL
    }
  }

  // ── Clipboard ─────────────────────────────────────────────────────────────

  /**
   * Copy text to clipboard with fallback and feedback.
   * @param {string} text
   */
  static async copyToClipboard(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.cssText = 'position:fixed;top:-999px;left:-999px;';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        el.remove();
      }
      window.RB?.emit('toast', { type: 'success', message: 'Kode berhasil disalin!' });
    } catch {
      window.RB?.emit('toast', { type: 'error', message: 'Gagal menyalin.' });
    }
  }

  // ── Modal dismissal ───────────────────────────────────────────────────────

  static #dismissModal() {
    if (this.#modal) {
      this.#modal.remove();
      this.#modal = null;
    }
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  static #normalizeStatus(raw) {
    if (!raw) return 'pending';
    return PAYMENT_STATUS_MAP[String(raw).toUpperCase()] ?? 'pending';
  }

  static #formatMoney(amount) {
    return new Intl.NumberFormat('id-ID').format(Number(amount) || 0);
  }

  static #formatExpiry(date) {
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(date);
  }

  static #channelLabel(method) {
    const map = {
      QRIS:      'QRIS',
      VA_BCA:    'Virtual Account BCA',
      VA_MANDIRI:'Virtual Account Mandiri',
      VA_BNI:    'Virtual Account BNI',
      VA_BRI:    'Virtual Account BRI',
      OVO:       'OVO',
      DANA:      'DANA',
      LINKAJA:   'LinkAja',
      SHOPEEPAY: 'ShopeePay',
    };
    return map[method] ?? method;
  }
}

// ─── Escape helper ─────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Expose on window ──────────────────────────────────────────────────────────

window.PaymentHandler = PaymentHandler;
