/* App shell: hash routing, autosave, commands, printing, and wiring of editor, canvas and views. */
(function (NB) {
  'use strict';

  const { store, defaults, render, editor, calc, ledger, ui, views, documents, blobs } = NB;
  const $ = (sel) => document.querySelector(sel);
  const AUTOSAVE_MS = 450;
  const MAX_UPLOAD_BYTES = 1.5 * 1024 * 1024;

  let state = null;
  let prefs = null;
  let storageWarned = false;
  let saveTimer = null;
  let previewQueued = false;
  let cache = null;
  let invoiceCanvas = null;
  let statementCanvas = null;

  const today = () => defaults.today();

  /* ---------- state ---------- */
  function setIn(obj, keys, value) {
    if (!keys.length) return value;
    const [key, ...rest] = keys;
    const src = obj ?? {};
    const copy = Array.isArray(src) ? src.slice() : { ...src };
    copy[key] = setIn(src[key], rest, value);
    return copy;
  }

  const listInvoices = () => {
    cache = cache || store.listInvoices().map(defaults.migrate);
    return cache;
  };
  const ledgerInvoices = () => ledger.prepare(listInvoices());
  const invalidate = () => { cache = null; };
  const creditNotesFor = (id) => listInvoices().filter((inv) => inv.creditFor === id && inv.status !== 'cancelled');
  // The open document with any linked credit notes applied (for status and balances only — never saved).
  const prepared = (inv) => ledger.prepare([inv, ...listInvoices().filter((x) => x.id !== inv.id)])[0];
  const LINK_KEYS = ['supersededBy', 'supersededByNumber', 'convertedFrom', 'convertedFromNumber', 'creditFor', 'creditForNumber'];
  const hasContent = (inv) => Boolean(inv.customer.name || inv.items.some((i) => i.desc || calc.toNum(i.price)));

  function guard(fn) {
    try {
      return fn();
    } catch (err) {
      ui.toast(err instanceof store.StorageError ? err.message : `Something went wrong: ${err.message}`, 'error');
      return undefined;
    }
  }

  function set(path, value, structural = false) {
    state = setIn(state, path.split('.'), value);
    afterChange(structural);
  }

  function update(fn, structural = false) {
    state = fn(state);
    afterChange(structural);
  }

  function afterChange(structural) {
    if (structural) editor.render();
    schedulePreview();
    updateEditorChrome('Editing…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, AUTOSAVE_MS);
  }

  function persist(force = false) {
    clearTimeout(saveTimer);
    if (!state || !(force || hasContent(state) || store.getInvoice(state.id))) return;
    guard(() => {
      state = store.saveInvoice(state);
      invalidate();
      updateEditorChrome('Saved');
      updateBadges();
      warnIfStorageNearlyFull();
    });
  }

  function warnIfStorageNearlyFull() {
    if (storageWarned) return;
    const { ratio, nearlyFull } = store.usage();
    if (!nearlyFull) return;
    storageWarned = true;
    ui.toast(`Browser storage is ${Math.round(ratio * 100)}% full. Export a backup and remove old documents (Settings → Backup).`, 'error');
  }

  // A new document that was never given any content is dropped, and its number handed back.
  function discardIfAbandoned() {
    if (!state || store.getInvoice(state.id) || hasContent(state)) return;
    store.releaseNumber(state.number);
    state = null;
  }

  /* ---------- preview & chrome ---------- */
  function updatePageRule(theme) {
    const margin = Math.min(Math.max(calc.toNum(theme.margin), 0), 30);
    const paper = theme.paper === 'Letter' ? { size: 'letter', h: 279.4 } : { size: 'A4', h: 297 };
    $('#page-rule').textContent = `@page { size: ${paper.size}; margin: ${margin}mm; }
      @media print { .sheet { width: auto !important; min-height: ${paper.h - margin * 2 - 0.5}mm !important; padding: 0 !important; --pofs: ${margin}mm; } }`;
  }

  function schedulePreview() {
    if (previewQueued || !state || document.querySelector('[data-view="editor"]').hidden) return;
    previewQueued = true;
    requestAnimationFrame(() => {
      previewQueued = false;
      invoiceCanvas.render(render.invoice(state), state.theme.paper);
      updatePageRule(state.theme);
    });
  }

  function updateEditorChrome(saveLabel) {
    if (!state) return;
    const view = prepared(state);
    const status = ledger.status(view, today());
    const title = String(state.title || 'Invoice').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    $('#editor-title').textContent = `${title} ${state.number || ''}`.trim();
    const total = calc.computeTotals(view);
    const parts = [state.customer.name || 'No customer', ui.STATUS_LABELS[status],
      `${calc.formatNumber(total.balance, calc.toNum(state.currency.decimals), state.theme.grouping)} ${state.currency.code} due`];
    if (saveLabel) $('#editor-subtitle').dataset.save = saveLabel;
    $('#editor-subtitle').textContent = [...parts, $('#editor-subtitle').dataset.save || 'Saved'].join(' · ');
    document.querySelectorAll('#language-seg [data-lang]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.lang === state.language)));
    $('#stamp-toggle').checked = Boolean(state.stamp && state.stamp.show);
    $('#qr-toggle').checked = Boolean(state.qr && state.qr.show);
  }

  function updateBadges() {
    const all = ledgerInvoices();
    const overdue = all.filter((inv) => ledger.status(inv, today()) === 'overdue').length;
    $('#nav-count-invoices').textContent = all.length || '';
    $('#nav-count-overdue').textContent = overdue || '';
  }

  // Statements always use the saved default design, not whichever invoice was opened last.
  const brand = () => defaults.newInvoice(store.loadBrand(), '');

  /* ---------- routing ---------- */
  const VIEW_TITLES = { dashboard: 'Dashboard', invoices: 'Invoices', editor: 'Invoice', customers: 'Customers', charges: 'Saved Charges', settings: 'Settings' };

  function show(name) {
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
    const navKey = name === 'editor' ? 'invoices' : name;
    document.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.title = `${name === 'editor' && state ? `${state.number} · ` : ''}${VIEW_TITLES[name]} · Nayef Bashar Trading`;
  }

  function openInvoice(id) {
    if (!state || state.id !== id) {
      const found = listInvoices().find((inv) => inv.id === id);
      if (!found) {
        ui.toast('That invoice could not be found.');
        location.hash = '#/invoices';
        return false;
      }
      state = structuredClone(found);
    }
    prefs = { ...prefs, lastId: id };
    guard(() => store.savePrefs(prefs));
    editor.render();
    schedulePreview();
    updateEditorChrome('Saved');
    return true;
  }

  function route() {
    persist();
    $('#combo').hidden = true;
    const [, view = 'invoices', rawArg = ''] = location.hash.split('/');
    const arg = decodeURIComponent(rawArg);
    if (!(view === 'invoice' && state && state.id === arg)) discardIfAbandoned();
    if (view === 'invoice') {
      if (openInvoice(arg)) show('editor');
      schedulePreview();
    } else if (view === 'dashboard') {
      show('dashboard');
      NB.dashboard.render();
    } else if (view === 'customers') {
      show('customers');
      views.renderCustomers(arg);
    } else if (view === 'charges') {
      show('charges');
      views.renderCharges();
    } else if (view === 'settings') {
      show('settings');
      views.renderSettings();
    } else {
      show('invoices');
      views.renderInvoices();
    }
    updateBadges();
  }

  /* ---------- files ---------- */
  function download(filename, data) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const readFile = (file, as) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the file.'));
    if (as === 'dataUrl') reader.readAsDataURL(file);
    else reader.readAsText(file);
  });

  async function uploadAsset({ name, file }) {
    if (!file.type.startsWith('image/')) return ui.toast('Please choose an image file.', 'error');
    if (file.size > MAX_UPLOAD_BYTES) return ui.toast('Image is too large. Use one under 1.5 MB.', 'error');
    try {
      store.setAsset(name, await readFile(file, 'dataUrl'));
      if (name === 'logo') set('company.logo', 'custom', true);
      else set('stamp', { ...state.stamp, source: 'custom', show: true }, true);
      return ui.toast(name === 'logo' ? 'Logo updated.' : 'Stamp image updated.');
    } catch (err) {
      return ui.toast(err.message, 'error');
    }
  }

  function restoreSummary({ count, kept }, files) {
    const docs = `${count} document${count === 1 ? '' : 's'}`;
    const newer = kept ? ` ${kept} newer document${kept === 1 ? ' was' : 's were'} kept as they are.` : '';
    const attached = files ? ` ${files} attachment${files === 1 ? '' : 's'} and fonts restored.` : '';
    return `Backup restored: ${docs}.${newer}${attached}`;
  }

  async function importFile(file) {
    try {
      const data = JSON.parse(await readFile(file, 'text'));
      const result = store.importAll(data);
      invalidate();
      if (result.kind === 'invoice') {
        const incoming = defaults.migrate({ ...result.invoice, id: defaults.uid() });
        const clash = store.numberTaken(incoming.number);
        const inv = store.saveInvoice(clash ? { ...incoming, number: store.consumeNumber() } : incoming);
        invalidate();
        location.hash = `#/invoice/${encodeURIComponent(inv.id)}`;
        ui.toast(clash ? `Invoice imported as ${inv.number} — ${incoming.number} is already used.` : 'Invoice imported.');
      } else {
        const files = await blobs.importAll(data).catch((err) => {
          ui.toast(`Documents restored, but attachments could not be: ${err.message}`, 'error');
          return 0;
        });
        if (files || (Array.isArray(data.fonts) && data.fonts.length)) await reloadFonts();
        route();
        ui.toast(restoreSummary(result, files));
      }
    } catch (err) {
      ui.toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message, 'error');
    }
  }

  async function exportBackup() {
    const withFiles = Boolean(store.loadSettings().backupFiles);
    try {
      const files = withFiles ? await blobs.exportAll() : {};
      download(`nb-invoices-backup-${today()}.json`, { ...store.exportAll(), ...files });
      ui.toast(withFiles ? `Backup saved with ${files.files.length} attachment${files.files.length === 1 ? '' : 's'}.` : 'Backup saved.');
    } catch (err) {
      ui.toast(`Backup failed: ${err.message}`, 'error');
    }
  }

  /* ---------- commands ---------- */
  function printView(viewName) {
    persist();
    const view = document.querySelector(`.view[data-view="${viewName}"]`);
    const previous = document.title;
    if (viewName === 'editor' && state) {
      document.title = `${state.title} ${state.number} ${state.customer.name}`.replace(/[\\/:*?"<>|]+/g, ' ').trim();
      updatePageRule(state.theme);
    } else {
      document.title = `Statement of Account ${today()}`;
    }
    view.classList.add('is-printing');
    const cleanup = () => {
      view.classList.remove('is-printing');
      document.title = previous;
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  }

  let pdfBusy = false;
  async function downloadPdf() {
    if (!state || pdfBusy) return;
    persist();
    const btn = $('#download-pdf');
    const label = btn.querySelector('span');
    pdfBusy = true;
    btn.disabled = true;
    label.textContent = 'Preparing…';
    try {
      const filename = `${NB.pdf.safeFilename(state)}.pdf`;
      const { fontsEmbedded } = await NB.pdf.downloadInvoice(state, filename);
      ui.toast(fontsEmbedded
        ? `Saved “${filename}” to your Downloads.`
        : `Saved “${filename}”. You seem to be offline, so this computer's fonts were used — use Print / PDF for exact fonts.`);
    } catch (err) {
      ui.toast(err.message || 'PDF export failed. Use Print / PDF instead.', 'error');
    } finally {
      pdfBusy = false;
      btn.disabled = false;
      label.textContent = 'Download PDF';
    }
  }

  function duplicateInvoice(source) {
    const copy = defaults.migrate({
      ...Object.fromEntries(Object.entries(structuredClone(source)).filter(([k]) => !LINK_KEYS.includes(k))), id: defaults.uid(), number: store.consumeNumber(), status: 'draft', payments: [],
      meta: source.meta.map((f) => (f.key === 'invoiceDate' ? { ...f, value: today() } : f.key === 'dueDate' ? { ...f, value: '' } : f)),
      createdAt: new Date().toISOString(),
    });
    const saved = store.saveInvoice(copy);
    invalidate();
    return saved;
  }

  const COMMANDS = {
    new: () => {
      persist();
      openTemplateDialog();
    },
    'new-from': ({ id }) => {
      const template = id ? store.listTemplates().find((t) => t.id === id) : null;
      discardIfAbandoned();
      state = defaults.newInvoice(store.loadBrand(), store.consumeNumber(), template);
      prefs = { ...prefs, tab: 'document' };
      location.hash = `#/invoice/${encodeURIComponent(state.id)}`;
    },
    convert: ({ target }) => {
      persist(true);
      const openBalance = calc.computeTotals(prepared(state)).balance;
      const { source, target: created } = documents.convert(state, target, { id: defaults.uid(), number: store.consumeNumber(), today: today(), openBalance });
      store.saveInvoice(source);
      state = store.saveInvoice(defaults.migrate(created));
      invalidate();
      location.hash = `#/invoice/${encodeURIComponent(state.id)}`;
      ui.toast(`${created.title.charAt(0)}${created.title.slice(1).toLowerCase()} ${created.number} created from ${source.number}.`);
    },
    'apply-template': ({ id }) => {
      const template = store.listTemplates().find((t) => t.id === id);
      if (!template) return;
      update((cur) => defaults.migrate(defaults.applyTemplate(cur, template)), true);
      ui.toast(`Applied “${template.name}”. Your customer, items and payments were kept.`);
    },
    'save-template': () => {
      const name = `${String(state.title).charAt(0)}${String(state.title).slice(1).toLowerCase()} — ${state.customer.name || 'custom'} (${today()})`;
      store.saveTemplate(defaults.templateFromInvoice(state, name));
      ui.toast('Template saved. Rename or delete it in Settings → Templates.');
    },
    duplicate: () => {
      persist();
      const copy = duplicateInvoice(state);
      state = copy;
      location.hash = `#/invoice/${encodeURIComponent(copy.id)}`;
      ui.toast(`Duplicated as ${copy.number}.`);
    },
    'list-duplicate': ({ id }) => {
      const source = listInvoices().find((inv) => inv.id === id);
      if (!source) return;
      const copy = duplicateInvoice(source);
      views.renderInvoices();
      updateBadges();
      ui.toast(`Duplicated as ${copy.number}.`);
    },
    'list-delete': ({ id }) => {
      const inv = listInvoices().find((x) => x.id === id);
      if (!inv) return;
      const blocker = documents.deleteBlocker(inv, listInvoices());
      if (blocker) {
        ui.toast(blocker, 'error');
        return;
      }
      if (!ui.confirmTwice(`delete-${id}`, `Click delete again to permanently remove ${inv.number}.`)) return;
      store.deleteInvoice(id);
      blobs.deleteFilesFor(id).catch(() => ui.toast('Invoice deleted, but its attachments could not be removed.', 'error'));
      if (state && state.id === id) state = null;
      invalidate();
      views.renderInvoices();
      updateBadges();
      ui.toast(`${inv.number} deleted.`);
    },
    print: () => printView('editor'),
    'download-pdf': () => downloadPdf(),
    'print-statement': () => printView('customers'),
    'save-default': () => {
      store.saveBrand(defaults.brandFromInvoice(state));
      ui.toast('New invoices will now start with this design and wording.');
    },
    'reset-brand': () => {
      if (!ui.confirmTwice('reset-brand', 'Click again to reset the new-invoice design to factory defaults.')) return;
      store.resetBrand();
      ui.toast('Defaults reset. Existing invoices are unchanged.');
    },
    'export-all': () => exportBackup(),
    import: () => $('#import-file').click(),
    'upload-asset': uploadAsset,
    'client-save': () => {
      store.saveClient(state.customer);
      editor.render();
      ui.toast(`${state.customer.name} saved to customers.`);
    },
    'charge-add': () => views.addCharge(),
  };

  const command = (name, payload) => guard(() => (COMMANDS[name] ? COMMANDS[name](payload || {}) : undefined));

  function openTemplateDialog() {
    const { esc } = ui;
    const cards = store.listTemplates().map((t) => `<button type="button" class="template-card" data-template="${esc(t.id)}">
        <strong>${esc(t.name)}</strong><span>${esc(t.description || '')}</span>${t.builtIn ? '' : '<em>Your template</em>'}</button>`).join('');
    $('#template-grid').innerHTML = `<button type="button" class="template-card" data-template=""><strong>My Defaults</strong><span>Your saved design and wording.</span></button>${cards}`;
    $('#template-dialog').showModal();
  }

  async function reloadFonts() {
    try {
      NB.customFonts = await blobs.loadFonts();
    } catch (err) {
      NB.customFonts = [];
    }
    schedulePreview();
  }

  /* ---------- boot ---------- */
  function migrateLegacyDraft() {
    if (prefs.migratedDraft) return;
    const draft = store.loadDraft();
    if (draft && !store.getInvoice(draft.id)) {
      const inv = defaults.migrate(draft);
      if (hasContent(inv)) store.saveInvoice({ ...inv, status: inv.status === 'draft' ? 'sent' : inv.status });
    }
    if (!store.listInvoices().length) store.saveInvoice(defaults.sampleInvoice(store.loadBrand(), store.consumeNumber()));
    prefs = { ...prefs, migratedDraft: true };
    store.savePrefs(prefs);
  }

  function bindShell() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cmd]');
      if (btn && btn.tagName === 'BUTTON' && !btn.closest('#inspector')) command(btn.dataset.cmd);
    });
    $('#template-grid').addEventListener('click', (e) => {
      const card = e.target.closest('[data-template]');
      if (!card) return;
      $('#template-dialog').close();
      command('new-from', { id: card.dataset.template });
    });
    $('#import-file').addEventListener('change', (e) => {
      if (e.target.files[0]) importFile(e.target.files[0]);
      e.target.value = '';
    });
    $('#language-seg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-lang]');
      if (b && state) set('language', b.dataset.lang, true);
    });
    $('#qr-toggle').addEventListener('change', (e) => {
      if (state) set('qr', { ...state.qr, show: e.target.checked }, true);
    });
    $('#stamp-toggle').addEventListener('change', (e) => {
      if (state) set('stamp', { ...state.stamp, show: e.target.checked }, true);
    });
    document.querySelector('.pane-switch').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pane]');
      if (!b) return;
      document.querySelector('.editor-body').dataset.pane = b.dataset.pane;
      document.querySelectorAll('.pane-switch [data-pane]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      invoiceCanvas.applyZoom();
    });
    document.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      const onEditor = !document.querySelector('[data-view="editor"]').hidden;
      const onCustomers = !document.querySelector('[data-view="customers"]').hidden;
      if (key === 's') {
        e.preventDefault();
        persist();
        ui.toast('Saved.');
      } else if (key === 'd' && e.shiftKey && onEditor) {
        e.preventDefault();
        downloadPdf();
      } else if (key === 'p' && (onEditor || onCustomers)) {
        e.preventDefault();
        printView(onEditor ? 'editor' : 'customers');
      }
    });
    window.addEventListener('hashchange', route);
    window.addEventListener('beforeunload', () => {
      persist();
      discardIfAbandoned();
    });
    window.addEventListener('resize', () => {
      invoiceCanvas.applyZoom();
      statementCanvas.applyZoom();
    });
  }

  function boot() {
    prefs = store.loadPrefs();
    guard(migrateLegacyDraft);
    ui.bind(() => state || {});

    invoiceCanvas = NB.canvas.create($('#invoice-canvas'), {
      getZoom: () => prefs.zoom || 0,
      setZoom: (zoom) => { prefs = { ...prefs, zoom }; guard(() => store.savePrefs(prefs)); },
      onMove: (kind, patch) => set(kind, { ...state[kind], ...patch }, prefs.tab === 'style'),
      onLayoutChange: (order) => set('layout', order, prefs.tab === 'style'),
      onColumnResize: (key, width) => set('columns', state.columns.map((c) => (c.key === key ? { ...c, width } : c))),
      onArrangeStart: () => ui.toast('Drag sections to reorder them. Drag the blue column edges to resize. Double-click an edge to reset.'),
      render: () => { previewQueued = false; schedulePreview(); },
    });
    statementCanvas = NB.canvas.create($('#statement-canvas'), {});

    editor.mount($('#inspector'), {
      state: () => state,
      set,
      update,
      command,
      guard,
      today,
      toast: ui.toast,
      prepared,
      creditNotesFor,
      persistNow: () => persist(true),
      reloadFonts,
      prefs: () => prefs,
      savePrefs: (patch) => { prefs = { ...prefs, ...patch }; guard(() => store.savePrefs(prefs)); },
    });
    // Settings are always read from storage: numbering advances there, so a cached copy would go stale.
    NB.dashboard.mount({ ledgerInvoices, today, settings: store.loadSettings });
    views.mount({
      listInvoices: ledgerInvoices,
      command,
      guard,
      today,
      brand,
      statementCanvas,
      updatePageRule,
      settings: store.loadSettings,
      setSetting: (key, value) => guard(() => store.saveSettings({ ...store.loadSettings(), [key]: value })),
      numberTaken: store.numberTaken,
    });

    bindShell();
    reloadFonts().then(() => { if (state) editor.render(); });
    const target = prefs.lastId && store.getInvoice(prefs.lastId) ? `#/invoice/${encodeURIComponent(prefs.lastId)}` : '#/invoices';
    if (!location.hash) location.hash = target;
    else route();
  }

  document.addEventListener('DOMContentLoaded', boot);
})(window.NB = window.NB || {});
