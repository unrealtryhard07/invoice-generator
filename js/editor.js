/* Builds the editing sidebar and translates form events into immutable state updates. */
(function (NB) {
  'use strict';

  const { calc, defaults, store } = NB;
  const { esc } = NB.render;

  const getIn = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const opt = (pairs, current) => pairs.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(current) ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const same = (arr) => arr.map((v) => [v, v]);

  const LIST_TEMPLATES = {
    kv: () => defaults.kv(''),
    item: () => defaults.blankItem(),
    charge: () => ({ label: 'Additional charge', amount: 0 }),
  };

  let ctx = null;
  let root = null;
  let openSections = new Set();

  /* ---------- field builders ---------- */
  function attrs(path, o) {
    return [`data-path="${esc(path)}"`, o.kind ? `data-kind="${o.kind}"` : '', o.scope ? `data-scope="${o.scope}"` : '',
      o.rerender ? 'data-rerender' : '', o.placeholder ? `placeholder="${esc(o.placeholder)}"` : '',
      o.list ? `list="${o.list}"` : '', o.step ? `step="${o.step}"` : '', o.min != null ? `min="${o.min}"` : '',
      o.max != null ? `max="${o.max}"` : ''].filter(Boolean).join(' ');
  }
  const source = (o) => (o.scope === 'settings' ? ctx.settings() : ctx.state());

  function input(label, path, o = {}) {
    const type = o.type || 'text';
    const kind = type === 'number' || type === 'range' ? 'num' : o.kind;
    const value = getIn(source(o), path) ?? '';
    const control = `<input type="${type}" ${attrs(path, { ...o, kind })} value="${esc(value)}">`;
    const readout = type === 'range' ? `<output data-unit="${esc(o.unit || '')}">${esc(value)}${esc(o.unit || '')}</output>` : '';
    return `<label class="field ${o.cls || ''}"><span>${esc(label)}${readout}</span>${control}</label>`;
  }
  function textarea(label, path, o = {}) {
    return `<label class="field ${o.cls || ''}"><span>${esc(label)}</span><textarea rows="${o.rows || 3}" ${attrs(path, o)}>${esc(getIn(source(o), path) ?? '')}</textarea></label>`;
  }
  function select(label, path, pairs, o = {}) {
    return `<label class="field ${o.cls || ''}"><span>${esc(label)}</span><select ${attrs(path, o)}>${opt(pairs, getIn(source(o), path))}</select></label>`;
  }
  function toggle(label, path) {
    const checked = getIn(ctx.state(), path) ? ' checked' : '';
    return `<label class="toggle"><input type="checkbox" ${attrs(path, { kind: 'bool' })}${checked}><i aria-hidden="true"></i><span>${esc(label)}</span></label>`;
  }
  function color(label, path) {
    const v = getIn(ctx.state(), path) || '#000000';
    return `<label class="swatch"><input type="color" data-path="${path}" value="${esc(v)}"><span>${esc(label)}</span></label>`;
  }
  const button = (text, act, data = {}, cls = '', aria = '') => `<button type="button" class="btn ${cls}" data-act="${act}"${aria ? ` aria-label="${esc(aria)}" title="${esc(aria)}"` : ''} ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${text}</button>`;
  const rowTools = (path, i) => `<div class="row-tools">${button('↑', 'up', { path, index: i }, 'icon', 'Move up')}${button('↓', 'down', { path, index: i }, 'icon', 'Move down')}${button('⧉', 'dup', { path, index: i }, 'icon', 'Duplicate')}${button('✕', 'remove', { path, index: i }, 'icon danger', 'Remove')}</div>`;

  function kvEditor(path, o = {}) {
    const list = getIn(ctx.state(), path) || [];
    const rows = list.map((f, i) => {
      const p = `${path}.${i}`;
      const valueType = f.type === 'date' ? 'date' : 'text';
      const typeSel = o.types ? `<select data-path="${p}.type" data-rerender aria-label="Field type">${opt([['text', 'Text'], ['date', 'Date']], f.type || 'text')}</select>` : '';
      const wide = o.wide ? `<label class="mini-check" title="Span full width"><input type="checkbox" data-path="${p}.wide" data-kind="bool"${f.wide ? ' checked' : ''}>wide</label>` : '';
      return `<div class="kv-row"><input class="kv-label" data-path="${p}.label" value="${esc(f.label)}" placeholder="Label" aria-label="Label">`
        + `<input type="${valueType}" data-path="${p}.value" value="${esc(f.value)}" placeholder="Value" aria-label="${esc(f.label || 'Value')}">`
        + `<div class="kv-extra">${typeSel}${wide}${rowTools(path, i)}</div></div>`;
    }).join('');
    return `<div class="kv-editor">${rows || '<p class="empty">No fields yet.</p>'}${button('+ Add field', 'add', { path, tpl: 'kv' }, 'ghost')}</div>`;
  }

  /* ---------- sections ---------- */
  function sectionDocument(s) {
    const cur = Object.keys(defaults.CURRENCIES).map((c) => [c, c]);
    return `<datalist id="doc-titles">${defaults.DOC_TITLES.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
      <div class="grid2">
        ${input('Document title', 'title', { list: 'doc-titles', cls: 'span2' })}
        ${input('Number', 'number')}
        ${select('Status', 'status', [['draft', 'Draft'], ['sent', 'Sent'], ['paid', 'Paid'], ['overdue', 'Overdue'], ['cancelled', 'Cancelled']])}
      </div>
      <h4 class="sub">Currency</h4>
      <div class="grid3">
        <label class="field"><span>Preset</span><select data-cmd="currency">${opt([['', 'Custom…'], ...cur], s.currency.code in defaults.CURRENCIES ? s.currency.code : '')}</select></label>
        ${input('Code', 'currency.code')}
        ${input('Decimals', 'currency.decimals', { type: 'number', min: 0, max: 4 })}
        ${input('Major unit', 'currency.major')}
        ${input('Minor unit', 'currency.minor')}
        ${input('Country', 'currency.country')}
      </div>`;
  }

  function sectionCompany(s) {
    const thumb = s.company.logo === 'custom' ? (store.getAsset('logo') || 'assets/logo.png') : 'assets/logo.png';
    return `<div class="grid2">
        ${input('Company name', 'company.name', { cls: 'span2' })}
        ${textarea('Address', 'company.address', { rows: 3, cls: 'span2' })}
      </div>
      <h4 class="sub">Contact lines</h4>${kvEditor('company.contacts')}
      <h4 class="sub">Logo</h4>
      <div class="logo-row">
        <img src="${esc(thumb)}" alt="" class="logo-thumb${s.company.logo === 'none' ? ' is-off' : ''}">
        <div class="grid2 grow">
          ${select('Logo source', 'company.logo', [['default', 'Company logo'], ['custom', 'Uploaded image'], ['none', 'No logo']], { rerender: true })}
          <label class="field"><span>Upload new</span><input type="file" accept="image/*" data-asset="logo"></label>
          ${input('Logo height', 'theme.logoHeight', { type: 'range', min: 10, max: 60, step: 1, unit: 'mm' })}
          ${select('Logo side', 'theme.logoPosition', [['right', 'Right'], ['left', 'Left']])}
        </div>
      </div>
      ${toggle('Show tagline strip under header', 'sections.tagline')}
      ${input('Tagline', 'company.tagline')}`;
  }

  function sectionCustomer(s) {
    const clients = store.listClients();
    const known = s.customer.name && clients.some((c) => c.name === s.customer.name);
    return `<div class="client-bar">
        <select data-cmd="client" aria-label="Saved clients">${opt([['', clients.length ? `Saved clients (${clients.length})…` : 'No saved clients yet'], ...clients.map((c) => [c.name, c.name])], '')}</select>
        ${button('Save client', 'client-save', {}, 'ghost')}
        ${known ? button('Forget', 'client-delete', {}, 'ghost danger') : ''}
      </div>
      ${toggle('Show customer box', 'sections.customer')}
      <div class="grid2">
        ${input('Box heading', 'customerHeading', { placeholder: 'e.g. Bill To' })}
        ${input('Customer name', 'customer.name')}
        ${textarea('Address', 'customer.address', { rows: 3, cls: 'span2' })}
      </div>
      <h4 class="sub">Customer contact lines</h4>${kvEditor('customer.contacts')}`;
  }

  function sectionMeta() {
    return `${toggle('Show details block', 'sections.meta')}
      ${input('Label for the document number', 'numberLabel')}
      <p class="hint">Rename, reorder or add any field. Date fields use the format set under <b>Design</b>.</p>
      ${kvEditor('meta', { types: true })}`;
  }

  function sectionShipment() {
    return `${toggle('Show shipment block', 'sections.shipment')}
      ${input('Block heading', 'shipmentTitle', { placeholder: 'Leave empty for none' })}
      <p class="hint">Fields flow in two columns, left then right. Tick <b>wide</b> to span both.</p>
      ${kvEditor('shipment', { types: true, wide: true })}`;
  }

  function sectionItems(s) {
    const d = calc.toNum(s.currency.decimals);
    const totals = calc.computeTotals(s);
    const cards = s.items.map((item, i) => {
      const p = `items.${i}`;
      return `<div class="item-card">
        <div class="item-head"><span class="item-no">${String(i + 1).padStart(2, '0')}</span>
          <span class="item-total" data-line-total="${i}">${esc(calc.formatNumber(totals.lines[i].net, d))} ${esc(s.currency.code)}</span>${rowTools('items', i)}</div>
        <textarea rows="2" data-path="${p}.desc" placeholder="Description" aria-label="Description of item ${i + 1}">${esc(item.desc)}</textarea>
        <div class="item-grid">
          ${input('Qty', `${p}.qty`, { type: 'number', step: 'any' })}
          ${input('Unit price', `${p}.price`, { type: 'number', step: 'any' })}
          ${input('UoM', `${p}.uom`, { placeholder: 'pcs' })}
          ${input('Disc %', `${p}.discount`, { type: 'number', step: 'any', min: 0, max: 100 })}
          ${input('Tax %', `${p}.tax`, { type: 'number', step: 'any', min: 0, max: 100 })}
        </div></div>`;
    }).join('');
    const columns = s.columns.map((c, i) => `<div class="col-row">
        <label class="mini-check"><input type="checkbox" data-path="columns.${i}.visible" data-kind="bool"${c.visible ? ' checked' : ''}><b>${esc(c.key)}</b></label>
        <input data-path="columns.${i}.label" value="${esc(c.label)}" aria-label="${esc(c.key)} column label">
        <div class="row-tools">${button('↑', 'up', { path: 'columns', index: i }, 'icon', 'Move left')}${button('↓', 'down', { path: 'columns', index: i }, 'icon', 'Move right')}</div></div>`).join('');
    return `${cards || '<p class="empty">No line items.</p>'}
      <div class="btn-row">${button('+ Add line item', 'add', { path: 'items', tpl: 'item' }, 'primary')}</div>
      <details class="nested"><summary>Paste many lines at once</summary>
        <p class="hint">One item per line: <code>Description ⇥ Qty ⇥ Price</code> (copy straight from Excel), or separate with <code>|</code> or <code>;</code>.</p>
        <textarea id="bulk-items" rows="4" placeholder="PORT CHARGES | 2 | 717.5"></textarea>
        ${button('Add these lines', 'bulk-add', {}, 'ghost')}
      </details>
      <details class="nested"><summary>Table columns: show, rename, reorder</summary>
        <p class="hint"><code>{CUR}</code> in a label becomes the currency code.</p>${columns}
      </details>`;
  }

  function sectionTotals(s) {
    const charges = s.totals.charges.map((c, i) => `<div class="kv-row">
        <input class="kv-label" data-path="totals.charges.${i}.label" value="${esc(c.label)}" aria-label="Charge label">
        <input type="number" step="any" data-kind="num" data-path="totals.charges.${i}.amount" value="${esc(c.amount)}" aria-label="Charge amount">
        <div class="kv-extra">${rowTools('totals.charges', i)}</div></div>`).join('');
    return `<div class="grid3">
        ${select('Discount type', 'totals.discountType', [['percent', '% of subtotal'], ['amount', 'Fixed amount']])}
        ${input('Discount', 'totals.discountValue', { type: 'number', step: 'any', min: 0 })}
        ${input('Discount label', 'totals.discountLabel')}
        ${input('Tax label', 'totals.taxLabel')}
        ${input('Tax rate %', 'totals.taxRate', { type: 'number', step: 'any', min: 0, max: 100 })}
        ${input('Line-tax label', 'totals.lineTaxLabel')}
        ${input('Paid / advance', 'totals.paid', { type: 'number', step: 'any', min: 0 })}
        ${input('Paid label', 'totals.paidLabel')}
        ${input('Gross total label', 'totals.grandLabel')}
        ${input('Subtotal label', 'totals.subtotalLabel')}
        ${input('Final row label', 'totals.totalLabel', { cls: 'span2' })}
      </div>
      ${toggle('Always show subtotal row', 'totals.alwaysShowSubtotal')}
      <h4 class="sub">Extra charges</h4>
      <div class="kv-editor">${charges || '<p class="empty">None. Add freight, insurance, handling…</p>'}${button('+ Add charge', 'add', { path: 'totals.charges', tpl: 'charge' }, 'ghost')}</div>
      <h4 class="sub">Amount in words</h4>
      ${toggle('Show amount in words', 'sections.words')}
      ${input('Sentence template', 'words.template')}
      ${input('Fraction part', 'words.minorTemplate')}
      ${select('Letter case', 'words.casing', [['upper', 'UPPER CASE'], ['title', 'Title Case'], ['sentence', 'Sentence case'], ['lower', 'lower case']])}
      <p class="hint">Tokens: <code>{COUNTRY}</code> <code>{MAJOR_NAME}</code> <code>{MAJOR_WORDS}</code> <code>{MINOR_PART}</code> <code>{CODE}</code> · fraction: <code>{MINOR_WORDS}</code> <code>{MINOR_NAME}</code> <code>{MINOR_NUMBER}</code></p>`;
  }

  function sectionFooter() {
    return `<div class="toggle-grid">
        ${toggle('Notes', 'sections.notes')}${toggle('Bank details', 'sections.bank')}${toggle('Signature line', 'sections.signature')}
        ${toggle('Stamp image', 'sections.stamp')}${toggle('Printed-on bar', 'sections.printed')}${toggle('Terms & warning', 'sections.terms')}
      </div>
      <div class="grid2">
        ${input('Notes heading', 'footer.notesTitle')}${input('Bank heading', 'footer.bankTitle')}
        ${textarea('Notes', 'footer.notes', { rows: 3, cls: 'span2' })}
      </div>
      <h4 class="sub">Bank details</h4>${kvEditor('bank')}
      <div class="grid2">
        ${input('Signature caption', 'footer.signatureLabel')}${input('Prepared by', 'footer.preparedBy')}
        <label class="field span2"><span>Stamp / signature image (transparent PNG works best)</span><input type="file" accept="image/*" data-asset="stamp"></label>
        ${textarea('Terms', 'footer.terms', { rows: 3, cls: 'span2' })}
        ${textarea('Highlighted warning', 'footer.warning', { rows: 2, cls: 'span2' })}
      </div>`;
  }

  function sectionDesign(s) {
    const fonts = same(defaults.FONTS);
    const presets = Object.entries(defaults.THEME_PRESETS).map(([name, p]) => `<button type="button" class="preset${s.theme.preset === name ? ' is-active' : ''}" data-act="preset" data-name="${esc(name)}">
        <i style="background:${p.primary}"></i><i style="background:${p.accent}"></i><span>${esc(name)}</span></button>`).join('');
    return `<div class="presets">${presets}</div>
      <div class="swatches">${color('Primary', 'theme.primary')}${color('Accent', 'theme.accent')}${color('Text', 'theme.text')}${color('Table head', 'theme.headFill')}${color('Head text', 'theme.headText')}${color('Title band', 'theme.band')}</div>
      <div class="grid2">
        ${select('Heading font', 'theme.headingFont', fonts)}${select('Body font', 'theme.bodyFont', fonts)}
        ${input('Text size', 'theme.baseSize', { type: 'range', min: 7, max: 12, step: 0.5, unit: 'pt' })}
        ${input('Page margin', 'theme.margin', { type: 'range', min: 5, max: 25, step: 1, unit: 'mm' })}
        ${select('Header layout', 'theme.headerLayout', [['classic', 'Classic row'], ['centered', 'Logo centred'], ['banner', 'Colour banner']])}
        ${select('Title style', 'theme.titleStyle', [['band', 'Tinted band'], ['solid', 'Solid bar'], ['underline', 'Underlined'], ['plain', 'Plain']])}
        ${select('Title alignment', 'theme.titleAlign', [['center', 'Centre'], ['left', 'Left'], ['right', 'Right']])}
        ${select('Table style', 'theme.tableStyle', [['grid', 'Full grid'], ['striped', 'Striped rows'], ['minimal', 'Minimal lines'], ['boxed', 'Boxed']])}
        ${select('Density', 'theme.density', [['compact', 'Compact'], ['normal', 'Normal'], ['airy', 'Airy']])}
        ${input('Corner radius', 'theme.radius', { type: 'range', min: 0, max: 12, step: 1, unit: 'px' })}
        ${select('Paper', 'theme.paper', [['A4', 'A4'], ['Letter', 'US Letter']])}
        ${select('Date format', 'theme.dateFormat', same(['D MMM YYYY', 'DD MMM YYYY', 'D MMMM YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY']))}
        ${select('Number style', 'theme.grouping', [['comma', '1,234.500'], ['dot', '1.234,500'], ['space', '1 234.500'], ['none', '1234.500']])}
        ${input('Qty decimals', 'theme.qtyDecimals', { type: 'number', min: 0, max: 4 })}
      </div>
      <div class="toggle-grid">
        ${toggle('Currency after unit price', 'theme.priceWithCurrency')}${toggle('Accent rules', 'theme.goldRules')}
        ${toggle('Hide empty fields', 'sections.hideEmpty')}${toggle('Page-break guides', 'sections.pageGuides')}
        ${toggle('Watermark', 'sections.watermark')}
      </div>
      ${input('Watermark text', 'theme.watermarkText', { placeholder: 'DRAFT, PAID, COPY…' })}`;
  }

  function sectionWorkspace() {
    const settings = ctx.settings();
    return `<p class="hint">Save your company details, design, labels and terms as the starting point for every new invoice.</p>
      <div class="btn-row">${button('Save as my defaults', 'cmd', { cmd: 'save-default' }, 'primary')}${button('Load sample invoice', 'cmd', { cmd: 'sample' }, 'ghost')}</div>
      <h4 class="sub">Automatic numbering</h4>
      <div class="grid2">
        ${input('Prefix', 'prefix', { scope: 'settings' })}
        ${input('Next sequence', 'next', { scope: 'settings', type: 'number', min: 1 })}
        ${input('Pattern', 'pattern', { scope: 'settings', cls: 'span2' })}
        ${input('Digits', 'pad', { scope: 'settings', type: 'number', min: 1, max: 8 })}
        <div class="field"><span>Next number</span><output class="num-preview" id="num-preview">${esc(store.formatDocNumber(settings))}</output></div>
      </div>
      <p class="hint">Tokens: <code>{PREFIX}</code> <code>{YYYY}</code> <code>{YY}</code> <code>{MM}</code> <code>{SEQ}</code></p>
      <h4 class="sub">Backup</h4>
      <div class="btn-row">${button('Export everything', 'cmd', { cmd: 'export-all' }, 'ghost')}${button('Export this invoice', 'cmd', { cmd: 'export-one' }, 'ghost')}${button('Import file', 'cmd', { cmd: 'import' }, 'ghost')}</div>
      <div class="btn-row">${button('Reset design to factory defaults', 'cmd', { cmd: 'reset-brand' }, 'ghost danger')}</div>`;
  }

  const SECTIONS = [
    ['document', 'Document', 'Title, number, currency', sectionDocument],
    ['company', 'Your company', 'Name, address, logo', sectionCompany],
    ['customer', 'Customer', 'Bill-to and saved clients', sectionCustomer],
    ['meta', 'Invoice details', 'Dates, references', sectionMeta],
    ['shipment', 'Shipment', 'Vessel, ports, containers', sectionShipment],
    ['items', 'Line items', 'Items, columns, bulk paste', sectionItems],
    ['totals', 'Totals & wording', 'Discounts, tax, charges', sectionTotals],
    ['footer', 'Footer', 'Notes, bank, signature, terms', sectionFooter],
    ['design', 'Design', 'Colours, fonts, layout', sectionDesign],
    ['workspace', 'Workspace', 'Defaults, numbering, backup', sectionWorkspace],
  ];

  /* ---------- render ---------- */
  function render() {
    const s = ctx.state();
    const scroll = root.scrollTop;
    root.innerHTML = SECTIONS.map(([id, title, hint, body], i) => `<details class="panel" data-section="${id}"${openSections.has(id) ? ' open' : ''}>
        <summary><span class="panel-num">${String(i + 1).padStart(2, '0')}</span><span class="panel-title">${title}<small>${hint}</small></span></summary>
        <div class="panel-body">${openSections.has(id) ? body(s) : ''}</div></details>`).join('');
    root.scrollTop = scroll;
  }

  function refreshLineTotals() {
    const s = ctx.state();
    const totals = calc.computeTotals(s);
    root.querySelectorAll('[data-line-total]').forEach((el) => {
      const line = totals.lines[Number(el.dataset.lineTotal)];
      if (line) el.textContent = `${calc.formatNumber(line.net, calc.toNum(s.currency.decimals))} ${s.currency.code}`;
    });
  }

  /* ---------- events ---------- */
  function readValue(el) {
    if (el.dataset.kind === 'bool') return el.checked;
    if (el.dataset.kind === 'num') return el.value === '' ? '' : Number(el.value);
    return el.value;
  }

  function onInput(event) {
    const el = event.target;
    if (!el.dataset.path || el.type === 'file') return;
    const out = el.type === 'range' ? el.closest('.field').querySelector('output') : null;
    if (out) out.textContent = el.value + out.dataset.unit;
    if (el.dataset.scope === 'settings') {
      ctx.setSetting(el.dataset.path, readValue(el));
      const preview = root.querySelector('#num-preview');
      if (preview) preview.textContent = store.formatDocNumber(ctx.settings());
      return;
    }
    ctx.set(el.dataset.path, readValue(el), el.hasAttribute('data-rerender'));
    if (el.type === 'color') ctx.set('theme.preset', 'Custom', false);
    if (/^(items|currency)\./.test(el.dataset.path)) refreshLineTotals();
  }

  function onChange(event) {
    const el = event.target;
    if (el.dataset.asset && el.files && el.files[0]) {
      ctx.command('upload-asset', { name: el.dataset.asset, file: el.files[0] });
      el.value = '';
      return;
    }
    if (el.dataset.cmd === 'currency' && el.value) ctx.set('currency', { ...defaults.CURRENCIES[el.value] }, true);
    if (el.dataset.cmd === 'client' && el.value) {
      const client = store.listClients().find((c) => c.name === el.value);
      if (client) ctx.set('customer', structuredClone(client), true);
    }
  }

  function listOp(op, path, index, tpl) {
    const list = getIn(ctx.state(), path) || [];
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

  function parseBulk(text) {
    return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const sep = ['\t', '|', ';'].find((x) => line.includes(x));
      const [desc, qty, price] = sep ? line.split(sep).map((x) => x.trim()) : [line];
      return { ...defaults.blankItem(), desc, qty: qty === undefined ? 1 : calc.toNum(qty), price: calc.toNum(price) };
    });
  }

  function addBulk() {
    const area = root.querySelector('#bulk-items');
    const items = parseBulk(area.value);
    if (!items.length) {
      ctx.toast('Paste at least one line first.', 'warn');
      return;
    }
    const kept = ctx.state().items.filter((i) => i.desc || calc.toNum(i.price));
    ctx.set('items', [...kept, ...items], true);
    ctx.toast(`Added ${items.length} line${items.length > 1 ? 's' : ''}.`);
  }

  function onClick(event) {
    const btn = event.target.closest('[data-act]');
    if (!btn) return;
    const { act, path, tpl, name, cmd } = btn.dataset;
    if (['add', 'remove', 'up', 'down', 'dup'].includes(act)) listOp(act, path, Number(btn.dataset.index), tpl);
    else if (act === 'preset') ctx.set('theme', { ...ctx.state().theme, ...defaults.THEME_PRESETS[name], preset: name }, true);
    else if (act === 'bulk-add') addBulk();
    else if (act === 'client-save' || act === 'client-delete') ctx.command(act);
    else if (act === 'cmd') ctx.command(cmd);
  }

  function onToggle(event) {
    const panel = event.target;
    if (!panel.matches || !panel.matches('details.panel')) return;
    const id = panel.dataset.section;
    if (panel.open && !openSections.has(id)) {
      openSections.add(id);
      panel.querySelector('.panel-body').innerHTML = SECTIONS.find((x) => x[0] === id)[3](ctx.state());
    } else if (!panel.open) {
      openSections.delete(id);
    }
    ctx.savePrefs({ open: [...openSections] });
  }

  function mount(element, context) {
    root = element;
    ctx = context;
    openSections = new Set(context.prefs().open || ['document', 'items']);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('click', onClick);
    root.addEventListener('toggle', onToggle, true);
    render();
  }

  NB.editor = { mount, render };
})(window.NB = window.NB || {});
