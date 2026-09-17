/* App shell: state ownership, commands, library, zoom, print. */
(function (NB) {
  'use strict';

  const { store, defaults, render, editor, calc } = NB;
  const $ = (sel) => document.querySelector(sel);
  const SHEET_WIDTH_PX = { A4: 793.7, Letter: 816 };
  const CONFIRM_WINDOW_MS = 4000;
  const DRAFT_DEBOUNCE_MS = 400;

  let state = null;
  let settings = null;
  let prefs = null;
  let dirty = false;
  let previewQueued = false;
  let draftTimer = null;
  let pendingConfirm = null;

  /* ---------- state ---------- */
  function setIn(obj, keys, value) {
    if (!keys.length) return value;
    const [key, ...rest] = keys;
    const src = obj ?? {};
    const copy = Array.isArray(src) ? src.slice() : { ...src };
    copy[key] = setIn(src[key], rest, value);
    return copy;
  }

  function normalize(inv) {
    const merged = defaults.mergeBrand(inv);
    return {
      ...merged,
      id: inv.id || defaults.uid(),
      number: inv.number ?? '',
      status: inv.status || 'draft',
      customer: { name: '', address: '', contacts: [], ...(inv.customer || {}) },
      items: Array.isArray(inv.items) ? inv.items : [],
    };
  }

  function set(path, value, structural = false) {
    state = setIn(state, path.split('.'), value);
    dirty = true;
    afterChange(structural);
  }

  function replaceState(next, isDirty = false) {
    state = normalize(next);
    dirty = isDirty;
    afterChange(true);
  }

  function afterChange(structural) {
    if (structural) editor.render();
    schedulePreview();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => guard(() => store.saveDraft(state)), DRAFT_DEBOUNCE_MS);
  }

  const hasContent = (inv) => Boolean(inv.customer.name || inv.items.some((i) => i.desc || calc.toNum(i.price)));

  /* ---------- feedback ---------- */
  function toast(message, tone = 'ok') {
    const el = $('#toast');
    el.textContent = message;
    el.dataset.tone = tone;
    el.classList.remove('is-shown');
    void el.offsetWidth;
    el.classList.add('is-shown');
  }

  function guard(fn) {
    try {
      return fn();
    } catch (err) {
      toast(err instanceof store.StorageError ? err.message : `Something went wrong: ${err.message}`, 'error');
      return undefined;
    }
  }

  function confirmTwice(key, message) {
    const now = Date.now();
    if (pendingConfirm && pendingConfirm.key === key && now - pendingConfirm.at < CONFIRM_WINDOW_MS) {
      pendingConfirm = null;
      return true;
    }
    pendingConfirm = { key, at: now };
    toast(message, 'warn');
    return false;
  }

  /* ---------- preview ---------- */
  function schedulePreview() {
    if (previewQueued) return;
    previewQueued = true;
    requestAnimationFrame(() => {
      previewQueued = false;
      $('#preview').innerHTML = render.invoice(state);
      updatePageRule();
      updateChrome();
      if (!prefs.zoom) applyZoom();
    });
  }

  function updatePageRule() {
    const margin = Math.min(Math.max(calc.toNum(state.theme.margin), 0), 30);
    const paper = state.theme.paper === 'Letter' ? { size: 'letter', h: 279.4 } : { size: 'A4', h: 297 };
    $('#page-rule').textContent = `@page { size: ${paper.size}; margin: ${margin}mm; }
      @media print { .sheet { width: auto !important; min-height: ${paper.h - margin * 2 - 0.5}mm !important; padding: 0 !important; } }`;
  }

  function updateChrome() {
    const totals = calc.computeTotals(state);
    $('#doc-number').textContent = state.number || 'Unnumbered';
    $('#doc-customer').textContent = state.customer.name || 'No customer yet';
    $('#doc-total').textContent = `${calc.formatNumber(totals.balance, calc.toNum(state.currency.decimals), state.theme.grouping)} ${state.currency.code}`;
    $('#save-state').dataset.state = dirty ? 'dirty' : 'saved';
    $('#save-state').textContent = dirty ? 'Unsaved changes' : 'Saved';
  }

  function applyZoom() {
    const stage = $('#stage-scroll');
    const sheetWidth = SHEET_WIDTH_PX[state.theme.paper] || SHEET_WIDTH_PX.A4;
    const fit = Math.min(1.4, Math.max(0.3, (stage.clientWidth - 48) / sheetWidth));
    const zoom = prefs.zoom || fit;
    $('#zoom').style.zoom = zoom;
    $('#zoom-label').textContent = prefs.zoom ? `${Math.round(zoom * 100)}%` : `Fit ${Math.round(zoom * 100)}%`;
  }

  function stepZoom(delta) {
    const current = Number($('#zoom').style.zoom) || 1;
    prefs = { ...prefs, zoom: Math.min(2, Math.max(0.3, Math.round((current + delta) * 10) / 10)) };
    guard(() => store.savePrefs(prefs));
    applyZoom();
  }

  /* ---------- files ---------- */
  function download(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const safeName = (s) => String(s || 'invoice').replace(/[^\w.-]+/g, '_');

  function readFile(file, as) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read the file.'));
      if (as === 'dataUrl') reader.readAsDataURL(file);
      else reader.readAsText(file);
    });
  }

  async function uploadAsset({ name, file }) {
    if (!file.type.startsWith('image/')) {
      toast('Please choose an image file.', 'error');
      return;
    }
    try {
      store.setAsset(name, await readFile(file, 'dataUrl'));
      if (name === 'logo') set('company.logo', 'custom', true);
      else set('sections.stamp', true, true);
      toast(name === 'logo' ? 'Logo updated.' : 'Stamp added to the signature line.');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function importFile(file) {
    try {
      const result = store.importAll(JSON.parse(await readFile(file, 'text')));
      if (result.kind === 'invoice') {
        replaceState(result.invoice, true);
        toast('Invoice imported. Press Save to keep it in your library.');
      } else {
        editor.render();
        schedulePreview();
        toast(`Backup restored: ${result.count} invoice${result.count === 1 ? '' : 's'}.`);
      }
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message, 'error');
    }
  }

  /* ---------- commands ---------- */
  function keepCurrent() {
    if (dirty && hasContent(state)) {
      store.saveInvoice(state);
      return ` (saved ${state.number} first)`;
    }
    return '';
  }

  function printInvoice() {
    const previous = document.title;
    document.title = safeName(`${state.title} ${state.number} ${state.customer.name}`).replace(/_/g, ' ');
    $('#preview').innerHTML = render.invoice(state);
    window.print();
    document.title = previous;
  }

  const COMMANDS = {
    new: () => {
      const note = keepCurrent();
      replaceState(defaults.newInvoice(store.loadBrand(), store.consumeNumber()));
      toast(`New invoice started${note}.`);
    },
    save: () => {
      state = store.saveInvoice(state);
      dirty = false;
      updateChrome();
      store.saveDraft(state);
      toast(`${state.number} saved to your library.`);
    },
    duplicate: () => {
      const note = keepCurrent();
      const date = defaults.today();
      replaceState({
        ...structuredClone(state), id: defaults.uid(), number: store.consumeNumber(), status: 'draft',
        meta: state.meta.map((f, i) => (f.type === 'date' && i === 0 ? { ...f, value: date } : f)),
        createdAt: new Date().toISOString(),
      }, true);
      toast(`Duplicated as ${state.number}${note}.`);
    },
    print: printInvoice,
    library: openLibrary,
    sample: () => {
      const note = keepCurrent();
      replaceState(defaults.sampleInvoice(store.loadBrand(), state.number), true);
      toast(`Sample loaded${note}.`);
    },
    'save-default': () => {
      store.saveBrand(defaults.brandFromInvoice(state));
      toast('Saved. New invoices will start with this company, design and wording.');
    },
    'reset-brand': () => {
      if (!confirmTwice('reset-brand', 'Click again to reset the design, columns and sections to factory defaults.')) return;
      store.resetBrand();
      const base = defaults.defaultBrand();
      replaceState({ ...state, theme: base.theme, sections: base.sections, columns: base.columns, words: base.words }, true);
      toast('Design reset.');
    },
    'export-all': () => download(`nb-invoices-backup-${defaults.today()}.json`, store.exportAll()),
    'export-one': () => download(`${safeName(state.number)}.json`, state),
    import: () => $('#import-file').click(),
    'upload-asset': uploadAsset,
    'client-save': () => {
      store.saveClient(state.customer);
      editor.render();
      toast(`${state.customer.name} saved to clients.`);
    },
    'client-delete': () => {
      if (!confirmTwice('client-delete', 'Click Forget again to remove this saved client.')) return;
      store.deleteClient(state.customer.name);
      editor.render();
      toast('Client removed.');
    },
  };

  const command = (name, payload) => guard(() => COMMANDS[name] && COMMANDS[name](payload));

  /* ---------- library ---------- */
  function libraryRows(query) {
    const q = query.trim().toLowerCase();
    return store.listInvoices().map(normalize).filter((inv) => !q
      || [inv.number, inv.customer.name, inv.status, inv.title].some((v) => String(v || '').toLowerCase().includes(q)));
  }

  function renderLibrary() {
    const rows = libraryRows($('#lib-search').value);
    const { esc } = render;
    $('#lib-list').innerHTML = rows.length ? rows.map((inv) => {
      const total = calc.computeTotals(inv).balance;
      const date = inv.meta.find((f) => f.type === 'date' && f.value);
      const current = inv.id === state.id ? ' is-current' : '';
      return `<li class="lib-row${current}">
        <div class="lib-main"><strong>${esc(inv.number || 'Unnumbered')}</strong><span>${esc(inv.customer.name || 'No customer')}</span></div>
        <div class="lib-meta"><span class="chip chip--${esc(inv.status)}">${esc(inv.status)}</span><span>${esc(inv.title)}</span>
          <span>${esc(date ? calc.formatDate(date.value, inv.theme.dateFormat) : '')}</span></div>
        <div class="lib-total">${esc(calc.formatNumber(total, calc.toNum(inv.currency.decimals), inv.theme.grouping))} <small>${esc(inv.currency.code)}</small></div>
        <div class="lib-actions">
          <button type="button" class="btn primary" data-lib="open" data-id="${esc(inv.id)}">Open</button>
          <button type="button" class="btn ghost danger" data-lib="delete" data-id="${esc(inv.id)}">Delete</button>
        </div></li>`;
    }).join('') : '<li class="lib-empty">No saved invoices match. Press <b>Save</b> on an invoice to keep it here.</li>';
  }

  function openLibrary() {
    renderLibrary();
    $('#library').showModal();
    $('#lib-search').focus();
  }

  function onLibraryClick(event) {
    const btn = event.target.closest('[data-lib]');
    if (!btn) return;
    const { id } = btn.dataset;
    guard(() => {
      if (btn.dataset.lib === 'open') {
        const note = id === state.id ? '' : keepCurrent();
        replaceState(store.getInvoice(id));
        $('#library').close();
        toast(`Opened ${state.number}${note}.`);
      } else if (confirmTwice(`delete-${id}`, 'Click Delete again to permanently remove this invoice.')) {
        store.deleteInvoice(id);
        if (id === state.id) dirty = true;
        renderLibrary();
        updateChrome();
        toast('Invoice deleted.');
      }
    });
  }

  /* ---------- boot ---------- */
  function bindShell() {
    document.querySelectorAll('[data-cmd]').forEach((btn) => btn.addEventListener('click', () => command(btn.dataset.cmd)));
    $('#import-file').addEventListener('change', (e) => {
      if (e.target.files[0]) importFile(e.target.files[0]);
      e.target.value = '';
    });
    $('#lib-search').addEventListener('input', renderLibrary);
    $('#lib-list').addEventListener('click', onLibraryClick);
    $('#zoom-in').addEventListener('click', () => stepZoom(0.1));
    $('#zoom-out').addEventListener('click', () => stepZoom(-0.1));
    $('#zoom-fit').addEventListener('click', () => {
      prefs = { ...prefs, zoom: 0 };
      guard(() => store.savePrefs(prefs));
      applyZoom();
    });
    window.addEventListener('resize', () => { if (!prefs.zoom) applyZoom(); });
    document.querySelectorAll('[data-view]').forEach((btn) => btn.addEventListener('click', () => {
      document.body.dataset.view = btn.dataset.view;
      document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      if (!prefs.zoom) applyZoom();
    }));
    document.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 's') { e.preventDefault(); command('save'); }
      if (key === 'p') { e.preventDefault(); command('print'); }
    });
  }

  function boot() {
    prefs = store.loadPrefs();
    const draft = store.loadDraft();
    state = draft ? normalize(draft) : defaults.sampleInvoice(store.loadBrand(), store.consumeNumber());
    settings = store.loadSettings();
    editor.mount($('#editor'), {
      state: () => state,
      settings: () => settings,
      prefs: () => prefs,
      set,
      setSetting: (key, value) => {
        settings = { ...settings, [key]: value };
        guard(() => store.saveSettings(settings));
      },
      savePrefs: (patch) => {
        prefs = { ...prefs, ...patch };
        guard(() => store.savePrefs(prefs));
      },
      command,
      toast,
    });
    bindShell();
    schedulePreview();
    if (!draft) {
      dirty = true;
      toast('Welcome! This is a sample built from your reference invoice. Edit anything on the left.');
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})(window.NB = window.NB || {});
