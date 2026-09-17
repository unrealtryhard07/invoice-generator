const test = require('node:test');
const assert = require('node:assert/strict');
const documents = require('../js/documents.js');
const ledger = require('../js/ledger.js');
const calc = require('../js/calc.js');

const TODAY = '2026-09-17';
const KWD = { code: 'KWD', decimals: 3 };
const makeDoc = (overrides = {}) => ({
  id: 'q1', number: 'NB-1', title: 'QUOTATION', status: 'sent', customer: { name: 'Cura' }, currency: KWD,
  meta: [{ key: 'invoiceDate', value: '2026-08-01' }, { key: 'dueDate', value: '2026-08-31' }],
  totals: { discountType: 'amount', discountValue: 0, taxRate: 0, charges: [], paid: 0 },
  items: [{ qty: 2, price: 500, cost: 300 }], payments: [],
  ...overrides,
});

test('validates container numbers with the ISO 6346 check digit', () => {
  assert.equal(documents.checkContainer('CSQU3054383'), 'ok');
  assert.equal(documents.checkContainer('CSQU3054384'), 'check-digit');
  assert.equal(documents.checkContainer('csqu 305438-3'), 'ok');
  assert.equal(documents.checkContainer('ABC123'), 'format');
  assert.equal(documents.checkContainer(''), 'empty');
});

test('summarises containers into quantity text and totals', () => {
  const s = documents.containerSummary([
    { number: 'SEGU9668258', seal: 'A239100', size: '40HC', weight: 8633.5, volume: 48, packages: 10 },
    { number: 'TRIU8911264', seal: 'A239002', size: '40HC', weight: '8633.5', volume: 48, packages: 12 },
    { number: 'MSCU1234565', size: '20GP', weight: 0 },
  ]);
  assert.equal(s.quantity, '2 X 40 FT HIGH CUBE, 1 X 20 FT');
  assert.equal(s.weight, 17267);
  assert.equal(s.volume, 96);
  assert.equal(s.packages, 22);
  assert.equal(s.numbers, 'SEGU9668258 / A239100, TRIU8911264 / A239002, MSCU1234565');
});

test('converts a quotation to a proforma and moves payments along the chain', () => {
  const quote = makeDoc();
  const step1 = documents.convert(quote, 'proforma', { id: 'p1', number: 'NB-2', today: TODAY });
  assert.equal(step1.source.supersededBy, 'p1');
  assert.equal(step1.target.title, 'PROFORMA INVOICE');
  assert.equal(step1.target.titleAr, 'فاتورة مبدئية');
  assert.equal(step1.target.convertedFrom, 'q1');
  assert.equal(step1.target.status, 'draft');
  assert.equal(step1.target.meta[0].value, TODAY);

  const paid = { ...step1.target, status: 'sent', payments: [{ amount: 400 }] };
  const step2 = documents.convert(paid, 'tax', { id: 't1', number: 'NB-3', today: TODAY });
  assert.deepEqual(step2.source.payments, []);
  assert.equal(step2.target.payments[0].amount, 400);
  assert.equal(step2.target.convertedFrom, 'p1');
  assert.equal(ledger.status(step2.source, TODAY), 'converted');
  assert.throws(() => documents.convert(step2.target, 'proforma', { id: 'x', number: 'x', today: TODAY }));
});

test('credit notes settle their original invoice without double counting', () => {
  const invoice = makeDoc({ id: 'i1', title: 'TAX INVOICE' });
  const { target } = documents.convert(invoice, 'credit', { id: 'c1', number: 'CN-1', today: TODAY });
  const credit = { ...target, status: 'sent', items: [{ qty: 1, price: 250 }] };
  assert.equal(credit.creditFor, 'i1');
  assert.equal(credit.meta.at(-1).value, 'NB-1');

  const prepared = ledger.prepare([invoice, credit]);
  const inv = prepared.find((d) => d.id === 'i1');
  assert.equal(calc.computeTotals(inv).balance, 750);
  assert.equal(ledger.status(prepared.find((d) => d.id === 'c1'), TODAY), 'credit');

  const st = ledger.statement(prepared, 'cura', { currency: 'KWD', today: TODAY });
  assert.equal(st.closing, 750);
  assert.equal(st.rows.length, 2);
});

test('computes the exchange-rate equivalent and internal profit', () => {
  const usd = makeDoc({ title: 'TAX INVOICE', currency: { code: 'USD', decimals: 2 }, fx: { enabled: true, base: 'KWD', baseDecimals: 3, rate: 0.3075 } });
  assert.deepEqual(documents.equivalent(usd), { base: 'KWD', rate: 0.3075, decimals: 3, total: 307.5, balance: 307.5 });
  assert.equal(documents.equivalent({ ...usd, fx: { ...usd.fx, enabled: false } }), null);
  assert.deepEqual(calc.profit(usd), { revenue: 1000, cost: 600, profit: 400, margin: 40, hasCost: true });
});

test('dashboard converts to base currency, buckets ageing and ranks customers', () => {
  const docs = [
    makeDoc({ id: 'a', title: 'TAX INVOICE', payments: [{ date: '2026-09-02', amount: 200 }] }),
    makeDoc({ id: 'b', title: 'TAX INVOICE', customer: { name: 'Gulf Co' }, currency: { code: 'USD', decimals: 2 }, fx: { base: 'KWD', rate: 0.3 },
      meta: [{ key: 'invoiceDate', value: '2026-09-10' }, { key: 'dueDate', value: '2026-10-10' }] }),
    makeDoc({ id: 'c', title: 'TAX INVOICE', currency: { code: 'EUR', decimals: 2 } }),
    makeDoc({ id: 'd', title: 'QUOTATION' }),
  ];
  const dash = ledger.dashboard(docs, { today: TODAY, base: 'KWD', from: '2026-01-01' });
  assert.equal(dash.count, 2);
  assert.equal(dash.unconverted, 1);
  assert.equal(dash.kpis.invoiced, 1300);
  assert.equal(dash.kpis.collected, 200);
  assert.equal(dash.kpis.outstanding, 1100);
  assert.equal(dash.kpis.overdue, 800);
  assert.equal(dash.ageing['1-30'], 800);
  assert.equal(dash.ageing.current, 300);
  assert.equal(dash.kpis.profit, 520);
  assert.equal(dash.monthly.length, 12);
  assert.equal(dash.monthly.at(-1).month, '2026-09');
  assert.equal(dash.monthly.at(-1).collected, 200);
  assert.equal(dash.topCustomers[0].name, 'Cura');
});

test('builds QR payloads for summary, bank and custom modes', () => {
  const inv = makeDoc({
    title: 'TAX INVOICE', number: 'NB-9', company: { name: 'Nayef Bashar Trading Est.' }, payments: [{ amount: 250 }],
    bank: [{ label: 'Bank Name', value: 'NBK' }, { label: 'IBAN', value: 'KW81CBKU0000000000001234560101' }, { label: 'Account Name', value: '' }],
  });
  assert.equal(documents.qrPayload({ ...inv, qr: { mode: 'summary' } }),
    'Seller: Nayef Bashar Trading Est.\nDocument: TAX INVOICE NB-9\nDate: 2026-08-01\nCustomer: Cura\nTotal: 1,000.000 KWD\nAmount due: 750.000 KWD');
  assert.equal(documents.qrPayload({ ...inv, qr: { mode: 'bank' } }),
    'Beneficiary: Nayef Bashar Trading Est.\nBank: NBK\nIBAN: KW81CBKU0000000000001234560101\nAmount: 750.000 KWD\nReference: NB-9');
  assert.equal(documents.qrPayload({ ...inv, qr: { mode: 'custom', text: 'https://pay.example.com/?ref={NUMBER}&amt={BALANCE} {UNKNOWN}' } }),
    'https://pay.example.com/?ref=NB-9&amt=750.000 {UNKNOWN}');
});

test('renders QR codes as SVG and rejects empty or oversized text', () => {
  const svg = documents.qrSvg('NB-9 · فاتورة');
  assert.match(svg, /^<svg viewBox="0 0 (\d+) \1"/);
  assert.match(svg, /<path fill="#000" d="M\d/);
  assert.throws(() => documents.qrSvg('  '), RangeError);
  assert.throws(() => documents.qrSvg('x'.repeat(3000)), RangeError);
});
