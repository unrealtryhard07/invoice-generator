/* IndexedDB storage for large binary data: invoice attachments and uploaded brand fonts. */
(function (NB) {
  'use strict';

  const DB_NAME = 'nb-invoice-files';
  const DB_VERSION = 1;
  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const MAX_FONT_BYTES = 5 * 1024 * 1024;
  const FONT_EXTENSIONS = /\.(woff2?|ttf|otf)$/i;
  const ATTACHMENT_KINDS = ['Bill of Lading', 'Customs Declaration', 'Delivery Order', 'Packing List', 'Commercial Invoice', 'Certificate of Origin', 'Other'];

  class BlobStoreError extends Error {}

  let dbPromise = null;
  function db() {
    if (!('indexedDB' in window)) return Promise.reject(new BlobStoreError('This browser cannot store files.'));
    dbPromise = dbPromise || new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const files = req.result.createObjectStore('files', { keyPath: 'id' });
        files.createIndex('invoiceId', 'invoiceId');
        req.result.createObjectStore('fonts', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new BlobStoreError('Could not open file storage.'));
    });
    return dbPromise;
  }

  async function run(storeName, mode, action) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, mode);
      const request = action(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(new BlobStoreError(tx.error && tx.error.name === 'QuotaExceededError'
        ? 'Storage is full. Delete some attachments first.' : 'File storage failed.'));
    });
  }

  /* ---------- attachments ---------- */
  async function addFile(invoiceId, file, kind = 'Other') {
    if (file.size > MAX_FILE_BYTES) throw new BlobStoreError(`${file.name} is larger than 25 MB.`);
    const record = { id: NB.defaults.uid(), invoiceId, name: file.name, type: file.type || 'application/octet-stream', size: file.size, kind, addedAt: new Date().toISOString(), blob: file };
    await run('files', 'readwrite', (s) => s.put(record));
    return record;
  }
  const listFiles = async (invoiceId) => ((await run('files', 'readonly', (s) => s.index('invoiceId').getAll(invoiceId))) || [])
    .sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  const getFile = (id) => run('files', 'readonly', (s) => s.get(id));
  async function updateFile(id, patch) {
    const record = await getFile(id);
    if (record) await run('files', 'readwrite', (s) => s.put({ ...record, ...patch }));
  }
  const deleteFile = (id) => run('files', 'readwrite', (s) => s.delete(id));
  async function deleteFilesFor(invoiceId) {
    const files = await listFiles(invoiceId);
    await Promise.all(files.map((f) => deleteFile(f.id)));
  }

  /* ---------- fonts ---------- */
  const familyFromName = (name) => String(name).replace(FONT_EXTENSIONS, '').replace(/[-_]+/g, ' ').replace(/[^\w ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Custom Font';

  async function registerFont(record) {
    const face = new FontFace(record.family, await record.blob.arrayBuffer());
    await face.load();
    document.fonts.add(face);
  }

  async function addFont(file) {
    if (!FONT_EXTENSIONS.test(file.name)) throw new BlobStoreError('Upload a .ttf, .otf, .woff or .woff2 font file.');
    if (file.size > MAX_FONT_BYTES) throw new BlobStoreError('Font file is larger than 5 MB.');
    const record = { id: NB.defaults.uid(), family: familyFromName(file.name), name: file.name, blob: file };
    try {
      await registerFont(record);
    } catch {
      throw new BlobStoreError(`${file.name} is not a valid font.`);
    }
    await run('fonts', 'readwrite', (s) => s.put(record));
    return record;
  }
  const listFonts = async () => (await run('fonts', 'readonly', (s) => s.getAll())) || [];
  const deleteFont = (id) => run('fonts', 'readwrite', (s) => s.delete(id));

  /** Registers all stored fonts and returns their family names. Broken fonts are skipped. */
  async function loadFonts() {
    const fonts = await listFonts();
    const results = await Promise.allSettled(fonts.map(registerFont));
    return fonts.filter((_, i) => results[i].status === 'fulfilled').map((f) => f.family);
  }

  NB.blobs = {
    BlobStoreError, ATTACHMENT_KINDS, addFile, listFiles, getFile, updateFile, deleteFile, deleteFilesFor,
    addFont, listFonts, deleteFont, loadFonts,
  };
})(window.NB = window.NB || {});
