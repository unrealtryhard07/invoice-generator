/* localStorage persistence: draft, invoice library, brand defaults, clients, numbering, images. */
(function (NB) {
  'use strict';

  const KEY = {
    draft: 'nbinv.draft', invoices: 'nbinv.invoices', brand: 'nbinv.brand', clients: 'nbinv.clients',
    settings: 'nbinv.settings', prefs: 'nbinv.prefs', catalog: 'nbinv.catalog', templates: 'nbinv.templates', asset: (name) => `nbinv.asset.${name}`,
  };
  const DEFAULT_SETTINGS = { prefix: 'NB', pattern: '{PREFIX}-{YYYY}-{SEQ}', pad: 4, next: 1, baseCurrency: 'KWD', backupFiles: false };
  // Browsers allow about 5 million characters of localStorage per site.
  const QUOTA_CHARS = 5 * 1024 * 1024;
  const WARN_RATIO = 0.8;
  const MAX_ASSET_BYTES = 1.5 * 1024 * 1024;

  class StorageError extends Error {}

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      throw new StorageError(err && err.name === 'QuotaExceededError'
        ? 'Browser storage is full. Export a backup and delete old invoices.'
        : 'Could not save to browser storage.');
    }
  }

  const loadDraft = () => read(KEY.draft, null);
  const saveDraft = (invoice) => write(KEY.draft, invoice);

  const invoiceMap = () => read(KEY.invoices, {});
  const listInvoices = () => Object.values(invoiceMap()).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const getInvoice = (id) => invoiceMap()[id] || null;
  const saveInvoice = (invoice) => {
    const saved = { ...invoice, updatedAt: new Date().toISOString() };
    write(KEY.invoices, { ...invoiceMap(), [invoice.id]: saved });
    return saved;
  };
  const deleteInvoice = (id) => {
    const { [id]: _removed, ...rest } = invoiceMap();
    write(KEY.invoices, rest);
  };

  const loadBrand = () => NB.defaults.mergeBrand(read(KEY.brand, null));
  const saveBrand = (brand) => write(KEY.brand, brand);
  const resetBrand = () => localStorage.removeItem(KEY.brand);

  const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...read(KEY.settings, {}) });
  const saveSettings = (settings) => write(KEY.settings, settings);

  function formatDocNumber(settings, seq = settings.next) {
    const now = new Date();
    return String(settings.pattern || DEFAULT_SETTINGS.pattern)
      .replace('{PREFIX}', settings.prefix || '')
      .replace('{YYYY}', String(now.getFullYear()))
      .replace('{YY}', String(now.getFullYear()).slice(2))
      .replace('{MM}', String(now.getMonth() + 1).padStart(2, '0'))
      .replace('{SEQ}', String(Math.max(1, Math.floor(Number(seq) || 1))).padStart(Number(settings.pad) || 1, '0'));
  }

  const numberKey = (number) => String(number ?? '').trim().toLowerCase();

  /** True when another saved document already carries this number. */
  function numberTaken(number, exceptId = null) {
    const key = numberKey(number);
    return Boolean(key) && Object.values(invoiceMap()).some((inv) => inv.id !== exceptId && numberKey(inv.number) === key);
  }

  /** Issues the next document number, skipping any number a saved document already uses. */
  function consumeNumber() {
    const settings = loadSettings();
    let seq = Math.max(1, Math.floor(Number(settings.next)) || 1);
    while (numberTaken(formatDocNumber(settings, seq))) seq += 1;
    saveSettings({ ...settings, next: seq + 1 });
    return formatDocNumber(settings, seq);
  }

  /** Returns the most recently issued number when its document was abandoned before being saved. */
  function releaseNumber(number) {
    const settings = loadSettings();
    const last = (Math.floor(Number(settings.next)) || 1) - 1;
    if (last < 1 || formatDocNumber(settings, last) !== number || numberTaken(number)) return false;
    saveSettings({ ...settings, next: last });
    return true;
  }

  const listClients = () => read(KEY.clients, []);
  function saveClient(customer) {
    const name = String(customer.name || '').trim();
    if (!name) throw new StorageError('Enter a customer name before saving the client.');
    const others = listClients().filter((c) => c.name.trim().toLowerCase() !== name.toLowerCase());
    write(KEY.clients, [...others, structuredClone(customer)].sort((a, b) => a.name.localeCompare(b.name)));
  }
  const deleteClient = (name) => write(KEY.clients, listClients().filter((c) => c.name !== name));

  const listCatalog = () => read(KEY.catalog, null) || structuredClone(NB.defaults.CATALOG_SEED);
  const saveCatalog = (list) => write(KEY.catalog, list);
  function upsertCatalogItem(item) {
    const name = String(item.name || '').trim();
    if (!name) throw new StorageError('Give the charge a description before saving it.');
    const list = listCatalog();
    const existing = list.find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
    const entry = { ...(existing || { id: NB.defaults.uid() }), ...item, name };
    saveCatalog(existing ? list.map((c) => (c.id === existing.id ? entry : c)) : [...list, entry]);
    return Boolean(existing);
  }

  const customTemplates = () => read(KEY.templates, []);
  const listTemplates = () => [...NB.defaults.TEMPLATES, ...customTemplates()];
  function saveTemplate(template) {
    const name = String(template.name || '').trim();
    if (!name) throw new StorageError('Give the template a name.');
    write(KEY.templates, [...customTemplates().filter((t) => t.id !== template.id), { ...template, name }]);
  }
  const deleteTemplate = (id) => write(KEY.templates, customTemplates().filter((t) => t.id !== id));

  const getAsset = (name) => read(KEY.asset(name), null);
  function setAsset(name, dataUrl) {
    if (dataUrl.length > MAX_ASSET_BYTES * 1.37) throw new StorageError('Image is too large. Use an image under 1.5 MB.');
    write(KEY.asset(name), dataUrl);
  }
  const removeAsset = (name) => localStorage.removeItem(KEY.asset(name));

  const loadPrefs = () => ({ zoom: 0, tab: 'content', ...read(KEY.prefs, {}) });
  const savePrefs = (prefs) => write(KEY.prefs, prefs);

  function exportAll() {
    return {
      app: 'nb-invoice-studio', version: 1, exportedAt: new Date().toISOString(),
      invoices: invoiceMap(), brand: read(KEY.brand, null), clients: listClients(), settings: loadSettings(), catalog: read(KEY.catalog, null), templates: customTemplates(),
      assets: { logo: getAsset('logo'), stamp: getAsset('stamp') },
    };
  }

  const isNewer = (a, b) => String(a.updatedAt || '') > String(b.updatedAt || '');

  // Restoring never replaces a document with an older copy of itself.
  function mergeInvoices(incoming) {
    const local = invoiceMap();
    const entries = Object.entries(incoming || {}).filter(([, inv]) => inv && typeof inv === 'object');
    const taken = entries.filter(([id, inv]) => !local[id] || !isNewer(local[id], inv));
    write(KEY.invoices, { ...local, ...Object.fromEntries(taken) });
    return { count: taken.length, kept: entries.length - taken.length };
  }

  function importAll(data) {
    if (!data || typeof data !== 'object') throw new StorageError('This file is not a valid backup.');
    if (data.app === 'nb-invoice-studio') {
      const { count, kept } = mergeInvoices(data.invoices);
      if (data.brand) write(KEY.brand, data.brand);
      if (Array.isArray(data.clients)) write(KEY.clients, data.clients);
      if (Array.isArray(data.catalog)) saveCatalog(data.catalog);
      if (Array.isArray(data.templates)) write(KEY.templates, data.templates);
      if (data.settings && typeof data.settings === 'object') {
        // Numbering only ever moves forward, so a restored backup cannot re-issue numbers already used.
        const current = loadSettings();
        const next = Math.max(Math.floor(Number(current.next)) || 1, Math.floor(Number(data.settings.next)) || 1);
        saveSettings({ ...DEFAULT_SETTINGS, ...current, ...data.settings, next });
      }
      Object.entries(data.assets || {}).forEach(([name, url]) => { if (typeof url === 'string') setAsset(name, url); });
      return { kind: 'backup', count, kept };
    }
    if (Array.isArray(data.items) && data.currency && data.theme) return { kind: 'invoice', invoice: data };
    throw new StorageError('Unrecognised file. Import a backup or a single exported invoice.');
  }

  /** Characters this app keeps in localStorage, against the browser's per-site budget. */
  function usage() {
    let chars = 0;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('nbinv.')) chars += key.length + String(localStorage.getItem(key) || '').length;
    }
    const ratio = chars / QUOTA_CHARS;
    return { chars, quota: QUOTA_CHARS, ratio, nearlyFull: ratio >= WARN_RATIO };
  }

  NB.store = {
    StorageError, QUOTA_CHARS, usage, loadDraft, saveDraft, listInvoices, getInvoice, saveInvoice, deleteInvoice,
    loadBrand, saveBrand, resetBrand, loadSettings, saveSettings, formatDocNumber, consumeNumber, releaseNumber, numberTaken,
    listClients, saveClient, deleteClient, listCatalog, saveCatalog, upsertCatalogItem, listTemplates, saveTemplate, deleteTemplate, getAsset, setAsset, removeAsset, loadPrefs, savePrefs, exportAll, importAll,
  };
})(window.NB = window.NB || {});
