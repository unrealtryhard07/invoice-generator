/* Receivables: payment status, overdue days, customer balances and statements of account. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else { root.NB = root.NB || {}; root.NB.ledger = factory(root.NB.calc); }
})(typeof self !== 'undefined' ? self : this, function (calc) {
  'use strict';

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const DAY_MS = 86400000;
  const AGEING_BUCKETS = ['current', '1-30', '31-60', '60+'];
  const ENTRY_ORDER = { invoice: 0, 'credit-note': 1, payment: 2 };

  const metaDate = (inv, key) => {
    const field = (inv.meta || []).find((f) => f.key === key);
    return field && ISO_DATE.test(field.value) ? field.value : '';
  };
  const invoiceDate = (inv) => metaDate(inv, 'invoiceDate') || String(inv.createdAt || '').slice(0, 10);
  const dueDate = (inv) => metaDate(inv, 'dueDate');
  const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
  const customerKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const decimalsOf = (inv) => calc.toNum(inv.currency && inv.currency.decimals);

  function documentKind(inv) {
    const title = `${inv.title || ''} ${inv.titleAr || ''}`;
    if (/QUOTATION|QUOTE|DELIVERY NOTE|STATEMENT|عرض سعر|إذن تسليم|كشف حساب/i.test(title)) return 'quote';
    if (/CREDIT NOTE|إشعار دائن/i.test(title)) return 'credit';
    return 'invoice';
  }

  function status(inv, today) {
    if (inv.status === 'cancelled') return 'cancelled';
    if (inv.supersededBy) return 'converted';
    if (documentKind(inv) === 'credit') return inv.status === 'draft' ? 'draft' : 'credit';
    const t = calc.computeTotals(inv);
    if (t.paid > 0 && t.balance <= 0) return 'paid';
    if (inv.status === 'draft' && t.paid <= 0) return 'draft';
    if (documentKind(inv) === 'quote') return 'issued';
    const due = dueDate(inv);
    if (due && t.balance > 0 && daysBetween(due, today) > 0) return 'overdue';
    if (t.paid > 0) return 'partial';
    return 'unpaid';
  }

  function overdueDays(inv, today) {
    const due = dueDate(inv);
    return due ? Math.max(0, daysBetween(due, today)) : 0;
  }

  // Issued invoices and credit notes that count towards receivables totals, named customer or not.
  const countsInTotals = (inv, today) => !['draft', 'cancelled', 'converted'].includes(status(inv, today))
    && !inv.appliedTo && documentKind(inv) !== 'quote';
  // Statements and customer balances also need a customer name to group by.
  const isLedgerEntry = (inv, today) => countsInTotals(inv, today) && Boolean(customerKey(inv.customer && inv.customer.name));

  // Linked credit notes settle their original invoice: add them as virtual payments, and take the
  // credit note itself out of the ledger so it is not counted twice. Never persist the result.
  function prepare(invoices) {
    const ids = new Set(invoices.map((inv) => inv.id));
    const credits = new Map();
    invoices.forEach((inv) => {
      if (!inv.creditFor || !ids.has(inv.creditFor) || ['draft', 'cancelled'].includes(inv.status)) return;
      const payment = { id: `credit-${inv.id}`, date: invoiceDate(inv), amount: calc.computeTotals(inv).total, method: 'Credit note', reference: inv.number, virtual: true };
      credits.set(inv.creditFor, [...(credits.get(inv.creditFor) || []), payment]);
    });
    return invoices.map((inv) => {
      if (inv.creditFor && ids.has(inv.creditFor) && !['draft', 'cancelled'].includes(inv.status)) return { ...inv, appliedTo: inv.creditFor };
      return credits.has(inv.id) ? { ...inv, payments: [...(inv.payments || []), ...credits.get(inv.id)] } : inv;
    });
  }

  function monthKeys(today, count) {
    const [y, m] = today.split('-').map(Number);
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1));
      return d.toISOString().slice(0, 7);
    });
  }

  // Aggregates for the dashboard, converted to the base currency. Documents in another currency
  // without an exchange rate to the base are counted in `unconverted` and left out of the sums.
  function dashboard(invoices, { today, base, baseDecimals = 3, from = '', months = 12 }) {
    const d = baseDecimals;
    const keys = monthKeys(today, months);
    const monthly = new Map(keys.map((k) => [k, { month: k, invoiced: 0, collected: 0 }]));
    const kpis = { invoiced: 0, collected: 0, outstanding: 0, overdue: 0, revenue: 0, cost: 0, profit: 0 };
    const ageing = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0]));
    const people = new Map();
    let unconverted = 0;
    let count = 0;
    const inPeriod = (date) => (!from || date >= from) && date <= today;

    invoices.filter((inv) => countsInTotals(inv, today)).forEach((inv) => {
      const rate = inv.currency.code === base ? 1 : (inv.fx && inv.fx.base === base ? calc.toNum(inv.fx.rate) : 0);
      if (!rate) {
        unconverted += 1;
        return;
      }
      count += 1;
      const toBase = (n) => n * rate;
      const t = calc.computeTotals(inv);
      const sign = documentKind(inv) === 'credit' ? -1 : 1;
      const date = invoiceDate(inv);
      const month = monthly.get(date.slice(0, 7));
      if (month) month.invoiced += sign * toBase(t.total);
      if (inPeriod(date)) kpis.invoiced += sign * toBase(t.total);
      (inv.payments || []).filter((p) => !p.virtual).forEach((p) => {
        const paidOn = ISO_DATE.test(p.date) ? p.date : date;
        const pm = monthly.get(paidOn.slice(0, 7));
        if (pm) pm.collected += toBase(calc.toNum(p.amount));
        if (inPeriod(paidOn)) kpis.collected += toBase(calc.toNum(p.amount));
      });

      const key = customerKey(inv.customer && inv.customer.name);
      const person = people.get(key) || { key, name: key ? inv.customer.name.trim() : '', invoiced: 0, outstanding: 0 };
      if (inPeriod(date)) person.invoiced += sign * toBase(t.total);

      if (sign > 0 && t.balance > 0) {
        const balance = toBase(t.balance);
        kpis.outstanding += balance;
        person.outstanding += balance;
        if (status(inv, today) === 'overdue') kpis.overdue += balance;
        const bucket = ageingBucket(daysBetween(dueDate(inv) || date, today));
        ageing[bucket] += balance;
      }
      if (sign > 0 && inPeriod(date)) {
        const p = calc.profit(inv);
        if (p.hasCost) {
          kpis.revenue += toBase(p.revenue);
          kpis.cost += toBase(p.cost);
        }
      }
      if (key) people.set(key, person);
    });

    const r = (n) => calc.round(n, d);
    kpis.profit = kpis.revenue - kpis.cost;
    return {
      base, count, unconverted,
      kpis: { ...Object.fromEntries(Object.entries(kpis).map(([k, v]) => [k, r(v)])), margin: kpis.revenue ? calc.round((kpis.profit / kpis.revenue) * 100, 1) : 0 },
      monthly: [...monthly.values()].map((m) => ({ ...m, invoiced: r(m.invoiced), collected: r(m.collected) })),
      ageing: Object.fromEntries(Object.entries(ageing).map(([k, v]) => [k, r(v)])),
      topCustomers: [...people.values()].map((p) => ({ ...p, invoiced: r(p.invoiced), outstanding: r(p.outstanding) }))
        .filter((p) => p.invoiced || p.outstanding).sort((a, b) => b.invoiced - a.invoiced || b.outstanding - a.outstanding).slice(0, 6),
    };
  }

  function ageingBucket(days) {
    if (days <= 0) return 'current';
    if (days <= 30) return '1-30';
    if (days <= 60) return '31-60';
    return '60+';
  }

  function customers(invoices, today) {
    const map = new Map();
    invoices.filter((inv) => isLedgerEntry(inv, today)).forEach((inv) => {
      const key = customerKey(inv.customer.name);
      const code = inv.currency.code;
      const d = decimalsOf(inv);
      const t = calc.computeTotals(inv);
      const sign = documentKind(inv) === 'credit' ? -1 : 1;
      const entry = map.get(key) || { key, name: inv.customer.name.trim(), nameAr: inv.customer.nameAr || '', count: 0, overdueCount: 0, lastDate: '', byCurrency: {} };
      const cur = entry.byCurrency[code] || { code, decimals: d, invoiced: 0, paid: 0, balance: 0, overdue: 0 };
      const isOverdue = status(inv, today) === 'overdue';
      map.set(key, {
        ...entry,
        count: entry.count + 1,
        overdueCount: entry.overdueCount + (isOverdue ? 1 : 0),
        lastDate: invoiceDate(inv) > entry.lastDate ? invoiceDate(inv) : entry.lastDate,
        byCurrency: {
          ...entry.byCurrency,
          [code]: {
            ...cur,
            invoiced: calc.round(cur.invoiced + sign * t.total, d),
            paid: calc.round(cur.paid + t.paid, d),
            balance: calc.round(cur.balance + sign * t.total - t.paid, d),
            overdue: calc.round(cur.overdue + (isOverdue ? t.balance : 0), d),
          },
        },
      });
    });
    return [...map.values()]
      .map((c) => {
        const currencies = Object.values(c.byCurrency).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance) || b.invoiced - a.invoiced);
        return { ...c, primary: currencies[0] };
      })
      .sort((a, b) => b.overdueCount - a.overdueCount || a.name.localeCompare(b.name));
  }

  function entriesFor(inv) {
    const t = calc.computeTotals(inv);
    const date = invoiceDate(inv);
    const credit = documentKind(inv) === 'credit';
    const doc = {
      date, type: credit ? 'credit-note' : 'invoice', ref: inv.number, description: inv.title, invoiceId: inv.id,
      debit: credit ? 0 : t.total, credit: credit ? t.total : 0,
    };
    const payments = (inv.payments || []).filter((p) => calc.toNum(p.amount)).map((p) => ({
      date: ISO_DATE.test(p.date) ? p.date : date, type: 'payment', ref: p.reference || inv.number,
      description: `Payment${p.method ? ` · ${p.method}` : ''} — ${inv.number}`, invoiceId: inv.id,
      debit: 0, credit: calc.toNum(p.amount),
    }));
    const legacyAdvance = calc.toNum(inv.totals && inv.totals.paid)
      ? [{ date, type: 'payment', ref: inv.number, description: `Advance — ${inv.number}`, invoiceId: inv.id, debit: 0, credit: calc.toNum(inv.totals.paid) }]
      : [];
    return [doc, ...payments, ...legacyAdvance];
  }

  function statement(invoices, key, { currency, from = '', to = '', today }) {
    const docs = invoices.filter((inv) => isLedgerEntry(inv, today) && customerKey(inv.customer.name) === key && inv.currency.code === currency);
    const d = docs.length ? decimalsOf(docs[0]) : 3;
    const all = docs.flatMap(entriesFor)
      .sort((a, b) => a.date.localeCompare(b.date) || ENTRY_ORDER[a.type] - ENTRY_ORDER[b.type]);
    const inRange = (e) => (!from || e.date >= from) && (!to || e.date <= to);
    const opening = calc.round(all.filter((e) => from && e.date < from).reduce((acc, e) => acc + e.debit - e.credit, 0), d);

    let running = opening;
    const rows = all.filter(inRange).map((e) => {
      running = calc.round(running + e.debit - e.credit, d);
      return { ...e, balance: running };
    });

    const ageing = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0]));
    docs.filter((inv) => documentKind(inv) === 'invoice').forEach((inv) => {
      const t = calc.computeTotals(inv);
      if (t.balance <= 0) return;
      const reference = dueDate(inv) || invoiceDate(inv);
      const bucket = ageingBucket(daysBetween(reference, today));
      ageing[bucket] = calc.round(ageing[bucket] + t.balance, d);
    });

    return {
      currency, decimals: d, from, to, opening, rows, ageing,
      totalDebit: calc.round(rows.reduce((acc, r) => acc + r.debit, 0), d),
      totalCredit: calc.round(rows.reduce((acc, r) => acc + r.credit, 0), d),
      closing: rows.length ? rows[rows.length - 1].balance : opening,
    };
  }

  return {
    AGEING_BUCKETS, invoiceDate, dueDate, daysBetween, customerKey, documentKind, status, overdueDays,
    countsInTotals, isLedgerEntry, ageingBucket, customers, statement, prepare, dashboard,
  };
});
