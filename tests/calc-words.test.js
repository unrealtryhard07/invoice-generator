const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../js/calc.js');
const words = require('../js/words.js');

const KWD = { code: 'KWD', decimals: 3, major: 'DINARS', minor: 'FILS', country: 'KUWAIT' };

test('reproduces the sample invoice total and wording', () => {
  const invoice = {
    currency: KWD,
    totals: { discountType: 'amount', discountValue: 0, taxRate: 0, charges: [], paid: 0 },
    items: [[2, 80], [2, 672], [2, 717.5], [2, 447.5], [2, 34], [2, 8.8]]
      .map(([qty, price]) => ({ qty, price, discount: 0, tax: 0 })),
  };
  const totals = calc.computeTotals(invoice);
  assert.equal(totals.total, 3919.6);
  assert.equal(calc.formatNumber(totals.total, 3), '3,919.600');
  assert.equal(words.amountToWords(totals.total, KWD),
    'KUWAIT, DINARS THREE THOUSAND NINE HUNDRED NINETEEN AND SIX HUNDRED FILS ONLY');
});

test('applies line discount, line tax, invoice discount, VAT, charges and payments', () => {
  const invoice = {
    currency: { decimals: 2 },
    totals: { discountType: 'percent', discountValue: 10, taxRate: 5, charges: [{ label: 'Freight', amount: '12.5' }], paid: 50 },
    items: [{ qty: 3, price: 100, discount: 10, tax: 0 }, { qty: 1, price: '1,000', discount: 0, tax: 15 }],
  };
  const t = calc.computeTotals(invoice);
  assert.equal(t.subtotal, 1270);
  assert.equal(t.discount, 127);
  assert.equal(t.lineTax, 150);
  assert.equal(t.tax, 57.15);
  assert.equal(t.total, 1362.65);
  assert.equal(t.balance, 1312.65);
});

test('rounds half up without float artefacts', () => {
  assert.equal(calc.round(1.005, 2), 1.01);
  assert.equal(calc.round(-2.0005, 3), -2.001);
  assert.equal(calc.toNum('abc'), 0);
});

test('formats numbers with different grouping styles', () => {
  assert.equal(calc.formatNumber(1234567.891, 2, 'dot'), '1.234.567,89');
  assert.equal(calc.formatNumber(-1000, 0, 'space'), '-1 000');
});

test('formats ISO dates and passes through free text', () => {
  assert.equal(calc.formatDate('2026-08-04', 'D MMM YYYY'), '4 Aug 2026');
  assert.equal(calc.formatDate('2026-08-04', 'DD/MM/YYYY'), '04/08/2026');
  assert.equal(calc.formatDate('TBA'), 'TBA');
});

test('spells integers across scales', () => {
  assert.equal(words.integerToWords(0), 'ZERO');
  assert.equal(words.integerToWords(1000001), 'ONE MILLION ONE');
  assert.equal(words.integerToWords(2512), 'TWO THOUSAND FIVE HUNDRED TWELVE');
  assert.throws(() => words.integerToWords(1e15), RangeError);
});

test('omits the minor part for whole amounts and supports casing and templates', () => {
  const usd = { code: 'USD', decimals: 2, major: 'DOLLARS', minor: 'CENTS', country: '' };
  assert.equal(words.amountToWords(100, usd), 'DOLLARS ONE HUNDRED ONLY');
  assert.equal(words.amountToWords(21.05, usd, { template: '{MAJOR_WORDS} {MAJOR_NAME}{MINOR_PART} only', casing: 'title' }),
    'Twenty One Dollars And Five Cents Only');
  assert.equal(words.amountToWords(-1, usd), 'MINUS DOLLARS ONE ONLY');
});
