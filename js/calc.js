/* Money math, number and date formatting. Works in the browser (NB.calc) and Node (tests). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.NB = root.NB || {}; root.NB.calc = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const GROUP_SEPARATORS = { comma: [',', '.'], space: [' ', '.'], dot: ['.', ','], none: ['', '.'] };

  function toNum(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const n = parseFloat(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  // Decimal-safe rounding (avoids 1.005 -> 1.00 float artefacts).
  function round(value, decimals) {
    const n = toNum(value);
    const shifted = Math.round(Number(`${Math.abs(n)}e${decimals}`));
    const result = Number.isFinite(shifted) ? Number(`${shifted}e-${decimals}`) : Math.round(Math.abs(n) * 10 ** decimals) / 10 ** decimals;
    return n < 0 ? -result : result;
  }

  const sum = (list, pick) => list.reduce((acc, x) => acc + pick(x), 0);
  const percent = (v) => Math.min(Math.max(toNum(v), 0), 100);

  function lineAmounts(item, decimals) {
    const gross = round(toNum(item.qty) * toNum(item.price), decimals);
    const discount = round(gross * percent(item.discount) / 100, decimals);
    const net = round(gross - discount, decimals);
    const tax = round(net * percent(item.tax) / 100, decimals);
    return { gross, discount, net, tax, total: round(net + tax, decimals) };
  }

  function computeTotals(invoice) {
    const d = toNum(invoice.currency.decimals);
    const t = invoice.totals;
    const lines = invoice.items.map((item) => lineAmounts(item, d));
    const subtotal = round(sum(lines, (l) => l.net), d);
    const lineTax = round(sum(lines, (l) => l.tax), d);
    // A fixed discount can never exceed the subtotal (that would print a negative total).
    const discount = t.discountType === 'percent'
      ? round(subtotal * percent(t.discountValue) / 100, d)
      : round(Math.min(Math.max(toNum(t.discountValue), 0), Math.max(subtotal, 0)), d);
    const tax = round((subtotal - discount) * percent(t.taxRate) / 100, d);
    const charges = (t.charges || []).map((c) => ({ label: c.label, amount: round(c.amount, d) }));
    const total = round(subtotal - discount + lineTax + tax + sum(charges, (c) => c.amount), d);
    const paid = round(sum(invoice.payments || [], (p) => toNum(p.amount)) + toNum(t.paid), d);
    return { lines, subtotal, discount, lineTax, tax, charges, total, paid, balance: round(total - paid, d) };
  }

  function formatNumber(value, decimals, grouping = 'comma') {
    const [groupSep, decimalSep] = GROUP_SEPARATORS[grouping] || GROUP_SEPARATORS.comma;
    const n = round(value, decimals);
    const [int, frac] = Math.abs(n).toFixed(decimals).split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, groupSep);
    return `${n < 0 ? '-' : ''}${grouped}${frac ? decimalSep + frac : ''}`;
  }

  function parseIsoDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
  }

  function formatDate(iso, format = 'D MMM YYYY') {
    const p = parseIsoDate(iso);
    if (!p) return String(iso || '');
    const pad = (x) => String(x).padStart(2, '0');
    const tokens = {
      YYYY: String(p.y), MMMM: MONTHS[p.mo - 1], MMM: MONTHS[p.mo - 1].slice(0, 3),
      MM: pad(p.mo), DD: pad(p.d), D: String(p.d),
    };
    return format.replace(/YYYY|MMMM|MMM|MM|DD|D/g, (tok) => tokens[tok]);
  }

  // Internal margin: revenue is net of discounts, excluding tax and pass-through charges.
  function profit(invoice) {
    const d = toNum(invoice.currency.decimals);
    const t = computeTotals(invoice);
    const revenue = round(t.subtotal - t.discount, d);
    const cost = round(sum(invoice.items, (i) => toNum(i.qty) * toNum(i.cost)), d);
    return {
      revenue, cost, profit: round(revenue - cost, d),
      margin: revenue ? round(((revenue - cost) / revenue) * 100, 1) : 0,
      hasCost: invoice.items.some((i) => toNum(i.cost) > 0),
    };
  }

  /**
   * Reads a pasted amount written with either decimal convention: "717,5" → 717.5, "1,000" → 1000,
   * "1.234,5" → 1234.5. A lone comma followed by exactly three digits is read as a thousands separator.
   */
  function parseAmount(text) {
    const s = String(text ?? '').replace(/[^\d.,-]/g, '');
    if (!/\d/.test(s)) return 0;
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    let normal;
    if (lastDot >= 0 && lastComma >= 0) {
      const decimalSep = lastDot > lastComma ? '.' : ',';
      const groupSep = decimalSep === '.' ? ',' : '.';
      normal = s.split(groupSep).join('').replace(decimalSep, '.');
    } else if (lastComma >= 0) {
      const commas = s.split(',').length - 1;
      normal = commas === 1 && s.length - lastComma - 1 !== 3 ? s.replace(',', '.') : s.replace(/,/g, '');
    } else {
      normal = (s.split('.').length - 1) > 1 ? s.replace(/\./g, '') : s;
    }
    const n = parseFloat(normal);
    return Number.isFinite(n) ? n : 0;
  }

  const BULK_SEPARATORS = ['\t', '|', ';'];
  const looksNumeric = (part) => /\d/.test(part) && !/\p{L}/u.test(part);

  /** Splits pasted rows ("Description | Qty | Price", tab- or ;-separated) into line items. */
  function parseBulkLines(text) {
    return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const sep = BULK_SEPARATORS.find((x) => line.includes(x));
      if (!sep) return { desc: line, qty: 1, price: 0 };
      const parts = line.split(sep).map((x) => x.trim());
      let numeric = 0;
      while (numeric < 2 && parts.length - numeric > 1 && looksNumeric(parts[parts.length - 1 - numeric])) numeric += 1;
      const numbers = parts.slice(parts.length - numeric);
      const joiner = sep === '\t' ? ' ' : ` ${sep} `.replace(' ; ', '; ');
      return {
        desc: parts.slice(0, parts.length - numeric).join(joiner),
        qty: numbers.length ? parseAmount(numbers[0]) : 1,
        price: numbers.length > 1 ? parseAmount(numbers[1]) : 0,
      };
    });
  }

  return { toNum, round, lineAmounts, computeTotals, profit, formatNumber, formatDate, parseAmount, parseBulkLines };
});
