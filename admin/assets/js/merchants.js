/* =========================================
   RectoBase Admin Panel — Merchants JS
   ========================================= */

(function () {
  if (!document.getElementById('merchants-page')) return;

  let table;
  let selectedIds = new Set();

  // ─── Column Definitions ─────────────────────────────────────────────────────
  function getColumns() {
    return [
      { key: 'checkbox', label: '', width: '44px', thClass: 'checkbox-col', sortable: false },
      { key: 'name', label: 'Nama Merchant', sortable: true },
      { key: 'owner', label: 'Pemilik', sortable: true },
      { key: 'plan', label: 'Plan', sortable: true, thClass: 'text-center', tdClass: 'text-center' },
      { key: 'status', label: 'Status', sortable: true, thClass: 'text-center', tdClass: 'text-center' },
      { key: 'outlets', label: 'Outlet', sortable: true, thClass: 'text-center', tdClass: 'text-center' },
      { key: 'mrr', label: 'MRR', sortable: true, tdClass: 'text-right' },
      { key: 'created', label: 'Bergabung', sortable: true },
      { key: 'actions', label: '', width: '120px', sortable: false },
    ];
  }

  // ─── Row Renderer ──────────────────────────────────────────────────────────
  function renderRow(m) {
    const planCls = { starter: 'badge-starter', professional: 'badge-professional', enterprise: 'badge-enterprise' };
    const status = Format.status(m.status);
    const plan = Format.plan(m.plan);
    const isSelected = selectedIds.has(m.id);

    return `
      <tr data-id="${m.id}" class="${isSelected ? 'selected' : ''}">
        <td class="checkbox-col">
          <input type="checkbox" ${isSelected ? 'checked' : ''} data-id="${m.id}" aria-label="Pilih ${m.name}">
        </td>
        <td>
          <div class="font-semibold" style="color:var(--color-text);">${m.name}</div>
          <div class="text-xs text-muted">${m.email}</div>
        </td>
        <td>${m.owner}</td>
        <td class="text-center">
          <span class="badge ${planCls[m.plan] || ''}">${plan}</span>
        </td>
        <td class="text-center">
          <span class="badge ${status.cls}">${status.label}</span>
        </td>
        <td class="text-center">${m.outlets}</td>
        <td class="text-right">${m.status === 'trial' ? '<span class="text-muted">—</span>' : Format.currency(m.mrr)}</td>
        <td>${Format.date(m.created)}</td>
        <td>
          <div class="table-actions">
            <a href="merchant-detail.html?id=${m.id}" class="table-action-btn" title="Lihat Detail">${Icons.eye}</a>
            <button class="table-action-btn" title="Edit" onclick="openEditModal(${m.id})">${Icons.edit}</button>
            <div class="dropdown" style="display:inline-block;">
              <button class="table-action-btn" data-dropdown-toggle="actions-${m.id}" title="Lebih Banyak">${Icons.moreVertical}</button>
              <div class="dropdown-menu" id="actions-${m.id}">
                ${m.status === 'suspended'
                  ? `<button class="dropdown-item" onclick="activateMerchant(${m.id}, '${m.name}')">${Icons.play} Aktifkan</button>`
                  : `<button class="dropdown-item" onclick="suspendMerchant(${m.id}, '${m.name}')">${Icons.pause} Suspkan</button>`
                }
                <button class="dropdown-item" onclick="openEditModal(${m.id})">${Icons.edit} Edit</button>
                <div class="dropdown-divider"></div>
                <button class="dropdown-item danger" onclick="deleteMerchant(${m.id}, '${m.name}')">${Icons.trash} Hapus</button>
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  // ─── Load Data ─────────────────────────────────────────────────────────────
  async function loadMerchants(page = 1) {
    const params = {
      page,
      limit: 10,
      search: document.getElementById('search-input')?.value || '',
      plan: document.getElementById('filter-plan')?.value || '',
      status: document.getElementById('filter-status')?.value || '',
    };

    try {
      const data = await API.getMerchants(params);
      table = table || new TableRenderer({
        container: '#merchants-table-container',
        columns: getColumns(),
        rowRenderer: renderRow,
        onPage: loadMerchants,
      });
      table.setData(data.items, data.total, page, 10);
      updateBulkActions();
    } catch (err) {
      Toast.error('Gagal memuat data merchant', err.message);
    }
  }

  // ─── Search & Filter ───────────────────────────────────────────────────────
  const debouncedSearch = debounce(() => loadMerchants(1), 350);

  function initFilters() {
    const searchInput = document.getElementById('search-input');
    const planFilter = document.getElementById('filter-plan');
    const statusFilter = document.getElementById('filter-status');

    if (searchInput) searchInput.addEventListener('input', debouncedSearch);
    if (planFilter) planFilter.addEventListener('change', () => loadMerchants(1));
    if (statusFilter) statusFilter.addEventListener('change', () => loadMerchants(1));

    // Checkbox select all
    document.addEventListener('change', (e) => {
      if (e.target.matches('[data-select-all]')) {
        const checked = e.target.checked;
        document.querySelectorAll('#merchants-table-container tbody input[type="checkbox"]').forEach(cb => {
          cb.checked = checked;
          const id = parseInt(cb.dataset.id);
          if (checked) selectedIds.add(id);
          else selectedIds.delete(id);
          const row = document.querySelector(`tr[data-id="${id}"]`);
          if (row) row.classList.toggle('selected', checked);
        });
        updateBulkActions();
      }
      if (e.target.matches('#merchants-table-container tbody input[type="checkbox"]')) {
        const id = parseInt(e.target.dataset.id);
        if (e.target.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        const row = document.querySelector(`tr[data-id="${id}"]`);
        if (row) row.classList.toggle('selected', e.target.checked);
        updateBulkActions();
      }
    });
  }

  function updateBulkActions() {
    const bulkBar = document.getElementById('bulk-actions-bar');
    const countEl = document.getElementById('selected-count');
    if (!bulkBar) return;
    if (selectedIds.size > 0) {
      bulkBar.style.display = '';
      if (countEl) countEl.textContent = selectedIds.size;
    } else {
      bulkBar.style.display = 'none';
    }
  }

  // ─── Bulk Actions ──────────────────────────────────────────────────────────
  async function bulkSuspend() {
    if (selectedIds.size === 0) return;
    const ok = await confirm({
      title: 'Suspkan Merchant?',
      message: `${selectedIds.size} merchant akan disuspkan. Mereka tidak bisa login sampai diaktifkan kembali.`,
      confirmText: 'Ya, Suspkan',
      danger: true,
    });
    if (!ok) return;
    // In demo mode, just simulate
    Toast.success('Berhasil', `${selectedIds.size} merchant berhasil disuspkan.`);
    selectedIds.clear();
    updateBulkActions();
    loadMerchants(1);
  }

  async function bulkExport() {
    try {
      const data = await API.getMerchants({ limit: 1000 });
      const exportData = data.items.map(m => ({
        'Nama Merchant': m.name,
        Email: m.email,
        Pemilik: m.owner,
        Plan: Format.plan(m.plan),
        Status: Format.status(m.status).label,
        'Jumlah Outlet': m.outlets,
        MRR: Format.currency(m.mrr).replace('Rp ', ''),
        Kota: m.city,
        'Tanggal Bergabung': Format.date(m.created),
      }));
      exportCSV(exportData, `merchants_${new Date().toISOString().split('T')[0]}.csv`);
      Toast.success('Diekspor', 'File CSV berhasil diunduh.');
    } catch (err) {
      Toast.error('Gagal ekspor', err.message);
    }
  }

  // ─── Suspend / Activate ────────────────────────────────────────────────────
  async function suspendMerchant(id, name) {
    const ok = await confirm({
      title: 'Suspkan Merchant?',
      message: `"${name}" tidak akan bisa login sampai diaktifkan kembali.`,
      confirmText: 'Ya, Suspkan',
      danger: true,
    });
    if (!ok) return;
    try {
      await API.suspendMerchant(id);
      Toast.success('Disuspkan', `"${name}" berhasil disuspkan.`);
      loadMerchants(parseInt(document.querySelector('.pagination-btn.active')?.textContent) || 1);
    } catch (err) {
      Toast.error('Gagal', err.message);
    }
  }

  async function activateMerchant(id, name) {
    try {
      await API.activateMerchant(id);
      Toast.success('Diaktifkan', `"${name}" berhasil diaktifkan.`);
      loadMerchants(parseInt(document.querySelector('.pagination-btn.active')?.textContent) || 1);
    } catch (err) {
      Toast.error('Gagal', err.message);
    }
  }

  async function deleteMerchant(id, name) {
    const ok = await confirm({
      title: 'Hapus Merchant?',
      message: `"${name}" dan semua datanya akan dihapus secara permanen. Tindakan ini tidak bisa dibatalkan.`,
      confirmText: 'Ya, Hapus Permanen',
      danger: true,
    });
    if (!ok) return;
    try {
      await API.deleteMerchant(id);
      Toast.success('Dihapus', `"${name}" berhasil dihapus.`);
      selectedIds.delete(id);
      updateBulkActions();
      loadMerchants(1);
    } catch (err) {
      Toast.error('Gagal', err.message);
    }
  }

  // ─── Edit Modal ────────────────────────────────────────────────────────────
  let editMerchantData = null;

  async function openEditModal(id) {
    try {
      const m = await API.getMerchant(id);
      editMerchantData = m;
      document.getElementById('edit-id').value = m.id;
      document.getElementById('edit-name').value = m.name;
      document.getElementById('edit-email').value = m.email;
      document.getElementById('edit-owner').value = m.owner;
      document.getElementById('edit-phone').value = m.phone;
      document.getElementById('edit-plan').value = m.plan;
      document.getElementById('edit-city').value = m.city;
      openModal('edit-modal');
    } catch (err) {
      Toast.error('Gagal memuat data', err.message);
    }
  }

  async function saveEditMerchant() {
    const btn = document.getElementById('save-edit-btn');
    setLoading(btn, true);
    try {
      const data = {
        name: document.getElementById('edit-name').value,
        email: document.getElementById('edit-email').value,
        owner: document.getElementById('edit-owner').value,
        phone: document.getElementById('edit-phone').value,
        plan: document.getElementById('edit-plan').value,
        city: document.getElementById('edit-city').value,
      };
      await API.updateMerchant(document.getElementById('edit-id').value, data);
      closeModal('edit-modal');
      Toast.success('Disimpan', 'Data merchant berhasil diperbarui.');
      loadMerchants(1);
    } catch (err) {
      Toast.error('Gagal menyimpan', err.message);
    } finally {
      setLoading(btn, false);
    }
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  function init() {
    initFilters();
    loadMerchants(1);

    // Bulk action buttons
    const bulkSuspendBtn = document.getElementById('bulk-suspend-btn');
    const bulkExportBtn = document.getElementById('bulk-export-btn');
    const saveEditBtn = document.getElementById('save-edit-btn');

    if (bulkSuspendBtn) bulkSuspendBtn.addEventListener('click', bulkSuspend);
    if (bulkExportBtn) bulkExportBtn.addEventListener('click', bulkExport);
    if (saveEditBtn) saveEditBtn.addEventListener('click', saveEditMerchant);
  }

  // Expose globals for inline handlers
  window.suspendMerchant = suspendMerchant;
  window.activateMerchant = activateMerchant;
  window.deleteMerchant = deleteMerchant;
  window.openEditModal = openEditModal;

  init();
})();
