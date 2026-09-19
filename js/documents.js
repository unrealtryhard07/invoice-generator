/* Document workflow (quotation → proforma → tax invoice, credit notes), containers and exchange rates. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'), require('../vendor/qrcode.js'));
  else { root.NB = root.NB || {}; root.NB.documents = factory(root.NB.calc, root.qrcode); }
})(typeof self !== 'undefined' ? self : this, function (calc, qrcode) {
  'use strict';

  const DOC_TYPES = [
    { id: 'quotation', title: 'QUOTATION', titleAr: 'عرض سعر', label: 'Quotation', next: ['proforma', 'tax'] },
    { id: 'proforma', title: 'PROFORMA INVOICE', titleAr: 'فاتورة مبدئية', label: 'Proforma Invoice', next: ['tax', 'credit'] },
    { id: 'tax', title: 'TAX INVOICE', titleAr: 'فاتورة ضريبية', label: 'Tax Invoice', next: ['credit'] },
    { id: 'commercial', title: 'COMMERCIAL INVOICE', titleAr: 'فاتورة تجارية', label: 'Commercial Invoice', next: ['credit'] },
    { id: 'invoice', title: 'INVOICE', titleAr: 'فاتورة', label: 'Invoice', next: ['credit'] },
    { id: 'credit', title: 'CREDIT NOTE', titleAr: 'إشعار دائن', label: 'Credit Note', next: [] },
    { id: 'debit', title: 'DEBIT NOTE', titleAr: 'إشعار مدين', label: 'Debit Note', next: ['credit'] },
    { id: 'delivery', title: 'DELIVERY NOTE', titleAr: 'إذن تسليم', label: 'Delivery Note', next: [] },
    { id: 'receipt', title: 'RECEIPT', titleAr: 'إيصال استلام', label: 'Receipt', next: [] },
  ];
  const CUSTOM_TYPE = { id: 'custom', label: 'Document', next: ['credit'] };
  const DAY_MS = 86400000;
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  const CONTAINER_SIZES = {
    '20GP': ['20 FT', '٢٠ قدم'], '40GP': ['40 FT', '٤٠ قدم'], '40HC': ['40 FT HIGH CUBE', '٤٠ قدم مرتفعة'], '45HC': ['45 FT HIGH CUBE', '٤٥ قدم مرتفعة'],
    '20RF': ['20 FT REEFER', '٢٠ قدم مبردة'], '40RF': ['40 FT REEFER', '٤٠ قدم مبردة'], '20OT': ['20 FT OPEN TOP', '٢٠ قدم مفتوحة'],
    '40OT': ['40 FT OPEN TOP', '٤٠ قدم مفتوحة'], '20FR': ['20 FT FLAT RACK', '٢٠ قدم مسطحة'], '40FR': ['40 FT FLAT RACK', '٤٠ قدم مسطحة'],
    LCL: ['LCL', 'شحنة جزئية'],
  };

  const titleKey = (title) => String(title || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const typeById = (id) => DOC_TYPES.find((t) => t.id === id);

  /** The workflow type of a document: its stored `docType`, or (for unmigrated data) its exact title. */
  const typeOf = (inv) => (inv.docType
    ? typeById(inv.docType) || CUSTOM_TYPE
    : DOC_TYPES.find((t) => t.title === titleKey(inv.title)) || CUSTOM_TYPE);

  /**
   * Picks a document type for a title once, when older data is migrated. Custom titles keep the meaning
   * the old title-matching rules gave them, so existing totals do not change.
   */
  function inferDocType(title, titleAr = '') {
    const exact = DOC_TYPES.find((t) => t.title === titleKey(title));
    if (exact) return exact.id;
    const text = `${title || ''} ${titleAr || ''}`;
    if (/CREDIT NOTE|إشعار دائن/i.test(text)) return 'credit';
    if (/QUOTATION|QUOTE|عرض سعر/i.test(text)) return 'quotation';
    if (/DELIVERY NOTE|إذن تسليم/i.test(text)) return 'delivery';
    if (/STATEMENT|كشف حساب/i.test(text)) return 'statement';
    return 'custom';
  }

  const omit = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
  const LINK_KEYS = ['supersededBy', 'supersededByNumber', 'convertedFrom', 'convertedFromNumber', 'creditFor', 'creditForNumber'];
  const isoDay = (iso) => Date.parse(`${iso}T00:00:00Z`);
  const addDays = (iso, days) => new Date(isoDay(iso) + days * DAY_MS).toISOString().slice(0, 10);

  // The new document keeps the same payment terms: due date moves with the new issue date.
  function shiftedMeta(meta, today) {
    const issued = (meta.find((f) => f.key === 'invoiceDate') || {}).value;
    const due = (meta.find((f) => f.key === 'dueDate') || {}).value;
    const termDays = ISO_DATE.test(issued) && ISO_DATE.test(due) ? Math.round((isoDay(due) - isoDay(issued)) / DAY_MS) : null;
    return meta.map((f) => {
      if (f.key === 'invoiceDate') return { ...f, value: today };
      if (f.key === 'dueDate') return { ...f, value: termDays === null ? '' : addDays(today, Math.max(termDays, 0)) };
      return f;
    });
  }

  // When part of an invoice is already settled, the credit note is a single line for what is still owed.
  function creditLines(source, openBalance) {
    const d = calc.toNum(source.currency.decimals);
    const balance = calc.round(openBalance, d);
    if (balance <= 0) throw new Error(`${source.number || 'This invoice'} is already settled — there is nothing left to credit.`);
    if (balance >= calc.computeTotals(source).total) return {};
    const item = (source.items || [])[0] || {};
    return {
      items: [{ ...item, id: `${item.id || 'line'}-credit`, desc: `Credit against ${source.number} — outstanding balance`, descAr: `إشعار دائن عن الفاتورة ${source.number} — الرصيد المستحق`, uom: '', qty: 1, price: balance, cost: 0, discount: 0, tax: 0 }],
      totals: { ...source.totals, discountValue: 0, taxRate: 0, charges: [], paid: 0 },
    };
  }

  /**
   * Creates the next document in the workflow. Returns updated source and the new target document.
   * `openBalance` (credit notes only) is what the customer still owes after payments and earlier credits.
   */
  function convert(source, targetId, { id, number, today, openBalance }) {
    const target = typeById(targetId);
    if (!target) throw new Error(`Unknown document type: ${targetId}`);
    if (!typeOf(source).next.includes(targetId)) throw new Error(`A ${typeOf(source).label} cannot become a ${target.label}.`);
    const now = new Date().toISOString();
    const base = {
      ...omit(structuredClone(source), [...LINK_KEYS, 'updatedAt']),
      id, number, docType: target.id, title: target.title, titleAr: target.titleAr, status: 'draft', createdAt: now, updatedAt: now,
      meta: shiftedMeta(source.meta || [], today),
    };

    if (targetId === 'credit') {
      const reference = { label: 'Original Invoice', labelAr: 'الفاتورة الأصلية', value: source.number };
      const owed = openBalance === undefined ? calc.computeTotals(source).balance : openBalance;
      return {
        source,
        target: {
          ...base, ...creditLines(source, owed), creditFor: source.id, creditForNumber: source.number, payments: [],
          meta: [...base.meta.filter((f) => f.key !== 'dueDate' && f.label !== reference.label), reference],
        },
      };
    }
    return {
      source: { ...source, supersededBy: id, supersededByNumber: number, payments: [] },
      target: { ...base, convertedFrom: source.id, convertedFromNumber: source.number, payments: source.payments || [] },
    };
  }

  /**
   * Why a document may not be deleted ('' when it may). Deleting a converted copy would strand its original
   * as "Converted" and lose the payments that moved across; deleting an invoice would orphan its credit notes.
   */
  function deleteBlocker(inv, all) {
    const live = (x) => x && x.id !== inv.id && x.status !== 'cancelled';
    const source = inv.convertedFrom && all.find((x) => x.id === inv.convertedFrom && x.supersededBy === inv.id);
    if (live(source)) {
      return `${inv.number} was created from ${source.number}. Deleting it would leave ${source.number} stuck as Converted. Set its status to Cancelled instead.`;
    }
    const credits = all.filter((x) => live(x) && x.creditFor === inv.id);
    if (credits.length) {
      return `${inv.number} has credit note ${credits.map((c) => c.number).join(', ')}. Cancel or delete the credit note first.`;
    }
    return '';
  }

  /* ---------- containers (ISO 6346) ---------- */
  const LETTER_VALUES = (() => {
    const values = {};
    let v = 10;
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((letter) => {
      if (v % 11 === 0) v += 1;
      values[letter] = v;
      v += 1;
    });
    return values;
  })();

  function checkContainer(number) {
    const code = String(number || '').toUpperCase().replace(/[\s-]/g, '');
    if (!code) return 'empty';
    if (!/^[A-Z]{3}[UJZR]\d{7}$/.test(code)) return 'format';
    const sum = code.slice(0, 10).split('').reduce((acc, ch, i) => acc + (LETTER_VALUES[ch] ?? Number(ch)) * 2 ** i, 0);
    return (sum % 11) % 10 === Number(code[10]) ? 'ok' : 'check-digit';
  }

  function containerSummary(containers) {
    const list = (containers || []).filter((c) => c.number || c.size);
    const counts = new Map();
    list.forEach((c) => counts.set(c.size, (counts.get(c.size) || 0) + 1));
    const label = (size, lang) => (CONTAINER_SIZES[size] ? CONTAINER_SIZES[size][lang] : size || '');
    const quantity = (lang) => [...counts.entries()].map(([size, n]) => `${n} X ${label(size, lang)}`).join(', ');
    return {
      count: list.length,
      quantity: quantity(0),
      quantityAr: quantity(1),
      weight: calc.round(list.reduce((a, c) => a + calc.toNum(c.weight), 0), 3),
      volume: calc.round(list.reduce((a, c) => a + calc.toNum(c.volume), 0), 3),
      packages: list.reduce((a, c) => a + calc.toNum(c.packages), 0),
      numbers: list.map((c) => [c.number, c.seal].filter(Boolean).join(' / ')).filter(Boolean).join(', '),
    };
  }

  /* ---------- exchange rate ---------- */
  function equivalent(inv) {
    const fx = inv.fx || {};
    const rate = calc.toNum(fx.rate);
    if (!fx.enabled || !fx.base || fx.base === inv.currency.code || rate <= 0) return null;
    const decimals = calc.toNum(fx.baseDecimals ?? 3);
    const { total, balance } = calc.computeTotals(inv);
    return { base: fx.base, rate, decimals, total: calc.round(total * rate, decimals), balance: calc.round(balance * rate, decimals) };
  }

  /* ---------- QR code ---------- */
  const QR_QUIET_ZONE = 4;
  const fieldValue = (list, label) => ((list || []).find((f) => f.label === label) || {}).value || '';
  const issueDate = (inv) => ((inv.meta || []).find((f) => f.key === 'invoiceDate') || {}).value || '';

  /** Text encoded in the invoice QR code: an invoice summary, bank transfer details, or custom text with tokens. */
  function qrPayload(inv) {
    const qr = inv.qr || {};
    const d = calc.toNum(inv.currency.decimals);
    const { total, balance } = calc.computeTotals(inv);
    const amount = `${calc.formatNumber(balance, d)} ${inv.currency.code}`;
    const lines = (pairs) => pairs.filter(([, v]) => String(v).trim()).map(([k, v]) => `${k}: ${v}`).join('\n');
    if (qr.mode === 'bank') {
      return lines([['Beneficiary', fieldValue(inv.bank, 'Account Name') || inv.company.name], ['Bank', fieldValue(inv.bank, 'Bank Name')],
        ['IBAN', fieldValue(inv.bank, 'IBAN')], ['Account', fieldValue(inv.bank, 'Account No.')], ['SWIFT', fieldValue(inv.bank, 'SWIFT / BIC')],
        ['Amount', amount], ['Reference', inv.number]]);
    }
    if (qr.mode === 'custom') {
      const tokens = {
        '{NUMBER}': inv.number, '{DATE}': issueDate(inv), '{CUSTOMER}': inv.customer.name, '{CURRENCY}': inv.currency.code,
        '{TOTAL}': calc.formatNumber(total, d), '{BALANCE}': calc.formatNumber(balance, d), '{COMPANY}': inv.company.name,
      };
      return String(qr.text || '').replace(/\{[A-Z]+\}/g, (t) => (t in tokens ? tokens[t] : t)).trim();
    }
    return lines([['Seller', inv.company.name], ['Document', `${inv.title} ${inv.number}`], ['Date', issueDate(inv)],
      ['Customer', inv.customer.name], ['Total', `${calc.formatNumber(total, d)} ${inv.currency.code}`], ['Amount due', amount]]);
  }

  /** Renders text as a crisp SVG QR code (UTF-8, error correction M). Throws RangeError if the text is too long. */
  function qrSvg(text) {
    if (!qrcode) throw new Error('QR library not loaded');
    if (!String(text).trim()) throw new RangeError('Nothing to encode');
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    const qr = qrcode(0, 'M');
    try {
      qr.addData(String(text), 'Byte');
      qr.make();
    } catch {
      throw new RangeError('Too much text for a QR code');
    }
    const n = qr.getModuleCount();
    const size = n + QR_QUIET_ZONE * 2;
    let d = '';
    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) {
        if (qr.isDark(r, c)) d += `M${c + QR_QUIET_ZONE},${r + QR_QUIET_ZONE}h1v1h-1z`;
      }
    }
    return `<svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`;
  }

  return { DOC_TYPES, CONTAINER_SIZES, typeOf, inferDocType, convert, deleteBlocker, checkContainer, containerSummary, equivalent, qrPayload, qrSvg };
});
