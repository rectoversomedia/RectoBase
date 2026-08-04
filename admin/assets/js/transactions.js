/* =========================================
   RectoBase Admin Panel — Transactions JS
   ========================================= */

(function () {
  if (!document.getElementById('transactions-page')) return;

  let table;

  const statusColors = {
    success: 'badge-active',
    pending: 'badge-trial',
    failed: 'badge-expired',
  };

  const methodIcons = {
    bank_transfer: 'Transfer',
    ewallet: 'E-Wallet',
    credit_card: 'Kartu Kredit',
    qris: 'QRIS',
    cash: 'Tunai',
  };

  // ─── Columns ───────────────────────────────────────────────────────────────
  function getColumns() {
    return [
      { key: 'id', label: 'ID Transaksi', sortable: true },
      { key: 'merchant', label: 'Merchant', sortable: true },
      { key: 'amount', label: 'Jumlah', sortable: true, tdClass: 'text-right', thClass: 'text-right' },
      { key: 'method', label: 'Metode', sortable: true, thClass: 'text-center', tdClass: 'text-center' },
      { key: 'fee', label: 'Fee (2.5%)', sortable: false, tdClass: 'text-right text-muted text-sm', thClass: 'text-right' },
      { key: 'status', label: 'Status', sortable: true, thClass: 'text-center', tdClass: 'text-center' },
      { key: 'date', label: 'Tanggal', sortable: true },
      { key: 'actions', label: '', width: '60px', sortable: false },
    ];
  }

  function renderRow(t) {
    const status = Format.status(t.status);
    return `
      <tr data-id="${t.id}" style="cursor:pointer;">
        <td><span class="mono">${t.id}</span></td>
        <td>
          <div class="font-semibold">${t.merchant}</div>
          <div class="text-xs text-muted">Ref: ${t.reference}</div>
        </td>
        <td class="text-right font-semibold">${Format.currency(t.amount)}</td>
        <td class="text-center">
          <span class="badge badge-info">${methodIcons[t.method] || t.method}</span>
        </td>
        <td class="text-right text-muted text-sm">${Format.currency(t.fee)}</td>
        <td class="text-center">
          <span class="badge ${statusColors[t.status] || ''}">${status.label}</span>
        </td>
        <td>
          <div>${Format.date(t.date)}</div>
          <div class="text-xs text-muted">${new Date(t.date).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</div>
        </td>
        <td>
          <button class="table-action-btn" title="Lihat Detail" onclick="showTransactionDetail('${t.id}')">${Icons.eye}</button>
        </td>
      </tr>
    `;
  }

  // ─── Load Data ─────────────────────────────────────────────────────────────
  async function loadTransactions(page = 1) {
    const params = {
      page,
      limit: 15,
      search: document.getElementById('search-input')?.value || '',
      status: document.getElementById('filter-status')?.value || '',
      dateFrom: document.getElementById('filter-date-from')?.value || '',
      dateTo: document.getElementById('filter-date-to')?.value || '',
    };

    try {
      const data = await API.getTransactions(params);

      table = table || new TableRenderer({
        container: '#transactions-table-container',
        columns: getColumns(),
        rowRenderer: renderRow,
        onPage: loadTransactions,
      });
      table.setData(data.items, data.total, page, 15);

      // Row click to view detail
      document.querySelectorAll('#transactions-table-container tbody tr[data-id]').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          showTransactionDetail(row.dataset.id);
        });
      });

      updateStats(data.items);
    } catch (err) {
      Toast.error('Gagal memuat transaksi', err.message);
    }
  }

  // ─── Stats Summary ─────────────────────────────────────────────────────────
  function updateStats(items) {
    const total = items.reduce((s, t) => s + (t.status === 'success' ? t.amount : 0), 0);
    const count = items.filter(t => t.status === 'success').length;
    const el = document.getElementById('txn-summary');
    if (el) {
      el.innerHTML = `
        <div class="text-sm text-muted">Total halaman ini:</div>
        <div class="font-bold" style="font-size:1.125rem;">${Format.currency(total)}</div>
        <div class="text-xs text-muted">${count} transaksi berhasil</div>
      `;
    }
  }

  // ─── Transaction Detail Modal ───────────────────────────────────────────────
  let allTransactions = [];

  async function showTransactionDetail(id) {
    try {
      const { items } = await API.getTransactions({ limit: 100 });
      allTransactions = items;
      const t = items.find(tx => tx.id === id);
      if (!t) return;

      const modal = document.getElementById('txn-detail-modal');
      if (!modal) return;

      document.getElementById('txn-detail-id').textContent = t.id;
      document.getElementById('txn-detail-merchant').textContent = t.merchant;
      document.getElementById('txn-detail-amount').textContent = Format.currency(t.amount);
      document.getElementById('txn-detail-method').textContent = Format.method(t.method);
      document.getElementById('txn-detail-fee').textContent = Format.currency(t.fee);
      document.getElementById('txn-detail-total').textContent = Format.currency(t.amount - t.fee);
      document.getElementById('txn-detail-status').innerHTML = `<span class="badge ${statusColors[t.status] || ''}">${Format.status(t.status).label}</span>`;
      document.getElementById('txn-detail-date').textContent = Format.datetime(t.date);
      document.getElementById('txn-detail-reference').textContent = t.reference;

      openModal('txn-detail-modal');
    } catch (err) {
      Toast.error('Gagal memuat detail', err.message);
    }
  }

  // ─── Filters ──────────────────────────────────────────────────────────────
  const debouncedSearch = debounce(() => loadTransactions(1), 350);

  function initFilters() {
    const searchInput = document.getElementById('search-input');
    const statusFilter = document.getElementById('filter-status');
    const dateFrom = document.getElementById('filter-date-from');
    const dateTo = document.getElementById('filter-date-to');

    if (searchInput) searchInput.addEventListener('input', debouncedSearch);
    if (statusFilter) statusFilter.addEventListener('change', () => loadTransactions(1));
    if (dateFrom) dateFrom.addEventListener('change', () => loadTransactions(1));
    if (dateTo) dateTo.addEventListener('change', () => loadTransactions(1));

    // Set default date range (last 30 days)
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    if (dateTo) dateTo.value = today.toISOString().split('T')[0];
    if (dateFrom) dateFrom.value = thirtyDaysAgo.toISOString().split('T')[0];
  }

  // ─── Export ───────────────────────────────────────────────────────────────
  async function exportTransactions() {
    try {
      const { items } = await API.getTransactions({ limit: 500 });
      const exportData = items.map(t => ({
        'ID Transaksi': t.id,
        Merchant: t.merchant,
        Jumlah: Format.currency(t.amount).replace('Rp ', ''),
        'Metode Pembayaran': Format.method(t.method),
        Fee: Format.currency(t.fee).replace('Rp ', ''),
        Status: Format.status(t.status).label,
        Tanggal: Format.datetime(t.date),
        Referensi: t.reference,
      }));
      exportCSV(exportData, `transactions_${new Date().toISOString().split('T')[0]}.csv`);
      Toast.success('Diekspor', 'File CSV berhasil diunduh.');
    } catch (err) {
      Toast.error('Gagal ekspor', err.message);
    }
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  function init() {
    initFilters();
    loadTransactions(1);

    const exportBtn = document.getElementById('export-transactions-btn');
    if (exportBtn) exportBtn.addEventListener('click', exportTransactions);
  }

  window.showTransactionDetail = showTransactionDetail;
  init();
})();
