const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/browser-env.js');

const YEAR = new Date().getFullYear();
const num = (seq) => `NB-${YEAR}-${String(seq).padStart(4, '0')}`;
const saveNumbered = (NB, number, extra = {}) => NB.store.saveInvoice({ id: `id-${number}`, number, updatedAt: '', ...extra });

test('never issues a number that a saved document already uses', () => {
  const { NB } = loadApp();
  saveNumbered(NB, num(1));
  saveNumbered(NB, num(2));
  // counter rolled back (the old stale-settings bug, or a manual edit)
  NB.store.saveSettings({ ...NB.store.loadSettings(), next: 1 });
  assert.equal(NB.store.consumeNumber(), num(3));
  assert.equal(NB.store.loadSettings().next, 4);
});

test('gives back the last number when a new document is abandoned', () => {
  const { NB } = loadApp();
  const first = NB.store.consumeNumber();
  const second = NB.store.consumeNumber();
  assert.equal(NB.store.releaseNumber(first), false, 'only the most recent number can be returned');
  assert.equal(NB.store.releaseNumber(second), true);
  assert.equal(NB.store.consumeNumber(), second);
});

test('detects a number used by another document', () => {
  const { NB } = loadApp();
  saveNumbered(NB, 'NB-7');
  assert.equal(NB.store.numberTaken('NB-7'), true);
  assert.equal(NB.store.numberTaken(' nb-7 '), true);
  assert.equal(NB.store.numberTaken('NB-7', 'id-NB-7'), false, 'a document does not clash with itself');
  assert.equal(NB.store.numberTaken(''), false);
});

test('restoring a backup never rewinds the numbering counter', () => {
  const { NB } = loadApp();
  NB.store.saveSettings({ ...NB.store.loadSettings(), next: 40, prefix: 'NB' });
  NB.store.importAll({ app: 'nb-invoice-studio', invoices: {}, settings: { next: 3, prefix: 'XY' } });
  const settings = NB.store.loadSettings();
  assert.equal(settings.next, 40);
  assert.equal(settings.prefix, 'XY');
});

test('restoring a backup keeps whichever copy of a document is newer', () => {
  const { NB, localStorage } = loadApp();
  localStorage.setItem('nbinv.invoices', JSON.stringify({
    a: { id: 'a', number: 'A', customer: { name: 'LOCAL NEWER' }, updatedAt: '2026-09-18T10:00:00.000Z' },
    b: { id: 'b', number: 'B', customer: { name: 'LOCAL OLDER' }, updatedAt: '2026-01-01T10:00:00.000Z' },
  }));
  const result = NB.store.importAll({
    app: 'nb-invoice-studio',
    invoices: {
      a: { id: 'a', number: 'A', customer: { name: 'BACKUP OLDER' }, updatedAt: '2026-05-01T10:00:00.000Z' },
      b: { id: 'b', number: 'B', customer: { name: 'BACKUP NEWER' }, updatedAt: '2026-06-01T10:00:00.000Z' },
      c: { id: 'c', number: 'C', customer: { name: 'ONLY IN BACKUP' }, updatedAt: '2026-06-01T10:00:00.000Z' },
    },
  });
  assert.equal(NB.store.getInvoice('a').customer.name, 'LOCAL NEWER');
  assert.equal(NB.store.getInvoice('b').customer.name, 'BACKUP NEWER');
  assert.equal(NB.store.getInvoice('c').customer.name, 'ONLY IN BACKUP');
  assert.deepEqual({ count: result.count, kept: result.kept }, { count: 2, kept: 1 });
});

test('reports how much of the browser storage budget is used', () => {
  const { NB, localStorage } = loadApp();
  localStorage.setItem('nbinv.invoices', 'x'.repeat(1000));
  localStorage.setItem('unrelated', 'y'.repeat(5000));
  const usage = NB.store.usage();
  assert.equal(usage.chars, 'nbinv.invoices'.length + 1000);
  assert.ok(usage.ratio > 0 && usage.ratio < 0.01);
  assert.equal(usage.quota, NB.store.QUOTA_CHARS);
});
