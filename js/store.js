/* localStorage persistence: draft, invoice library, brand defaults, clients, numbering, images. */
(function (NB) {
  'use strict';

  const KEY = {
    draft: 'nbinv.draft', invoices: 'nbinv.invoices', brand: 'nbinv.brand', clients: 'nbinv.clients',
    settings: 'nbinv.settings', prefs: 'nbinv.prefs', catalog: 'nbinv.catalog', templates: 'nbinv.templates', asset: (name) => `nbinv.asset.${name}`,
  };
  const DEFAULT_SETTINGS = { prefix: 'NB', pattern: '{PREFIX}-{YYYY}-{SEQ}', pad: 4, next: 1, baseCurrency: 'KWD' };
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

  function consumeNumber() {
    const settings = loadSettings();
    const number = formatDocNumber(settings);
    saveSettings({ ...settings, next: (Math.floor(Number(settings.next)) || 1) + 1 });
    return number;
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

  function importAll(data) {
    if (!data || typeof data !== 'object') throw new StorageError('This file is not a valid backup.');
    if (data.app === 'nb-invoice-studio') {
      write(KEY.invoices, { ...invoiceMap(), ...(data.invoices || {}) });
      if (data.brand) write(KEY.brand, data.brand);
      if (Array.isArray(data.clients)) write(KEY.clients, data.clients);
      if (Array.isArray(data.catalog)) saveCatalog(data.catalog);
      if (Array.isArray(data.templates)) write(KEY.templates, data.templates);
      if (data.settings) saveSettings({ ...DEFAULT_SETTINGS, ...data.settings });
      Object.entries(data.assets || {}).forEach(([name, url]) => { if (typeof url === 'string') setAsset(name, url); });
      return { kind: 'backup', count: Object.keys(data.invoices || {}).length };
    }
    if (Array.isArray(data.items) && data.currency && data.theme) return { kind: 'invoice', invoice: data };
    throw new StorageError('Unrecognised file. Import a backup or a single exported invoice.');
  }

  NB.store = {
    StorageError, loadDraft, saveDraft, listInvoices, getInvoice, saveInvoice, deleteInvoice,
    loadBrand, saveBrand, resetBrand, loadSettings, saveSettings, formatDocNumber, consumeNumber,
    listClients, saveClient, deleteClient, listCatalog, saveCatalog, upsertCatalogItem, listTemplates, saveTemplate, deleteTemplate, getAsset, setAsset, removeAsset, loadPrefs, savePrefs, exportAll, importAll,
  };
})(window.NB = window.NB || {});
