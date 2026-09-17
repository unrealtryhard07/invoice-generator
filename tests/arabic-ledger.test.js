const test = require('node:test');
const assert = require('node:assert/strict');
const wordsAr = require('../js/words-ar.js');
const ledger = require('../js/ledger.js');
const calc = require('../js/calc.js');

const KWD = { code: 'KWD', decimals: 3, major: 'DINARS', minor: 'FILS', majorAr: 'دينار كويتي', minorAr: 'فلس', country: 'KUWAIT' };

test('spells the sample total in Arabic', () => {
  assert.equal(wordsAr.amountToWords(3919.6, KWD), 'فقط ثلاثة آلاف وتسعمائة وتسعة عشر دينار كويتي وستمائة فلس لا غير');
});

test('handles Arabic dual, plural and compound numbers', () => {
  assert.equal(wordsAr.integerToWords(2000), 'ألفان');
  assert.equal(wordsAr.integerToWords(21), 'واحد وعشرون');
  assert.equal(wordsAr.integerToWords(1250000), 'مليون ومائتان وخمسون ألف');
  assert.equal(wordsAr.integerToWords(11000), 'أحد عشر ألف');
  assert.equal(wordsAr.integerToWords(0), 'صفر');
  assert.equal(wordsAr.amountToWords(100, KWD), 'فقط مائة دينار كويتي لا غير');
});

test('converts to Arabic-Indic digits', () => {
  assert.equal(wordsAr.toArabicDigits('3,919.600'), '٣٬٩١٩٫٦٠٠');
});

const TODAY = '2026-09-17';
const makeInvoice = (overrides = {}) => ({
  id: overrides.id || 'a',
  number: overrides.number || 'NB-1',
  title: 'PROFORMA INVOICE',
  status: 'sent',
  customer: { name: 'Cura Health' },
  currency: KWD,
  meta: [{ key: 'invoiceDate', value: '2026-08-01' }, { key: 'dueDate', value: '2026-08-31' }],
  totals: { discountType: 'amount', discountValue: 0, taxRate: 0, charges: [], paid: 0 },
  items: [{ qty: 1, price: 1000, discount: 0, tax: 0 }],
  payments: [],
  ...overrides,
});

test('derives status from payments, due date and draft flag', () => {
  assert.equal(ledger.status(makeInvoice({ status: 'draft' }), TODAY), 'draft');
  assert.equal(ledger.status(makeInvoice(), TODAY), 'overdue');
  assert.equal(ledger.overdueDays(makeInvoice(), TODAY), 17);
  assert.equal(ledger.status(makeInvoice({ meta: [{ key: 'dueDate', value: '2026-10-01' }] }), TODAY), 'unpaid');
  assert.equal(ledger.status(makeInvoice({ meta: [], payments: [{ amount: 400 }] }), TODAY), 'partial');
  assert.equal(ledger.status(makeInvoice({ status: 'draft', payments: [{ amount: 600 }, { amount: 400 }] }), TODAY), 'paid');
  assert.equal(ledger.status(makeInvoice({ status: 'cancelled' }), TODAY), 'cancelled');
  assert.equal(ledger.status(makeInvoice({ title: 'QUOTATION' }), TODAY), 'issued');
});

test('payments reduce the balance in computeTotals', () => {
  const t = calc.computeTotals(makeInvoice({ payments: [{ amount: '250.5' }] }));
  assert.equal(t.paid, 250.5);
  assert.equal(t.balance, 749.5);
});

test('builds a statement with opening balance, running balance and ageing', () => {
  const invoices = [
    makeInvoice({ id: 'a', number: 'NB-1', payments: [{ date: '2026-08-10', amount: 300, method: 'K-Net' }] }),
    makeInvoice({ id: 'b', number: 'NB-2', meta: [{ key: 'invoiceDate', value: '2026-09-01' }, { key: 'dueDate', value: '2026-09-30' }] }),
    makeInvoice({ id: 'c', number: 'CN-1', title: 'CREDIT NOTE', items: [{ qty: 1, price: 100 }], meta: [{ key: 'invoiceDate', value: '2026-09-05' }] }),
    makeInvoice({ id: 'd', number: 'NB-3', status: 'draft' }),
    makeInvoice({ id: 'e', number: 'X-1', customer: { name: 'Other Co' } }),
  ];
  const s = ledger.statement(invoices, 'cura health', { currency: 'KWD', from: '2026-09-01', today: TODAY });
  assert.equal(s.opening, 700);
  assert.deepEqual(s.rows.map((r) => [r.ref, r.balance]), [['NB-2', 1700], ['CN-1', 1600]]);
  assert.equal(s.closing, 1600);
  assert.equal(s.ageing['1-30'], 700);
  assert.equal(s.ageing.current, 1000);

  const list = ledger.customers(invoices, TODAY);
  const cura = list.find((c) => c.key === 'cura health');
  assert.equal(cura.primary.balance, 1600);
  assert.equal(cura.overdueCount, 1);
  assert.equal(list.length, 2);
});
