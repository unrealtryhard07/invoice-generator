const test = require('node:test');
const assert = require('node:assert/strict');
const documents = require('../js/documents.js');
const ledger = require('../js/ledger.js');
const calc = require('../js/calc.js');
const { loadApp } = require('./helpers/browser-env.js');

const TODAY = '2026-09-19';
const KWD = { code: 'KWD', decimals: 3 };
const makeDoc = (overrides = {}) => ({
  id: 'q1', number: 'NB-1', title: 'QUOTATION', docType: 'quotation', status: 'sent', customer: { name: 'Cura' }, currency: KWD,
  meta: [{ key: 'invoiceDate', value: '2026-01-01' }, { key: 'dueDate', value: '2026-01-15' }],
  totals: { discountType: 'amount', discountValue: 0, taxRate: 0, charges: [] },
  items: [{ qty: 2, price: 500 }], payments: [],
  ...overrides,
});
const metaValue = (inv, key) => (inv.meta.find((f) => f.key === key) || {}).value;

test('converting keeps the payment terms instead of the old due date', () => {
  const { target } = documents.convert(makeDoc(), 'proforma', { id: 'p1', number: 'NB-2', today: TODAY });
  assert.equal(metaValue(target, 'invoiceDate'), TODAY);
  assert.equal(metaValue(target, 'dueDate'), '2026-10-03');
  assert.equal(target.docType, 'proforma');
  assert.equal(ledger.status({ ...target, status: 'sent' }, TODAY), 'unpaid');
  const noTerms = documents.convert(makeDoc({ meta: [{ key: 'invoiceDate', value: '2026-01-01' }, { key: 'dueDate', value: '' }] }), 'tax', { id: 't', number: 'T', today: TODAY });
  assert.equal(metaValue(noTerms.target, 'dueDate'), '');
});

test('a credit note defaults to the amount still owed', () => {
  const invoice = makeDoc({ title: 'TAX INVOICE', docType: 'tax', totals: { discountType: 'amount', discountValue: 0, taxRate: 5, charges: [{ label: 'X', amount: 50 }] } });
  const full = documents.convert(invoice, 'credit', { id: 'c1', number: 'CN-1', today: TODAY, openBalance: calc.computeTotals(invoice).total });
  assert.equal(calc.computeTotals(full.target).total, calc.computeTotals(invoice).total, 'unpaid invoice: full copy');
  assert.equal(full.target.items.length, invoice.items.length);

  const partial = documents.convert(invoice, 'credit', { id: 'c2', number: 'CN-2', today: TODAY, openBalance: 300 });
  assert.equal(calc.computeTotals(partial.target).total, 300);
  assert.equal(partial.target.items.length, 1);
  assert.match(partial.target.items[0].desc, /NB-1/);

  assert.throws(() => documents.convert(invoice, 'credit', { id: 'c3', number: 'CN-3', today: TODAY, openBalance: 0 }), /nothing left to credit/i);
});

test('document type is stored, not guessed from the title text', () => {
  assert.equal(documents.inferDocType('PROFORMA INVOICE'), 'proforma');
  assert.equal(documents.inferDocType('  tax invoice '), 'tax');
  assert.equal(documents.inferDocType('QUOTE REF 12'), 'quotation', 'legacy custom titles keep their old meaning once');
  assert.equal(documents.inferDocType('SERVICE BILL'), 'custom');
  const renamed = makeDoc({ title: 'INVOICE — QUOTE REF 12', docType: 'tax' });
  assert.equal(ledger.documentKind(renamed), 'invoice');
  assert.equal(documents.typeOf(renamed).id, 'tax');
  assert.equal(ledger.documentKind(makeDoc({ title: 'Anything', docType: 'credit' })), 'credit');
});

test('migration assigns a document type to older saved documents and brands', () => {
  const { NB } = loadApp();
  assert.equal(NB.defaults.migrate({ title: 'QUOTATION', items: [] }).docType, 'quotation');
  assert.equal(NB.defaults.migrate({ title: 'TAX INVOICE', items: [] }).docType, 'tax');
  assert.equal(NB.defaults.migrate({ title: 'My Title', docType: 'credit', items: [] }).docType, 'credit');
  assert.equal(NB.defaults.mergeBrand({ title: 'INVOICE' }).docType, 'invoice');
  assert.equal(NB.defaults.newInvoice(NB.store.loadBrand(), 'N-1').docType, 'proforma');
  const quote = NB.store.listTemplates().find((t) => t.id === 'tpl-quotation');
  assert.equal(NB.defaults.applyTemplate(NB.defaults.newInvoice(NB.store.loadBrand(), 'N-1'), quote).docType, 'quotation');
  assert.equal(NB.defaults.applyTemplate(NB.defaults.newInvoice(NB.store.loadBrand(), 'N-1'), { data: { title: 'CREDIT NOTE' } }).docType, 'credit');
});

test('explains why a linked document cannot be deleted', () => {
  const quote = makeDoc({ supersededBy: 'p1', supersededByNumber: 'NB-2' });
  const proforma = makeDoc({ id: 'p1', number: 'NB-2', title: 'PROFORMA INVOICE', docType: 'proforma', convertedFrom: 'q1', convertedFromNumber: 'NB-1' });
  const credit = makeDoc({ id: 'c1', number: 'CN-1', title: 'CREDIT NOTE', docType: 'credit', creditFor: 'p1' });
  const all = [quote, proforma, credit];
  assert.match(documents.deleteBlocker(proforma, all), /NB-1/);
  assert.match(documents.deleteBlocker({ ...proforma, convertedFrom: undefined }, all), /CN-1/);
  assert.equal(documents.deleteBlocker(credit, all), '');
  assert.equal(documents.deleteBlocker(quote, all), '', 'the original of a conversion may be removed');
  assert.equal(documents.deleteBlocker(proforma, [proforma, credit].map((d) => ({ ...d, status: 'cancelled' }))), '');
});
