/* Inspector: tabbed, grouped editing panel for the open invoice. Emits immutable state updates via ctx. */
(function (NB) {
  'use strict';

  const { calc, defaults, store, ledger, ui, documents, blobs } = NB;
  const { esc, row, rowToggle, stack, group, input, textarea, select, rowTools, tool, icon } = ui;

  const TABS = [['document', 'Document'], ['items', 'Items'], ['payments', 'Payments'], ['files', 'Files'], ['style', 'Style']];
  const LIST_TEMPLATES = {
    kv: () => defaults.kv(''),
    item: () => defaults.blankItem(),
    charge: () => ({ label: 'Additional charge', labelAr: '', amount: 0 }),
    container: () => defaults.blankContainer(),
  };
  const DUE_PRESETS = [[0, 'On receipt'], [15, '15 days'], [30, '30 days'], [45, '45 days'], [60, '60 days']];
  const MAX_SUGGESTIONS = 8;

  let ctx = null;
  let root = null;
  let comboEl = null;
  const combo = { target: null, matches: [], index: -1 };

  const s = () => ctx.state();
  const money = (n) => `${calc.formatNumber(n, calc.toNum(s().currency.decimals), s().theme.grouping)} ${s().currency.code}`;
  const showArabic = () => s().language !== 'en';
  const addRow = (label, act, data = {}) => `<button type="button" class="add-row" data-act="${act}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${icon('plus')}${esc(label)}</button>`;
  const field = (label, control) => `<label class="mini"><span>${esc(label)}</span>${control}</label>`;

  /* ---------- shared list editors ---------- */
  function kvRows(path, { types = false, wide = false, skipKeyed = false } = {}) {
    const list = ui.getIn(s(), path) || [];
    return list.map((f, i) => {
      if (skipKeyed && f.key) return '';
      const p = `${path}.${i}`;
      const typeSel = types ? select(`${p}.type`, [['text', 'Text'], ['date', 'Date']], { rerender: true, cls: 'field-input', aria: 'Field type' }) : '';
      const wideToggle = wide ? `<label class="mini-check" title="Span both columns"><input type="checkbox" data-path="${p}.wide" data-kind="bool"${f.wide ? ' checked' : ''}> Wide</label>` : '';
      return `<div class="kv-edit">
        ${input(`${p}.label`, { cls: 'field-input', placeholder: 'Label', aria: 'Label' })}
        ${showArabic() ? input(`${p}.labelAr`, { cls: 'field-input', placeholder: 'التسمية', dir: 'rtl', aria: 'Arabic label' }) : '<span></span>'}
        ${rowTools(path, i)}
        ${input(`${p}.value`, { type: f.type === 'date' ? 'date' : 'text', cls: 'field-input kv-value', placeholder: 'Value', aria: `${f.label || 'Field'} value` })}
        <div class="kv-meta">${typeSel}${wideToggle}</div>
      </div>`;
    }).join('');
  }

  const bilingual = (label, path, o = {}) => row(label, input(path, o)) + (showArabic() ? row(`${label} (Arabic)`, input(`${path}Ar`, { ...o, dir: 'rtl' })) : '');
  const bilingualText = (label, path, o = {}) => stack(label, textarea(path, o)) + (showArabic() ? stack(`${label} (Arabic)`, textarea(`${path}Ar`, { ...o, dir: 'rtl' })) : '');

  /* ---------- Document tab ---------- */
  function tabDocument(inv) {
    const titles = defaults.DOC_TITLES.map((t) => [t, t.charAt(0) + t.slice(1).toLowerCase()]);
    const known = defaults.DOC_TITLES.includes(String(inv.title).toUpperCase());
    const typeSelect = `<select data-cmd="doc-type" aria-label="Document type">${[...titles, ['', 'Custom…']].map(([v, l]) => `<option value="${esc(v)}"${(known ? String(inv.title).toUpperCase() === v : v === '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const dateIndex = (key) => inv.meta.findIndex((f) => f.key === key);
    const dateRow = (label, key) => (dateIndex(key) >= 0 ? row(label, input(`meta.${dateIndex(key)}.value`, { type: 'date' })) : '');
    const clients = store.listClients();
    const clientPicker = `<select class="field-input" data-cmd="client" aria-label="Saved customers" style="width:auto">${[['', clients.length ? 'Saved…' : 'None saved'], ...clients.map((c) => [c.name, c.name])].map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`;

    const type = documents.typeOf(inv);
    const link = (id, number, label) => (id ? `<div class="row"><span class="row-label">${esc(label)}</span><div class="row-control"><a href="#/invoice/${encodeURIComponent(id)}">${esc(number || 'Open')}</a></div></div>` : '');
    const convertButtons = type.next.map((t) => {
      const target = documents.DOC_TYPES.find((d) => d.id === t);
      return addRow(t === 'credit' ? 'Create credit note' : `Convert to ${target.label}`, 'convert', { target: t });
    }).join('');
    const credits = ctx.creditNotesFor(inv.id).map((c) => link(c.id, `${c.number} · ${money(calc.computeTotals(c).total)}`, 'Credit note')).join('');
    const templates = store.listTemplates();
    const templatePicker = `<select data-cmd="apply-template" aria-label="Apply template"><option value="">Apply template…</option>${templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select>`;
    const sizeOptions = Object.entries(documents.CONTAINER_SIZES).map(([k, [l]]) => [k, `${k} · ${l}`]);
    const checkLabel = { ok: '✓ valid', 'check-digit': '⚠ check digit', format: '⚠ format', empty: '' };
    const containerRows = (inv.containers || []).map((c, i) => {
      const p = `containers.${i}`;
      const check = documents.checkContainer(c.number);
      return `<div class="list-row">
        <div class="list-row-head"><span class="index">${i + 1}</span><span class="late container-check" data-container-check="${i}" data-state="${check}">${checkLabel[check]}</span>${rowTools('containers', i)}</div>
        <div class="pair">${field('Container no.', input(`${p}.number`, { cls: 'field-input', placeholder: 'ABCU1234567' }))}${field('Seal no.', input(`${p}.seal`, { cls: 'field-input' }))}</div>
        <div class="item-grid item-grid--4">${field('Size', select(`${p}.size`, sizeOptions, { cls: 'field-input' }))}${field('Packages', input(`${p}.packages`, { type: 'number', step: 'any', cls: 'field-input' }))}
          ${field('Weight kg', input(`${p}.weight`, { type: 'number', step: 'any', cls: 'field-input' }))}${field('CBM', input(`${p}.volume`, { type: 'number', step: 'any', cls: 'field-input' }))}</div></div>`;
    }).join('');

    return [
      group('Workflow', `<div class="row"><span class="row-label">Status</span><div class="row-control">${ui.statusPill(ledger.status(ctx.prepared(inv), ctx.today()))}</div></div>`
        + link(inv.convertedFrom, inv.convertedFromNumber, 'Created from') + link(inv.supersededBy, inv.supersededByNumber, 'Converted to')
        + link(inv.creditFor, inv.creditForNumber, 'Credit note for') + credits + (inv.supersededBy ? '' : convertButtons)
        + `<div class="row"><label>Template</label><div class="row-control">${templatePicker}</div></div>`
        + addRow('Save this layout as a template…', 'save-template'),
      { foot: 'Converting copies everything into a new document and moves any payments across. The original is kept and marked Converted.' }),
      group('Document', `<div class="row"><label>Type</label><div class="row-control">${typeSelect}</div></div>`
        + bilingual('Title', 'title')
        + row('Number', input('number'))
        + row('Status', select('status', [['draft', 'Draft'], ['sent', 'Sent'], ['cancelled', 'Cancelled']]))),
      group('Dates', dateRow('Invoice date', 'invoiceDate') + dateRow('Due date', 'dueDate')
        + `<div class="chips">${DUE_PRESETS.map(([d, l]) => `<button type="button" class="chip-btn" data-act="due" data-days="${d}">${esc(l)}</button>`).join('')}</div>`,
      { foot: 'Invoices past their due date are flagged as overdue.' }),
      group('Customer', bilingual('Name', 'customer.name') + bilingualText('Address', 'customer.address')
        + kvRows('customer.contacts') + addRow('Add contact line', 'add', { path: 'customer.contacts', tpl: 'kv' }),
      { action: `<div class="row-control">${clientPicker}<button type="button" class="btn btn--sm" data-act="client-save">Save</button></div>` }),
      group('Details', row('Number label', input('numberLabel')) + (showArabic() ? row('Number label (Arabic)', input('numberLabelAr', { dir: 'rtl' })) : '')
        + kvRows('meta', { types: true, skipKeyed: true }) + addRow('Add field', 'add', { path: 'meta', tpl: 'kv' })),
      group('Shipment', rowToggle('Show on invoice', 'sections.shipment') + bilingual('Heading', 'shipmentTitle')
        + kvRows('shipment', { types: true, wide: true }) + addRow('Add field', 'add', { path: 'shipment', tpl: 'kv' })),
      group('Containers', rowToggle('Show container table', 'sections.containers') + containerRows
        + addRow('Add container', 'add', { path: 'containers', tpl: 'container' })
        + ((inv.containers || []).length ? addRow('Fill shipment fields from containers', 'fill-shipment') : ''),
      { foot: 'Container numbers are checked with the ISO 6346 check digit.' }),
      group('Your Company', bilingual('Name', 'company.name') + bilingualText('Address', 'company.address')
        + kvRows('company.contacts') + addRow('Add contact line', 'add', { path: 'company.contacts', tpl: 'kv' })
        + row('Logo', select('company.logo', [['default', 'Company logo'], ['custom', 'Uploaded image'], ['none', 'None']], { rerender: true }))
        + `<div class="row"><label>Upload logo</label><div class="row-control"><input type="file" accept="image/*" data-asset="logo" aria-label="Upload logo"></div></div>`),
      group('Footer', rowToggle('Signature line', 'sections.signature') + bilingual('Signature caption', 'footer.signatureLabel')
        + row('Prepared by', input('footer.preparedBy')) + rowToggle('Printed-on bar', 'sections.printed')
        + rowToggle('Notes', 'sections.notes') + bilingualText('Notes', 'footer.notes')
        + rowToggle('Terms & warning', 'sections.terms') + bilingualText('Terms', 'footer.terms', { rows: 3 }) + bilingualText('Warning', 'footer.warning')),
      group('Bank Details', rowToggle('Show on invoice', 'sections.bank') + kvRows('bank') + addRow('Add line', 'add', { path: 'bank', tpl: 'kv' })),
    ].join('');
  }

  /* ---------- Items tab ---------- */
  function tabItems(inv) {
    const totals = calc.computeTotals(inv);
    const currencies = Object.keys(defaults.CURRENCIES);
    const cards = inv.items.map((item, i) => {
      const p = `items.${i}`;
      const save = tool('star', 'catalog-save', { index: i }, 'Save to Saved Charges');
      return `<div class="list-row">
        <div class="list-row-head"><span class="index">${i + 1}</span><span class="amount" data-line-total="${i}">${esc(money(totals.lines[i].net))}</span>${rowTools('items', i, save)}</div>
        ${textarea(`${p}.desc`, { cls: 'field-input', rows: 1, placeholder: 'Description — type to search saved charges', aria: `Item ${i + 1} description`, extra: `data-combobox data-item="${i}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="combo" autocomplete="off"` })}
        ${showArabic() ? textarea(`${p}.descAr`, { cls: 'field-input', rows: 1, dir: 'rtl', placeholder: 'الوصف بالعربية', aria: `Item ${i + 1} Arabic description` }) : ''}
        <div class="item-grid">
          ${field('Qty', input(`${p}.qty`, { type: 'number', step: 'any', cls: 'field-input' }))}
          ${field('Unit price', input(`${p}.price`, { type: 'number', step: 'any', cls: 'field-input' }))}
          ${field('Unit', input(`${p}.uom`, { cls: 'field-input', placeholder: '—' }))}
          ${field('Disc %', input(`${p}.discount`, { type: 'number', step: 'any', min: 0, max: 100, cls: 'field-input' }))}
          ${field('Tax %', input(`${p}.tax`, { type: 'number', step: 'any', min: 0, max: 100, cls: 'field-input' }))}
          ${field('Cost', input(`${p}.cost`, { type: 'number', step: 'any', min: 0, cls: 'field-input field-input--internal', aria: `Item ${i + 1} internal unit cost` }))}
        </div></div>`;
    }).join('');
    const charges = inv.totals.charges.map((c, i) => `<div class="kv-edit">
        ${input(`totals.charges.${i}.label`, { cls: 'field-input', placeholder: 'Charge', aria: 'Charge label' })}
        ${showArabic() ? input(`totals.charges.${i}.labelAr`, { cls: 'field-input', dir: 'rtl', placeholder: 'البند', aria: 'Arabic charge label' }) : '<span></span>'}
        ${rowTools('totals.charges', i)}
        ${input(`totals.charges.${i}.amount`, { type: 'number', step: 'any', cls: 'field-input kv-value', aria: 'Charge amount' })}</div>`).join('');
    const columns = inv.columns.map((c, i) => `<div class="kv-edit">
        ${input(`columns.${i}.label`, { cls: 'field-input', aria: `${c.key} column label` })}
        ${showArabic() ? input(`columns.${i}.labelAr`, { cls: 'field-input', dir: 'rtl', aria: `${c.key} Arabic column label` }) : '<span></span>'}
        <div class="row-tools">${tool('up', 'up', { path: 'columns', index: i }, 'Move left')}${tool('down', 'down', { path: 'columns', index: i }, 'Move right')}</div>
        <label class="mini-check kv-value"><input type="checkbox" data-path="columns.${i}.visible" data-kind="bool"${c.visible ? ' checked' : ''}> Show “${esc(c.key)}” column</label></div>`).join('');

    const pr = calc.profit(inv);
    const eq = documents.equivalent(inv);
    const currencyOptions = Object.keys(defaults.CURRENCIES).map((c) => [c, c]);
    const profitGroup = group('Profit (internal — never printed)', `<div class="summary summary--4" data-profit>
        <div><span>Revenue</span><strong>${esc(money(pr.revenue))}</strong></div><div><span>Cost</span><strong>${esc(money(pr.cost))}</strong></div>
        <div><span>Profit</span><strong class="${pr.profit < 0 ? 'is-negative' : ''}">${esc(money(pr.profit))}</strong></div><div><span>Margin</span><strong>${pr.hasCost ? `${pr.margin}%` : '—'}</strong></div></div>`,
    { foot: 'Enter your unit cost on each line to see profit. Revenue excludes tax and extra charges.' });
    const fxGroup = group('Exchange Rate', rowToggle('Show equivalent on invoice', 'fx.enabled', { rerender: true })
      + row('Base currency', select('fx.base', currencyOptions, { rerender: true }))
      + row(`1 ${inv.currency.code} =`, input('fx.rate', { type: 'number', step: 'any', min: 0, placeholder: `rate in ${inv.fx.base}` }))
      + (eq ? `<div class="row"><span class="row-label">Equivalent</span><div class="row-control"><strong>${esc(calc.formatNumber(eq.total, eq.decimals))} ${esc(eq.base)}</strong></div></div>` : ''),
    { foot: 'The rate also converts this invoice into your base currency on the Dashboard.' });

    return [
      profitGroup,
      group('Currency', `<div class="row"><label>Currency</label><div class="row-control"><select data-cmd="currency" aria-label="Currency">${currencies.map((c) => `<option${c === inv.currency.code ? ' selected' : ''}>${c}</option>`).join('')}${inv.currency.code in defaults.CURRENCIES ? '' : `<option selected>${esc(inv.currency.code)}</option>`}</select></div></div>`
        + row('Decimals', input('currency.decimals', { type: 'number', min: 0, max: 4 }))),
      inv.currency.code !== inv.fx.base || inv.fx.enabled ? fxGroup : '',
      group('Line Items', (cards || '') + addRow('Add line item', 'add', { path: 'items', tpl: 'item' }),
        { foot: 'Start typing a description to pick from Saved Charges. Press ★ on a line to save it for next time.' }),
      group('Paste Many Lines', stack('One per line: Description ⇥ Qty ⇥ Price (straight from Excel) — or use | or ;', '<textarea id="bulk-items" rows="3" placeholder="PORT CHARGES | 2 | 717.5"></textarea>')
        + addRow('Add these lines', 'bulk-add')),
      group('Adjustments', row('Discount', select('totals.discountType', [['percent', '% of subtotal'], ['amount', 'Fixed amount']]))
        + row('Discount value', input('totals.discountValue', { type: 'number', step: 'any', min: 0 }))
        + row('Tax rate %', input('totals.taxRate', { type: 'number', step: 'any', min: 0, max: 100 }))
        + bilingual('Tax label', 'totals.taxLabel') + charges + addRow('Add extra charge', 'add', { path: 'totals.charges', tpl: 'charge' })),
      group('Labels', bilingual('Subtotal', 'totals.subtotalLabel') + bilingual('Discount', 'totals.discountLabel') + bilingual('Total due', 'totals.totalLabel')),
      group('Table Columns', columns, { foot: '<code>{CUR}</code> in a label becomes the currency code.' }),
    ].join('');
  }

  /* ---------- Payments tab ---------- */
  function tabPayments(inv) {
    const totals = calc.computeTotals(ctx.prepared(inv));
    const status = ledger.status(ctx.prepared(inv), ctx.today());
    const late = ledger.overdueDays(inv, ctx.today());
    const methods = defaults.PAYMENT_METHODS.map((m) => [m, m]);
    const payments = inv.payments.map((p, i) => `<div class="list-row">
        <div class="list-row-head"><span class="index">${i + 1}</span><span class="amount">${esc(money(calc.toNum(p.amount)))}</span><div class="row-tools">${tool('trash', 'remove', { path: 'payments', index: i }, 'Delete payment', true)}</div></div>
        <div class="pair">${field('Date', input(`payments.${i}.date`, { type: 'date', cls: 'field-input' }))}${field('Amount', input(`payments.${i}.amount`, { type: 'number', step: 'any', cls: 'field-input' }))}</div>
        <div class="pair">${field('Method', select(`payments.${i}.method`, methods, { cls: 'field-input' }))}${field('Reference', input(`payments.${i}.reference`, { cls: 'field-input', placeholder: 'Cheque / transfer no.' }))}</div>
      </div>`).join('');

    return [
      group('', `<div class="summary"><div><span>Total</span><strong>${esc(money(totals.total))}</strong></div>
          <div><span>Paid</span><strong>${esc(money(totals.paid))}</strong></div>
          <div><span>Balance</span><strong>${esc(money(totals.balance))}</strong></div></div>
        <div class="row row--toggle"><span class="row-label">${ui.statusPill(status)}</span><span class="late">${status === 'overdue' ? `${late} day${late === 1 ? '' : 's'} overdue` : ''}</span></div>`),
      ctx.creditNotesFor(inv.id).length ? group('Credit Notes Applied', ctx.creditNotesFor(inv.id).map((c) => `<div class="row"><a class="row-label" href="#/invoice/${encodeURIComponent(c.id)}">${esc(c.number)}</a><div class="row-control"><strong>${esc(money(calc.computeTotals(c).total))}</strong></div></div>`).join('')) : '',
      group('Payments Received', (payments || '') + addRow('Record payment', 'pay-add')
        + (totals.balance > 0 ? addRow(`Mark as fully paid (${money(totals.balance)})`, 'pay-full') : ''),
      { foot: 'The invoice turns Paid automatically once payments cover the total.' }),
      group('On the Invoice', rowToggle('Show paid and balance rows', 'sections.payments') + bilingual('Paid label', 'totals.paidLabel') + bilingual('Balance label', 'totals.balanceLabel')),
    ].join('');
  }

  /* ---------- Files tab ---------- */
  function tabFiles() {
    queueMicrotask(fillFiles);
    return group('Attachments', `<label class="dropzone" data-dropzone>
        <input type="file" multiple data-attach aria-label="Attach files">
        <strong>Drop files here or click to attach</strong><span>Bill of lading, customs declaration, delivery order… up to 25 MB each</span></label>
        <div id="file-list" class="file-list" aria-live="polite"><p class="group-foot">Loading…</p></div>`,
    { foot: 'Attachments are stored on this computer with the invoice. They are not printed and not included in JSON backups.' });
  }

  const formatBytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  async function fillFiles() {
    const target = root.querySelector('#file-list');
    if (!target) return;
    try {
      const files = await blobs.listFiles(s().id);
      const kinds = blobs.ATTACHMENT_KINDS.map((k) => [k, k]);
      target.innerHTML = files.length ? files.map((f) => `<div class="row file-row">
          <div class="file-name"><strong>${esc(f.name)}</strong><span>${esc(formatBytes(f.size))} · ${esc(new Date(f.addedAt).toLocaleDateString())}</span></div>
          <div class="row-control"><select class="field-input" data-file-kind="${esc(f.id)}" aria-label="Document type for ${esc(f.name)}">${kinds.map(([v, l]) => `<option${v === f.kind ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
          ${tool('doc', 'file-open', { id: f.id }, `Open ${f.name}`)}${tool('trash', 'file-delete', { id: f.id }, `Delete ${f.name}`, true)}</div></div>`).join('')
        : '<p class="group-foot">No attachments yet.</p>';
    } catch (err) {
      target.innerHTML = `<p class="group-foot">${esc(err.message)}</p>`;
    }
  }

  async function attach(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    try {
      await Promise.all(files.map((f) => blobs.addFile(s().id, f, guessKind(f.name))));
      ctx.persistNow();
      ctx.toast(`Attached ${files.length} file${files.length > 1 ? 's' : ''}.`);
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
    fillFiles();
  }

  function guessKind(name) {
    const n = name.toLowerCase();
    if (/\b(bl|b-l|bol|bill.?of.?lading)\b/.test(n)) return 'Bill of Lading';
    if (/customs|declaration|bayan/.test(n)) return 'Customs Declaration';
    if (/\bdo\b|delivery/.test(n)) return 'Delivery Order';
    if (/packing/.test(n)) return 'Packing List';
    if (/origin|coo/.test(n)) return 'Certificate of Origin';
    if (/invoice/.test(n)) return 'Commercial Invoice';
    return 'Other';
  }

  async function fillFonts() {
    const target = root.querySelector('#font-list');
    if (!target) return;
    try {
      const fonts = await blobs.listFonts();
      target.innerHTML = fonts.map((f) => `<div class="row"><span class="row-label" style="font-family:'${esc(f.family)}'">${esc(f.family)}</span><div class="row-control">${tool('trash', 'font-delete', { id: f.id }, `Delete ${f.family}`, true)}</div></div>`).join('');
    } catch (err) {
      target.innerHTML = `<p class="group-foot">${esc(err.message)}</p>`;
    }
  }

  /* ---------- Style tab ---------- */
  function tabStyle(inv) {
    const fonts = [...defaults.FONTS, ...(NB.customFonts || [])].map((f) => [f, f]);
    const range = (label, path, min, max, step, unit) => row(label, input(path, { type: 'range', min, max, step }), { hint: `<output data-unit="${unit}">${esc(ui.getIn(inv, path))}${unit}</output>` });
    const presets = Object.entries(defaults.THEME_PRESETS).map(([name, p]) => `<button type="button" class="preset" data-act="preset" data-name="${esc(name)}" aria-pressed="${inv.theme.preset === name}">
        <span class="dots"><i style="background:${p.primary}"></i><i style="background:${p.accent}"></i><i style="background:${p.band}"></i></span>${esc(name)}</button>`).join('');
    const swatch = (label, path) => `<label title="${esc(label)}"><input type="color" data-path="${path}" value="${esc(ui.getIn(inv, path))}" aria-label="${esc(label)} colour"></label>`;

    queueMicrotask(fillFonts);
    const labels = Object.fromEntries(defaults.LAYOUT_BLOCKS);
    const layoutRows = defaults.normalizeLayout(inv.layout).map((id, i) => `<div class="row row--toggle"><span class="row-label">${esc(labels[id])}</span>
        <div class="row-tools">${tool('up', 'layout-move', { index: i, dir: -1 }, `Move ${labels[id]} up`)}${tool('down', 'layout-move', { index: i, dir: 1 }, `Move ${labels[id]} down`)}</div></div>`).join('');

    return [
      group('Page Layout', layoutRows + addRow('Reset order and column widths', 'layout-reset'),
        { foot: 'Tip: press <b>Arrange</b> under the preview to drag sections on the page and resize table columns.' }),
      group('Custom Fonts', `<div id="font-list"></div><div class="row"><label>Upload font</label><div class="row-control"><input type="file" accept=".ttf,.otf,.woff,.woff2" data-font-upload aria-label="Upload font file"></div></div>`,
        { foot: 'Uploaded fonts appear in the heading and body font menus below.' }),
      group('Language', `<div class="chips"><div class="seg seg--full" role="radiogroup" aria-label="Invoice language" style="flex:1">
          ${[['en', 'English'], ['bi', 'English + Arabic'], ['ar', 'Arabic']].map(([v, l]) => `<button type="button" role="radio" data-act="lang" data-lang="${v}" aria-checked="${inv.language === v}">${l}</button>`).join('')}</div></div>`
        + row('Arabic font', select('theme.arabicFont', defaults.AR_FONTS.map((f) => [f, f])))
        + rowToggle('Arabic-Indic digits (Arabic only)', 'theme.arabicDigits')),
      group('Stamp', rowToggle('Show stamp', 'stamp.show')
        + range('Size', 'stamp.size', 15, 90, 1, 'mm') + range('Rotation', 'stamp.rotation', -45, 45, 1, '°') + range('Opacity', 'stamp.opacity', 0.3, 1, 0.05, '')
        + row('Image', select('stamp.source', [['default', 'Company stamp'], ['custom', 'Uploaded image']]))
        + `<div class="row"><label>Upload stamp</label><div class="row-control"><input type="file" accept="image/*" data-asset="stamp" aria-label="Upload stamp image"></div></div>`
        + addRow('Reset stamp position', 'stamp-reset'),
      { foot: 'Drag the stamp on the page to place it. Drag the dot on its edge to resize. With the stamp selected, arrow keys nudge it (hold Shift for bigger steps).' }),
      group('QR Code', rowToggle('Show QR code', 'qr.show', { rerender: true })
        + row('Contains', select('qr.mode', [['summary', 'Invoice summary'], ['bank', 'Bank transfer details'], ['custom', 'Custom text or link']], { rerender: true }))
        + (inv.qr.mode === 'custom' ? stack('Text or link', textarea('qr.text', { rows: 2, placeholder: 'https://example.com/pay?ref={NUMBER}&amount={BALANCE}' })) : '')
        + bilingual('Caption', 'qr.caption')
        + range('Size', 'qr.size', 12, 60, 1, 'mm')
        + `<div class="stack"><span class="row-label">Encoded text</span><pre class="qr-preview">${esc(NB.documents.qrPayload(inv) || '—')}</pre></div>`
        + addRow('Reset QR position', 'qr-reset'),
      { foot: 'Drag the QR code on the page to place it. Tokens for custom text: <code>{NUMBER}</code> <code>{DATE}</code> <code>{CUSTOMER}</code> <code>{TOTAL}</code> <code>{BALANCE}</code> <code>{CURRENCY}</code> <code>{COMPANY}</code>. Bank details come from Document → Bank Details.' }),
      group('Theme', `<div class="presets">${presets}</div>`
        + `<div class="row"><label>Colours</label><div class="row-control swatch-row">${swatch('Primary', 'theme.primary')}${swatch('Accent', 'theme.accent')}${swatch('Text', 'theme.text')}${swatch('Table header', 'theme.headFill')}${swatch('Header text', 'theme.headText')}${swatch('Title band', 'theme.band')}</div></div>`),
      group('Typography & Layout', row('Heading font', select('theme.headingFont', fonts)) + row('Body font', select('theme.bodyFont', fonts))
        + range('Text size', 'theme.baseSize', 7, 12, 0.5, 'pt') + range('Page margin', 'theme.margin', 5, 25, 1, 'mm')
        + range('Logo height', 'theme.logoHeight', 10, 60, 1, 'mm')
        + row('Header', select('theme.headerLayout', [['classic', 'Classic'], ['centered', 'Logo centred'], ['banner', 'Colour banner']]))
        + row('Logo side', select('theme.logoPosition', [['right', 'Right'], ['left', 'Left']]))
        + row('Title style', select('theme.titleStyle', [['band', 'Tinted band'], ['solid', 'Solid bar'], ['underline', 'Underline'], ['plain', 'Plain']]))
        + row('Table style', select('theme.tableStyle', [['grid', 'Grid'], ['striped', 'Striped'], ['minimal', 'Minimal'], ['boxed', 'Boxed']]))
        + row('Density', select('theme.density', [['compact', 'Compact'], ['normal', 'Normal'], ['airy', 'Airy']]))
        + row('Paper', select('theme.paper', [['A4', 'A4'], ['Letter', 'US Letter']]))
        + row('Date format', select('theme.dateFormat', ['D MMM YYYY', 'DD MMM YYYY', 'D MMMM YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map((f) => [f, f])))
        + row('Numbers', select('theme.grouping', [['comma', '1,234.500'], ['dot', '1.234,500'], ['space', '1 234.500'], ['none', '1234.500']]))
        + row('Qty decimals', input('theme.qtyDecimals', { type: 'number', min: 0, max: 4 }))
        + rowToggle('Currency after unit price', 'theme.priceWithCurrency') + rowToggle('Accent rules', 'theme.goldRules')),
      group('Sections', rowToggle('Customer box', 'sections.customer') + rowToggle('Details block', 'sections.meta')
        + rowToggle('Amount in words', 'sections.words') + rowToggle('Company tagline', 'sections.tagline')
        + rowToggle('Hide empty fields', 'sections.hideEmpty') + rowToggle('Page-break guides', 'sections.pageGuides')
        + rowToggle('Watermark', 'sections.watermark') + row('Watermark text', input('theme.watermarkText'))),
      group('Amount in Words', row('English template', input('words.template')) + row('English fraction', input('words.minorTemplate'))
        + row('Letter case', select('words.casing', [['upper', 'UPPER'], ['title', 'Title'], ['sentence', 'Sentence'], ['lower', 'lower']]))
        + row('Arabic template', input('words.templateAr', { dir: 'rtl' })) + row('Arabic fraction', input('words.minorTemplateAr', { dir: 'rtl' }))
        + row('Currency (Arabic)', input('currency.majorAr', { dir: 'rtl' })) + row('Fraction (Arabic)', input('currency.minorAr', { dir: 'rtl' })),
      { foot: 'Tokens: <code>{MAJOR_WORDS}</code> <code>{MAJOR_NAME}</code> <code>{MINOR_PART}</code> <code>{COUNTRY}</code> · fraction: <code>{MINOR_WORDS}</code> <code>{MINOR_NAME}</code>' }),
      group('Defaults', addRow('Use this design and wording for new invoices', 'cmd', { cmd: 'save-default' })),
    ].join('');
  }

  const TAB_RENDERERS = { document: tabDocument, items: tabItems, payments: tabPayments, files: tabFiles, style: tabStyle };

  /* ---------- render ---------- */
  const scrollByTab = {};
  function render() {
    const tab = ctx.prefs().tab in TAB_RENDERERS ? ctx.prefs().tab : 'document';
    const tabs = TABS.map(([id, label]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${id === tab}">${label}</button>`).join('');
    const scroll = root.scrollTop;
    root.innerHTML = `<div class="inspector-tabs"><div class="seg seg--full" role="tablist" aria-label="Inspector">${tabs}</div></div>
      <div class="inspector-body" role="tabpanel">${TAB_RENDERERS[tab](s())}</div>`;
    root.scrollTop = scroll;
  }

  function switchTab(tab) {
    scrollByTab[ctx.prefs().tab] = root.scrollTop;
    ctx.savePrefs({ tab });
    render();
    root.scrollTop = scrollByTab[tab] || 0;
  }

  function refreshLineTotals() {
    const totals = calc.computeTotals(s());
    root.querySelectorAll('[data-line-total]').forEach((el) => {
      const line = totals.lines[Number(el.dataset.lineTotal)];
      if (line) el.textContent = money(line.net);
    });
  }

  /* ---------- saved-charge combobox ---------- */
  function comboClose() {
    if (combo.target) combo.target.setAttribute('aria-expanded', 'false');
    combo.target = null;
    combo.index = -1;
    comboEl.hidden = true;
  }

  function comboRender() {
    comboEl.innerHTML = combo.matches.map((c, i) => `<div role="option" id="combo-${i}" data-combo-index="${i}" aria-selected="${i === combo.index}">
        <b>${esc(c.name)}</b>${c.nameAr ? `<small dir="rtl">${esc(c.nameAr)}</small>` : ''}<em>${calc.toNum(c.price) ? esc(calc.formatNumber(c.price, calc.toNum(s().currency.decimals))) : ''}</em></div>`).join('');
    if (combo.target) combo.target.setAttribute('aria-activedescendant', combo.index >= 0 ? `combo-${combo.index}` : '');
  }

  function comboOpen(target) {
    const query = target.value.trim().toLowerCase();
    const all = store.listCatalog();
    const matches = (query ? all.filter((c) => c.name.toLowerCase().includes(query) || (c.nameAr || '').includes(query)) : all).slice(0, MAX_SUGGESTIONS);
    if (!matches.length || (matches.length === 1 && matches[0].name.toLowerCase() === query)) {
      comboClose();
      return;
    }
    combo.target = target;
    combo.matches = matches;
    combo.index = -1;
    comboRender();
    comboPosition();
  }

  function comboPosition() {
    const { target } = combo;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const width = Math.max(rect.width, 280);
    comboEl.hidden = false;
    const below = rect.bottom + 4 + comboEl.offsetHeight < window.innerHeight;
    comboEl.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    comboEl.style.top = `${below ? rect.bottom + 4 : rect.top - comboEl.offsetHeight - 4}px`;
    comboEl.style.width = `${width}px`;
    target.setAttribute('aria-expanded', 'true');
  }

  function comboChoose(i) {
    const choice = combo.matches[i];
    if (!choice || !combo.target) return;
    const index = Number(combo.target.dataset.item);
    const item = s().items[index];
    comboClose();
    ctx.set(`items.${index}`, {
      ...item, desc: choice.name, descAr: choice.nameAr || item.descAr, uom: choice.uom || item.uom,
      price: calc.toNum(choice.price) || item.price, tax: calc.toNum(choice.tax) || item.tax,
    }, true);
    const next = root.querySelector(`[data-path="items.${index}.qty"]`);
    if (next) next.focus();
  }

  function onComboKey(e) {
    if (!combo.target || comboEl.hidden) return;
    const n = combo.matches.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      combo.index = (combo.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      comboRender();
    } else if (e.key === 'Enter' && combo.index >= 0) {
      e.preventDefault();
      comboChoose(combo.index);
    } else if (e.key === 'Escape') {
      comboClose();
    }
  }

  /* ---------- actions ---------- */
  function listOp(op, path, index, tpl) {
    const list = ui.getIn(s(), path) || [];
    const swap = (a, b) => list.map((x, i) => (i === a ? list[b] : i === b ? list[a] : x));
    const ops = {
      add: () => [...list, LIST_TEMPLATES[tpl]()],
      remove: () => list.filter((_, i) => i !== index),
      up: () => (index > 0 ? swap(index, index - 1) : list),
      down: () => (index < list.length - 1 ? swap(index, index + 1) : list),
      dup: () => [...list.slice(0, index + 1), { ...structuredClone(list[index]), ...(list[index].id ? { id: defaults.uid() } : {}) }, ...list.slice(index + 1)],
    };
    if (ops[op]) ctx.set(path, ops[op](), true);
  }

  function setDue(days) {
    const inv = s();
    const base = ledger.invoiceDate(inv) || ctx.today();
    const due = defaults.addDays(base, days);
    const index = inv.meta.findIndex((f) => f.key === 'dueDate');
    const meta = index >= 0
      ? inv.meta.map((f, i) => (i === index ? { ...f, value: due } : f))
      : [...inv.meta, defaults.kv('Due Date', due, { type: 'date', key: 'dueDate' })];
    ctx.set('meta', meta, true);
  }

  function addPayment(full) {
    const { balance } = calc.computeTotals(s());
    const payment = { id: defaults.uid(), date: ctx.today(), amount: Math.max(balance, 0), method: 'Bank Transfer', reference: '' };
    ctx.update((cur) => ({ ...cur, status: cur.status === 'draft' ? 'sent' : cur.status, payments: [...cur.payments, payment] }), true);
    ctx.toast(full ? 'Marked as paid.' : 'Payment added — adjust the amount if it was a part payment.');
  }

  function parseBulk(text) {
    return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const sep = ['\t', '|', ';'].find((x) => line.includes(x));
      const [desc, qty, price] = sep ? line.split(sep).map((x) => x.trim()) : [line];
      return { ...defaults.blankItem(), desc, qty: qty === undefined ? 1 : calc.toNum(qty), price: calc.toNum(price) };
    });
  }

  const ACTIONS = {
    add: (d) => listOp('add', d.path, 0, d.tpl),
    remove: (d) => listOp('remove', d.path, Number(d.index)),
    up: (d) => listOp('up', d.path, Number(d.index)),
    down: (d) => listOp('down', d.path, Number(d.index)),
    dup: (d) => listOp('dup', d.path, Number(d.index)),
    due: (d) => setDue(Number(d.days)),
    lang: (d) => ctx.set('language', d.lang, true),
    preset: (d) => ctx.set('theme', { ...s().theme, ...defaults.THEME_PRESETS[d.name], preset: d.name }, true),
    'pay-add': () => addPayment(false),
    'pay-full': () => addPayment(true),
    'qr-reset': () => ctx.set('qr', { ...s().qr, x: defaults.defaultBrand().qr.x, y: defaults.defaultBrand().qr.y, size: defaults.defaultBrand().qr.size, show: true }, true),
    'stamp-reset': () => ctx.set('stamp', { ...defaults.defaultBrand().stamp, show: true, source: s().stamp.source }, true),
    'client-save': () => ctx.command('client-save'),
    convert: (d) => ctx.command('convert', { target: d.target }),
    'save-template': () => ctx.command('save-template'),
    'fill-shipment': () => {
      const sum = documents.containerSummary(s().containers);
      const values = { Quantity: sum.quantity, 'Container / Seal No.': sum.numbers, 'Volume / Weight': `${calc.formatNumber(sum.volume, 2)} CBM / ${calc.formatNumber(sum.weight, 3)} KG` };
      ctx.set('shipment', s().shipment.map((f) => (f.label in values ? { ...f, value: values[f.label] } : f)), true);
      ctx.toast('Shipment fields updated from containers.');
    },
    'layout-move': (d) => {
      const order = defaults.normalizeLayout(s().layout);
      const i = Number(d.index);
      const j = i + Number(d.dir);
      if (j < 0 || j >= order.length) return;
      ctx.set('layout', order.map((id, k) => (k === i ? order[j] : k === j ? order[i] : id)), true);
    },
    'layout-reset': () => ctx.update((cur) => ({ ...cur, layout: [...defaults.DEFAULT_LAYOUT], columns: cur.columns.map(({ width, ...c }) => c) }), true),
    'file-open': async (d) => {
      const file = await blobs.getFile(d.id);
      if (!file) return;
      const url = URL.createObjectURL(file.blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
    'file-delete': async (d) => {
      if (!ui.confirmTwice(`file-${d.id}`, 'Click delete again to remove this attachment.')) return;
      await blobs.deleteFile(d.id);
      fillFiles();
    },
    'font-delete': async (d) => {
      if (!ui.confirmTwice(`font-${d.id}`, 'Click delete again to remove this font.')) return;
      await blobs.deleteFont(d.id);
      await ctx.reloadFonts();
      render();
    },
    cmd: (d) => ctx.command(d.cmd),
    'catalog-save': (d) => {
      const item = s().items[Number(d.index)];
      const updated = store.upsertCatalogItem({ name: item.desc, nameAr: item.descAr, uom: item.uom, price: calc.toNum(item.price), tax: calc.toNum(item.tax) });
      ctx.toast(updated ? 'Saved charge updated.' : 'Added to Saved Charges.');
    },
    'bulk-add': () => {
      const items = parseBulk(root.querySelector('#bulk-items').value);
      if (!items.length) {
        ctx.toast('Paste at least one line first.');
        return;
      }
      const kept = s().items.filter((i) => i.desc || calc.toNum(i.price));
      ctx.set('items', [...kept, ...items], true);
      ctx.toast(`Added ${items.length} line${items.length > 1 ? 's' : ''}.`);
    },
  };

  /* ---------- events ---------- */
  function onInput(e) {
    const el = e.target;
    if (el.matches('[data-combobox]')) comboOpen(el);
    if (!el.dataset.path || el.type === 'file') return;
    const out = el.type === 'range' ? el.closest('.row').querySelector('output') : null;
    if (out) out.textContent = el.value + out.dataset.unit;
    ctx.set(el.dataset.path, ui.readValue(el), el.hasAttribute('data-rerender'));
    if (el.type === 'color') ctx.set('theme.preset', 'Custom');
    if (/^(items|currency)\./.test(el.dataset.path)) refreshLineTotals();
    const containerMatch = /^containers\.(\d+)\.number$/.exec(el.dataset.path);
    if (containerMatch) {
      const badge = root.querySelector(`[data-container-check="${containerMatch[1]}"]`);
      const state = documents.checkContainer(el.value);
      if (badge) {
        badge.dataset.state = state;
        badge.textContent = { ok: '✓ valid', 'check-digit': '⚠ check digit', format: '⚠ format', empty: '' }[state];
      }
    }
  }

  function onChange(e) {
    const el = e.target;
    if (el.matches('[data-attach]')) {
      attach(el.files);
      el.value = '';
      return;
    }
    if (el.matches('[data-font-upload]') && el.files[0]) {
      const file = el.files[0];
      el.value = '';
      blobs.addFont(file).then(async (font) => {
        await ctx.reloadFonts();
        ctx.toast(`${font.family} is ready to use.`);
        render();
      }).catch((err) => ctx.toast(err.message, 'error'));
      return;
    }
    if (el.dataset.fileKind) {
      blobs.updateFile(el.dataset.fileKind, { kind: el.value }).catch((err) => ctx.toast(err.message, 'error'));
      return;
    }
    if (el.dataset.cmd === 'apply-template' && el.value) {
      ctx.command('apply-template', { id: el.value });
      return;
    }
    if (el.dataset.asset && el.files && el.files[0]) {
      ctx.command('upload-asset', { name: el.dataset.asset, file: el.files[0] });
      el.value = '';
      return;
    }
    if (el.dataset.cmd === 'doc-type' && el.value) {
      ctx.update((cur) => ({ ...cur, title: el.value, titleAr: defaults.TITLES[el.value] || cur.titleAr }), true);
    } else if (el.dataset.cmd === 'currency') {
      ctx.set('currency', { ...defaults.CURRENCIES[el.value] }, true);
    } else if (el.dataset.cmd === 'client' && el.value) {
      const client = store.listClients().find((c) => c.name === el.value);
      if (client) ctx.set('customer', { name: '', nameAr: '', address: '', addressAr: '', contacts: [], ...structuredClone(client) }, true);
    }
  }

  function onClick(e) {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      switchTab(tabBtn.dataset.tab);
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (btn && ACTIONS[btn.dataset.act]) {
      ctx.guard(() => {
        const result = ACTIONS[btn.dataset.act](btn.dataset);
        if (result && result.catch) result.catch((err) => ctx.toast(err.message, 'error'));
      });
    }
  }

  function mount(element, context) {
    root = element;
    ctx = context;
    comboEl = document.getElementById('combo');
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onComboKey);
    root.addEventListener('focusin', (e) => { if (e.target.matches('[data-combobox]') && !e.target.value) comboOpen(e.target); });
    root.addEventListener('focusout', (e) => { if (e.target === combo.target) setTimeout(comboClose, 120); });
    root.addEventListener('scroll', comboPosition);
    root.addEventListener('dragover', (e) => {
      const zone = e.target.closest('[data-dropzone]');
      if (!zone) return;
      e.preventDefault();
      zone.classList.add('is-over');
    });
    root.addEventListener('dragleave', (e) => { const zone = e.target.closest('[data-dropzone]'); if (zone) zone.classList.remove('is-over'); });
    root.addEventListener('drop', (e) => {
      const zone = e.target.closest('[data-dropzone]');
      if (!zone) return;
      e.preventDefault();
      zone.classList.remove('is-over');
      attach(e.dataTransfer.files);
    });
    comboEl.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('[data-combo-index]');
      if (!opt) return;
      e.preventDefault();
      comboChoose(Number(opt.dataset.comboIndex));
    });
  }

  NB.editor = { mount, render };
})(window.NB = window.NB || {});
