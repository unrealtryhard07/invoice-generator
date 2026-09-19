/* Non-editor views: invoice list, customers + statements, saved charges, settings. */
(function (NB) {
  'use strict';

  const { calc, ledger, store, ui, defaults } = NB;
  const { esc } = ui;
  const $ = (sel) => document.querySelector(sel);

  const FILTERS = {
    all: () => true,
    draft: (status) => status === 'draft',
    open: (status) => ['unpaid', 'partial', 'overdue'].includes(status),
    overdue: (status) => status === 'overdue',
    paid: (status) => status === 'paid' || status === 'overpaid',
  };

  let ctx = null;
  const listState = { filter: 'all', query: '' };
  const customerState = { key: '', from: '', to: '', currency: '' };
  let chargeQuery = '';

  const fmt = (n, inv) => calc.formatNumber(n, calc.toNum(inv.currency.decimals), inv.theme.grouping);
  const fmtCode = (n, decimals, code) => `${calc.formatNumber(n, decimals)} ${code}`;
  const dateText = (iso, inv) => (iso ? calc.formatDate(iso, inv.theme.dateFormat) : '—');
  const emptyState = (iconName, title, text, action = '') => `<div class="empty-state">${ui.icon(iconName)}<h2>${esc(title)}</h2><p>${esc(text)}</p>${action}</div>`;

  /* ---------- invoices ---------- */
  function summaryBar(entries) {
    const byCurrency = {};
    entries.forEach(({ inv }) => { byCurrency[inv.currency.code] = (byCurrency[inv.currency.code] || 0) + 1; });
    const code = Object.keys(byCurrency).sort((a, b) => byCurrency[b] - byCurrency[a])[0];
    if (!code) return '';
    const same = entries.filter(({ inv }) => inv.currency.code === code);
    const d = calc.toNum(same[0].inv.currency.decimals);
    const month = ctx.today().slice(0, 7);
    const sumBy = (pick) => calc.round(same.reduce((acc, e) => acc + pick(e), 0), d);
    const outstanding = sumBy((e) => (FILTERS.open(e.status) ? e.totals.balance : 0));
    const overdue = sumBy((e) => (e.status === 'overdue' ? e.totals.balance : 0));
    const collected = sumBy((e) => (e.inv.payments || []).filter((p) => String(p.date).startsWith(month)).reduce((a, p) => a + calc.toNum(p.amount), 0));
    const stat = (label, value, alert = false) => `<div class="${alert && value ? 'is-alert' : ''}"><span>${label}</span><strong>${esc(calc.formatNumber(value, d))}<small>${esc(code)}</small></strong></div>`;
    return `<div class="totals-bar">${stat('Outstanding', outstanding)}${stat('Overdue', overdue, true)}${stat('Collected this month', collected)}</div>`;
  }

  function renderInvoices() {
    const today = ctx.today();
    const entries = ctx.listInvoices().map((inv) => ({ inv, status: ledger.status(inv, today), totals: calc.computeTotals(inv) }));
    const q = listState.query.trim().toLowerCase();
    const shown = entries.filter((e) => FILTERS[listState.filter](e.status)
      && (!q || [e.inv.number, e.inv.customer.name, e.inv.customer.nameAr, e.inv.title].some((v) => String(v || '').toLowerCase().includes(q))));

    document.querySelectorAll('#invoice-filter [data-filter]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.filter === listState.filter)));
    $('#invoices-subtitle').textContent = `${entries.length} document${entries.length === 1 ? '' : 's'}`;

    if (!entries.length) {
      $('#invoice-list').innerHTML = emptyState('doc', 'No invoices yet', 'Create your first invoice — it saves automatically as you type.', '<button type="button" class="btn btn--primary" data-cmd="new">New Invoice</button>');
      return;
    }
    const rows = shown.map(({ inv, status, totals }) => {
      const late = status === 'overdue' ? `<div class="late">${ledger.overdueDays(inv, today)} days late</div>` : '';
      return `<tr data-open="${esc(inv.id)}">
        <td><a class="doc-link" href="#/invoice/${encodeURIComponent(inv.id)}"><strong>${esc(inv.number || 'Unnumbered')}</strong><span>${esc(inv.title)}</span></a></td>
        <td class="customer-cell">${esc(inv.customer.name || '—')}${inv.customer.nameAr ? `<div class="sub" dir="rtl">${esc(inv.customer.nameAr)}</div>` : ''}</td>
        <td class="hide-sm">${esc(dateText(ledger.invoiceDate(inv), inv))}</td>
        <td class="hide-sm">${esc(dateText(ledger.dueDate(inv), inv))}${late}</td>
        <td class="num hide-sm">${esc(fmt(totals.total, inv))}</td>
        <td class="num"><strong>${esc(fmt(totals.balance, inv))}</strong> <span class="sub">${esc(inv.currency.code)}</span></td>
        <td>${ui.statusPill(status)}</td>
        <td class="actions">${ui.tool('copy', 'list-duplicate', { id: inv.id }, 'Duplicate')}${ui.tool('trash', 'list-delete', { id: inv.id }, 'Delete', true)}</td>
      </tr>`;
    }).join('');
    $('#invoice-list').innerHTML = `${summaryBar(entries)}
      <table class="table"><thead><tr><th>Document</th><th>Customer</th><th class="hide-sm">Date</th><th class="hide-sm">Due</th>
      <th class="num hide-sm">Total</th><th class="num">Balance</th><th>Status</th><th aria-label="Actions"></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8">${emptyState('doc', 'Nothing here', 'No invoices match this filter.')}</td></tr>`}</tbody></table>`;
  }

  /* ---------- customers & statements ---------- */
  function customerDetails(key) {
    const latest = ctx.listInvoices().filter((inv) => ledger.customerKey(inv.customer.name) === key)
      .sort((a, b) => ledger.invoiceDate(b).localeCompare(ledger.invoiceDate(a)))[0];
    return latest ? latest.customer : { name: key };
  }

  function renderCustomers(routeKey) {
    const today = ctx.today();
    const invoices = ctx.listInvoices();
    const customers = ledger.customers(invoices, today);
    if (routeKey) customerState.key = routeKey;
    if (!customers.some((c) => c.key === customerState.key)) customerState.key = customers[0] ? customers[0].key : '';
    const overdueTotal = customers.reduce((a, c) => a + c.overdueCount, 0);
    $('#customers-subtitle').textContent = `${customers.length} with activity${overdueTotal ? ` · ${overdueTotal} overdue invoice${overdueTotal === 1 ? '' : 's'}` : ''}`;

    if (!customers.length) {
      $('#customer-list').innerHTML = '';
      $('#statement-controls').innerHTML = '';
      ctx.statementCanvas.render(emptyState('people', 'No customer activity yet', 'Customers appear here once an invoice is marked Sent or receives a payment.'));
      return;
    }

    $('#customer-list').innerHTML = customers.map((c) => `<button type="button" class="customer-item" data-customer="${esc(c.key)}" aria-current="${c.key === customerState.key}">
        <strong>${esc(c.name)}</strong><span class="bal">${esc(fmtCode(c.primary.balance, c.primary.decimals, c.primary.code))}</span>
        <span class="sub">${c.count} document${c.count === 1 ? '' : 's'}</span>${c.overdueCount ? `<span class="late">${c.overdueCount} overdue</span>` : '<span></span>'}
      </button>`).join('');

    const current = customers.find((c) => c.key === customerState.key);
    const codes = Object.keys(current.byCurrency);
    if (!codes.includes(customerState.currency)) customerState.currency = current.primary.code;
    $('#statement-controls').innerHTML = `
      <label class="field-date">From <input type="date" data-statement="from" value="${esc(customerState.from)}"></label>
      <label class="field-date">To <input type="date" data-statement="to" value="${esc(customerState.to)}"></label>
      ${codes.length > 1 ? `<select data-statement="currency" aria-label="Currency">${codes.map((c) => `<option${c === customerState.currency ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
      <button type="button" class="btn btn--primary" data-cmd="print-statement">Print Statement</button>`;

    const brand = ctx.brand();
    const statement = ledger.statement(invoices, current.key, { currency: customerState.currency, from: customerState.from, to: customerState.to, today });
    ctx.statementCanvas.render(NB.statement.statementSheet({ brand, customer: customerDetails(current.key), statement, today }), brand.theme.paper);
    ctx.updatePageRule(brand.theme);
  }

  /* ---------- saved charges ---------- */
  function renderCharges(focusId) {
    const q = chargeQuery.trim().toLowerCase();
    const list = store.listCatalog().filter((c) => !q || c.name.toLowerCase().includes(q) || (c.nameAr || '').includes(q));
    const cell = (c, key, o = {}) => `<input ${o.type ? `type="${o.type}" step="any"` : ''} data-charge="${esc(c.id)}" data-field="${key}" value="${esc(c[key] ?? '')}" aria-label="${esc(o.label)}"${o.dir ? ` dir="${o.dir}"` : ''}>`;
    $('#charge-list').innerHTML = list.length ? `<table class="table charges-table"><thead><tr><th>Description</th><th>Arabic</th><th class="hide-sm">Unit</th><th class="num">Default price</th><th class="num hide-sm">Tax %</th><th aria-label="Actions"></th></tr></thead>
      <tbody>${list.map((c) => `<tr><td>${cell(c, 'name', { label: 'Description' })}</td><td class="ar">${cell(c, 'nameAr', { label: 'Arabic description', dir: 'rtl' })}</td>
        <td class="hide-sm">${cell(c, 'uom', { label: 'Unit' })}</td><td class="num">${cell(c, 'price', { type: 'number', label: 'Default price' })}</td>
        <td class="num hide-sm">${cell(c, 'tax', { type: 'number', label: 'Tax percent' })}</td>
        <td class="actions">${ui.tool('trash', 'charge-delete', { id: c.id }, 'Delete charge', true)}</td></tr>`).join('')}</tbody></table>`
      : emptyState('tag', q ? 'No matches' : 'No saved charges', 'Add the charges you bill often, with Arabic names and default prices.');
    if (focusId) {
      const el = document.querySelector(`[data-charge="${CSS.escape(focusId)}"][data-field="name"]`);
      if (el) el.focus();
    }
  }

  function onChargeInput(e) {
    const el = e.target.closest('[data-charge]');
    if (!el) return;
    const value = el.type === 'number' ? calc.toNum(el.value) : el.value;
    ctx.guard(() => store.saveCatalog(store.listCatalog().map((c) => (c.id === el.dataset.charge ? { ...c, [el.dataset.field]: value } : c))));
  }

  function addCharge() {
    const entry = { id: defaults.uid(), name: '', nameAr: '', uom: '', price: 0, tax: 0 };
    chargeQuery = '';
    $('#charge-search').value = '';
    ctx.guard(() => store.saveCatalog([entry, ...store.listCatalog()]));
    renderCharges(entry.id);
  }

  /* ---------- settings ---------- */
  function renderSettings() {
    const settings = ctx.settings();
    const setting = (label, key, o = {}) => `<div class="row"><label for="set-${key}">${esc(label)}</label><div class="row-control"><input id="set-${key}" ${o.type ? `type="${o.type}"` : ''} data-setting="${key}" value="${esc(settings[key])}"></div></div>`;
    const count = ctx.listInvoices().length;
    const currencies = Object.keys(defaults.CURRENCIES).map((c) => `<option${c === settings.baseCurrency ? ' selected' : ''}>${c}</option>`).join('');
    const templates = store.listTemplates().map((t) => (t.builtIn
      ? `<div class="row"><span class="row-label">${esc(t.name)}</span><div class="row-control"><span class="sub">Built-in</span></div></div>`
      : `<div class="row"><input class="field-input" data-template-name="${esc(t.id)}" value="${esc(t.name)}" aria-label="Template name" style="text-align:start">
          <div class="row-control">${ui.tool('trash', 'template-delete', { id: t.id }, `Delete ${t.name}`, true)}</div></div>`)).join('');
    $('#settings-body').innerHTML = [
      ui.group('Currency', `<div class="row"><label for="set-base">Base currency</label><div class="row-control"><select id="set-base" data-setting="baseCurrency">${currencies}</select></div></div>`,
        { foot: 'The Dashboard reports in this currency. Invoices in other currencies need an exchange rate (Items → Exchange Rate).' }),
      ui.group('Templates', templates, { foot: 'Save your own from any invoice: Document → Workflow → “Save this layout as a template”.' }),
      ui.group('Invoice Numbering', setting('Prefix', 'prefix') + setting('Pattern', 'pattern') + setting('Digits', 'pad', { type: 'number' }) + setting('Next number', 'next', { type: 'number' })
        + `<div class="row"><span class="row-label">Next invoice</span><div class="row-control"><strong id="number-preview">${esc(store.formatDocNumber(settings))}</strong></div></div>`,
      { foot: 'Pattern tokens: <code>{PREFIX}</code> <code>{YYYY}</code> <code>{YY}</code> <code>{MM}</code> <code>{SEQ}</code>' }),
      ui.group('Design Defaults', '<button type="button" class="add-row" data-cmd="reset-brand">Reset new-invoice design to factory defaults</button>',
        { foot: 'To change the defaults, open any invoice → Style → “Use this design and wording for new invoices”.' }),
      ui.group('Backup', `${storageMeter()}
          <div class="row row--toggle"><label for="set-backupFiles">Include attachments and fonts</label><span class="switch"><input type="checkbox" role="switch" id="set-backupFiles" data-setting="backupFiles"${settings.backupFiles ? ' checked' : ''}><i aria-hidden="true"></i></span></div>
          <button type="button" class="add-row" data-cmd="export-all">Export everything…</button><button type="button" class="add-row" data-cmd="import">Import backup…</button>`,
      { foot: `${count} document${count === 1 ? '' : 's'} stored in this browser only. Export a backup regularly — clearing browser data deletes them. Including attachments can make the backup file much larger.` }),
    ].join('');
  }

  function storageMeter() {
    const { chars, quota, ratio, nearlyFull: warn } = store.usage();
    const pct = Math.min(100, Math.round(ratio * 100));
    const mb = (n) => (n / (1024 * 1024)).toFixed(n < 1024 * 1024 ? 2 : 1);
    return `<div class="row storage-row${warn ? ' is-alert' : ''}"><span class="row-label">Storage used</span>
      <div class="row-control"><span class="meter" role="meter" aria-label="Browser storage used" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></span>
      <span class="sub">${mb(chars)} of ~${mb(quota)} MB · ${pct}%</span></div></div>${warn ? '<p class="field-warning" role="alert">Storage is nearly full. Export a backup, then delete documents you no longer need.</p>' : ''}`;
  }

  function onSettingInput(e) {
    const nameInput = e.target.closest('[data-template-name]');
    if (nameInput) {
      const template = store.listTemplates().find((t) => t.id === nameInput.dataset.templateName);
      if (template && nameInput.value.trim()) ctx.guard(() => store.saveTemplate({ ...template, name: nameInput.value }));
      return;
    }
    const el = e.target.closest('[data-setting]');
    if (!el) return;
    const value = el.type === 'checkbox' ? el.checked : el.type === 'number' ? calc.toNum(el.value) : el.value;
    if (el.type === 'checkbox' && e.type === 'input') return; // handled once, on change
    ctx.setSetting(el.dataset.setting, value);
    const preview = $('#number-preview');
    if (preview) preview.textContent = store.formatDocNumber(ctx.settings());
  }

  /* ---------- wiring ---------- */
  function onListClick(e) {
    const btn = e.target.closest('[data-act]');
    if (btn) {
      e.stopPropagation();
      ctx.command(btn.dataset.act, { id: btn.dataset.id });
      return;
    }
    const rowEl = e.target.closest('tr[data-open]');
    if (rowEl && !e.target.closest('a')) location.hash = `#/invoice/${encodeURIComponent(rowEl.dataset.open)}`;
  }

  function mount(context) {
    ctx = context;
    $('#invoice-filter').addEventListener('click', (e) => {
      const b = e.target.closest('[data-filter]');
      if (!b) return;
      listState.filter = b.dataset.filter;
      renderInvoices();
    });
    $('#invoice-search').addEventListener('input', (e) => { listState.query = e.target.value; renderInvoices(); });
    $('#invoice-list').addEventListener('click', onListClick);
    $('#customer-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-customer]');
      if (b) location.hash = `#/customers/${encodeURIComponent(b.dataset.customer)}`;
    });
    $('#statement-controls').addEventListener('change', (e) => {
      const el = e.target.closest('[data-statement]');
      if (!el) return;
      customerState[el.dataset.statement] = el.value;
      renderCustomers();
    });
    $('#charge-search').addEventListener('input', (e) => { chargeQuery = e.target.value; renderCharges(); });
    $('#charge-list').addEventListener('input', onChargeInput);
    $('#charge-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act="charge-delete"]');
      if (!b || !ui.confirmTwice(`charge-${b.dataset.id}`, 'Click delete again to remove this charge.')) return;
      ctx.guard(() => store.saveCatalog(store.listCatalog().filter((c) => c.id !== b.dataset.id)));
      renderCharges();
    });
    $('#settings-body').addEventListener('input', onSettingInput);
    $('#settings-body').addEventListener('change', onSettingInput);
    $('#settings-body').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act="template-delete"]');
      if (!b || !ui.confirmTwice(`template-${b.dataset.id}`, 'Click delete again to remove this template.')) return;
      ctx.guard(() => store.deleteTemplate(b.dataset.id));
      renderSettings();
    });
  }

  NB.views = { mount, renderInvoices, renderCustomers, renderCharges, renderSettings, addCharge };
})(window.NB = window.NB || {});
