const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../js/calc.js');
const ledger = require('../js/ledger.js');
const wordsAr = require('../js/words-ar.js');

const TODAY = '2026-09-19';
const KWD = { code: 'KWD', decimals: 3, majorAr: 'دينار كويتي', minorAr: 'فلس' };
const doc = (overrides = {}) => ({
  id: 'a', number: 'NB-1', title: 'TAX INVOICE', docType: 'tax', status: 'sent', customer: { name: 'Cura' }, currency: KWD,
  meta: [{ key: 'invoiceDate', value: '2026-09-01' }],
  totals: { discountType: 'percent', discountValue: 0, taxRate: 0, charges: [] },
  items: [{ qty: 1, price: 1000 }], payments: [],
  ...overrides,
});

test('an invoice paid or credited beyond its total is Overpaid, not Paid', () => {
  assert.equal(ledger.status(doc({ payments: [{ amount: 1000 }] }), TODAY), 'paid');
  assert.equal(ledger.status(doc({ payments: [{ amount: 1200 }] }), TODAY), 'overpaid');
  const credit = doc({ id: 'c', number: 'CN-1', title: 'CREDIT NOTE', docType: 'credit', creditFor: 'a', items: [{ qty: 1, price: 1000 }] });
  const [prepared] = ledger.prepare([doc({ payments: [{ amount: 900 }] }), credit]);
  assert.equal(ledger.status(prepared, TODAY), 'overpaid');
});

test('a fixed discount cannot exceed the subtotal or go negative', () => {
  const withDiscount = (discountValue) => calc.computeTotals(doc({ totals: { ...doc().totals, discountType: 'amount', discountValue } }));
  assert.equal(withDiscount(999999).discount, 1000);
  assert.equal(withDiscount(999999).total, 0);
  assert.equal(withDiscount(-50).discount, 0);
  assert.equal(withDiscount(250).total, 750);
});

test('parses pasted amounts with either decimal separator', () => {
  assert.equal(calc.parseAmount('717,5'), 717.5);
  assert.equal(calc.parseAmount('717,50'), 717.5);
  assert.equal(calc.parseAmount('1,000'), 1000);
  assert.equal(calc.parseAmount('1.234,5'), 1234.5);
  assert.equal(calc.parseAmount('1,234.5'), 1234.5);
  assert.equal(calc.parseAmount('KWD 12.250'), 12.25);
  assert.equal(calc.parseAmount(''), 0);
});

test('splits pasted lines without breaking descriptions that contain the separator', () => {
  const lines = calc.parseBulkLines('PORT CHARGES | 2 | 717,5\nTHC | DOC FEES | 1 | 10\nCUSTOMS DUTY\t3\t8.8\nJUST TEXT | MORE TEXT\nFREIGHT; 4\n\n');
  assert.deepEqual(lines, [
    { desc: 'PORT CHARGES', qty: 2, price: 717.5 },
    { desc: 'THC | DOC FEES', qty: 1, price: 10 },
    { desc: 'CUSTOMS DUTY', qty: 3, price: 8.8 },
    { desc: 'JUST TEXT | MORE TEXT', qty: 1, price: 0 },
    { desc: 'FREIGHT', qty: 4, price: 0 },
  ]);
});

test('writes one dinar and one fils the Arabic way (noun before number)', () => {
  assert.equal(wordsAr.amountToWords(1, KWD), 'فقط دينار كويتي واحد لا غير');
  assert.equal(wordsAr.amountToWords(1.001, KWD), 'فقط دينار كويتي واحد وفلس واحد لا غير');
  assert.equal(wordsAr.amountToWords(21, KWD), 'فقط واحد وعشرون دينار كويتي لا غير');
});
