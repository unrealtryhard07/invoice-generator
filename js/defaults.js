/* Default brand, presets and invoice factories. */
(function (NB) {
  'use strict';

  const CURRENCIES = {
    KWD: { code: 'KWD', decimals: 3, major: 'DINARS', minor: 'FILS', country: 'KUWAIT' },
    SAR: { code: 'SAR', decimals: 2, major: 'RIYALS', minor: 'HALALAS', country: 'SAUDI ARABIA' },
    AED: { code: 'AED', decimals: 2, major: 'DIRHAMS', minor: 'FILS', country: 'UAE' },
    QAR: { code: 'QAR', decimals: 2, major: 'RIYALS', minor: 'DIRHAMS', country: 'QATAR' },
    BHD: { code: 'BHD', decimals: 3, major: 'DINARS', minor: 'FILS', country: 'BAHRAIN' },
    OMR: { code: 'OMR', decimals: 3, major: 'RIALS', minor: 'BAISA', country: 'OMAN' },
    USD: { code: 'USD', decimals: 2, major: 'US DOLLARS', minor: 'CENTS', country: '' },
    EUR: { code: 'EUR', decimals: 2, major: 'EUROS', minor: 'CENTS', country: '' },
    GBP: { code: 'GBP', decimals: 2, major: 'POUNDS', minor: 'PENCE', country: '' },
    INR: { code: 'INR', decimals: 2, major: 'RUPEES', minor: 'PAISE', country: 'INDIA' },
    PKR: { code: 'PKR', decimals: 2, major: 'RUPEES', minor: 'PAISA', country: 'PAKISTAN' },
    CNY: { code: 'CNY', decimals: 2, major: 'YUAN', minor: 'FEN', country: 'CHINA' },
  };

  const DOC_TITLES = ['PROFORMA INVOICE', 'TAX INVOICE', 'COMMERCIAL INVOICE', 'INVOICE', 'QUOTATION',
    'CREDIT NOTE', 'DEBIT NOTE', 'DELIVERY NOTE', 'RECEIPT', 'STATEMENT OF ACCOUNT'];

  const THEME_PRESETS = {
    'Navy & Gold': { primary: '#1E3160', accent: '#C39A48', text: '#1A1D24', headFill: '#1E3160', headText: '#FFFFFF', band: '#EEF0F5' },
    'Classic Grey': { primary: '#222222', accent: '#7A7A7A', text: '#111111', headFill: '#FFFFFF', headText: '#111111', band: '#E6E6E6' },
    'Harbour Teal': { primary: '#0E4B50', accent: '#E0A43B', text: '#132224', headFill: '#0E4B50', headText: '#FFFFFF', band: '#E7F0EF' },
    'Oxblood': { primary: '#5E1B24', accent: '#B8925A', text: '#231416', headFill: '#5E1B24', headText: '#FFF8F0', band: '#F4ECE8' },
    'Ink Minimal': { primary: '#0B0B0F', accent: '#2F6FEB', text: '#0B0B0F', headFill: '#F3F4F6', headText: '#0B0B0F', band: '#FFFFFF' },
  };

  const FONTS = ['Inter', 'IBM Plex Sans', 'Source Serif 4', 'Cinzel', 'Tajawal', 'Georgia', 'Helvetica', 'Courier New'];

  const DEFAULT_COLUMNS = [
    { key: 'no', label: 'Item No', visible: true },
    { key: 'desc', label: 'Description', visible: true },
    { key: 'uom', label: 'UoM', visible: false },
    { key: 'qty', label: 'Qty', visible: true },
    { key: 'price', label: 'Unit Price', visible: true },
    { key: 'discount', label: 'Disc %', visible: false },
    { key: 'tax', label: 'Tax %', visible: false },
    { key: 'amount', label: 'Amount ({CUR})', visible: true },
  ];

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const kv = (label, value = '', extra = {}) => ({ label, value, ...extra });
  const blankItem = () => ({ id: uid(), desc: '', uom: '', qty: 1, price: 0, discount: 0, tax: 0 });

  // Everything that should carry over from one invoice to the next.
  const BRAND_KEYS = ['title', 'company', 'theme', 'sections', 'columns', 'currency', 'words', 'footer',
    'bank', 'numberLabel', 'customerHeading', 'shipmentTitle', 'meta', 'shipment', 'totals'];

  function defaultBrand() {
    return {
      title: 'PROFORMA INVOICE',
      numberLabel: 'Invoice No.',
      customerHeading: 'Bill To',
      shipmentTitle: 'Shipment Details',
      company: {
        name: 'NAYEF BASHAR TRADING EST.',
        address: 'Block __, Street __, Building __\nKuwait City, State of Kuwait',
        contacts: [kv('Telephone', '+965 ____ ____'), kv('Mobile', '+965 ____ ____'), kv('Email', 'info@yourdomain.com'), kv('Web', 'www.yourdomain.com')],
        tagline: 'IMPORT  |  EXPORT  |  COMMISSION AGENT  |  SUPPLY CHAIN & LOGISTICS',
        logo: 'default',
      },
      meta: [kv('Invoice Date', '', { type: 'date' }), kv('Due Date', '', { type: 'date' }), kv('Your Reference'),
        kv('Our Contact Person'), kv('Customer No.'), kv('Exchange Rate')],
      shipment: [kv('Vessel / Voyage No.'), kv('Port of Loading'), kv('Volume / Weight'), kv('Port of Discharge'),
        kv('Quantity'), kv('Place of Receipt'), kv('Commodity'), kv('Final Destination'), kv('Cargo Description'),
        kv('B/L No.'), kv('Cargo Load Type'), kv('ETA', '', { type: 'date' }), kv('Container / Seal No.', '', { wide: true })],
      totals: {
        subtotalLabel: 'Subtotal', discountLabel: 'Discount', discountType: 'percent', discountValue: 0,
        taxLabel: 'VAT', taxRate: 0, lineTaxLabel: 'Tax', charges: [], grandLabel: 'Total',
        paidLabel: 'Advance Paid', paid: 0, totalLabel: 'Amount to be paid', alwaysShowSubtotal: false,
      },
      currency: { ...CURRENCIES.KWD },
      columns: DEFAULT_COLUMNS.map((c) => ({ ...c })),
      words: { template: NB.words.DEFAULT_TEMPLATE, minorTemplate: NB.words.DEFAULT_MINOR_TEMPLATE, casing: 'upper' },
      bank: [kv('Bank Name'), kv('Account Name', 'Nayef Bashar Trading Est.'), kv('Account No.'), kv('IBAN'), kv('SWIFT / BIC')],
      footer: {
        signatureLabel: 'for NAYEF BASHAR TRADING EST.',
        preparedBy: '',
        notesTitle: 'Notes',
        notes: '',
        bankTitle: 'Bank Details',
        terms: 'Cheques are subject to realization.\nAll business is subject to our Standard Trading Conditions, available from our office on request.',
        warning: 'We do not change our bank account. If you receive an email regarding changes to our bank account, consider it fraud and report it to the authorities and to us.',
      },
      sections: {
        tagline: false, customer: true, meta: true, shipment: true, words: true, notes: false, bank: false,
        signature: true, stamp: false, printed: true, terms: true, hideEmpty: false, watermark: false, pageGuides: true,
      },
      theme: {
        ...THEME_PRESETS['Navy & Gold'],
        preset: 'Navy & Gold', bodyFont: 'Inter', headingFont: 'Cinzel', baseSize: 9, headerLayout: 'classic',
        logoPosition: 'right', logoHeight: 30, titleStyle: 'band', titleAlign: 'center', tableStyle: 'grid',
        density: 'normal', paper: 'A4', margin: 12, radius: 0, dateFormat: 'D MMM YYYY', grouping: 'comma',
        qtyDecimals: 3, priceWithCurrency: true, watermarkText: 'DRAFT', goldRules: true,
      },
    };
  }

  const clone = (x) => structuredClone(x);

  function brandFromInvoice(invoice) {
    const brand = {};
    BRAND_KEYS.forEach((key) => { brand[key] = clone(invoice[key]); });
    brand.meta = brand.meta.map((f) => ({ ...f, value: f.label === 'Exchange Rate' ? f.value : '' }));
    brand.shipment = brand.shipment.map((f) => ({ ...f, value: '' }));
    brand.totals = { ...brand.totals, discountValue: 0, taxRate: invoice.totals.taxRate, paid: 0 };
    return brand;
  }

  function mergeBrand(saved) {
    const base = defaultBrand();
    if (!saved) return base;
    const merged = { ...base, ...saved };
    ['company', 'totals', 'currency', 'words', 'footer', 'sections', 'theme'].forEach((key) => {
      merged[key] = { ...base[key], ...(saved[key] || {}) };
    });
    return merged;
  }

  function newInvoice(brand, number) {
    const b = clone(mergeBrand(brand));
    const date = today();
    return {
      ...b,
      id: uid(),
      number,
      status: 'draft',
      customer: { name: '', address: '', contacts: [kv('Telephone'), kv('Email')] },
      meta: b.meta.map((f, i) => (f.type === 'date' && i === 0 ? { ...f, value: date } : f)),
      items: [blankItem()],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function sampleInvoice(brand, number) {
    const inv = newInvoice(brand, number);
    const setValues = (list, values) => list.map((f) => (f.label in values ? { ...f, value: values[f.label] } : f));
    return {
      ...inv,
      customer: {
        name: 'CURA HEALTH CO KSCC',
        address: 'SHUAIB COMPLEX, FLOOR 2, FLAT 2\nSALEM AL MUBARAK STREET\nSALMIYA, Kuwait',
        contacts: [kv('Telephone', '67057908 / 51393033'), kv('Email', 'info@curamedical-kw.com')],
      },
      meta: setValues(inv.meta, { 'Your Reference': 'CBDOH2600090', 'Our Contact Person': 'Asad Bhatti', 'Customer No.': '13135', 'Exchange Rate': 'KWD @ 1.000000' }),
      shipment: setValues(inv.shipment, {
        'Vessel / Voyage No.': 'MSC AGAMEMNON / MG623W', 'Port of Loading': 'Genoa', 'Volume / Weight': '96.00 CBM / 17,267.000 KG',
        'Port of Discharge': 'Jeddah', Quantity: '2 X 40 FT HIGH CUBE', 'Place of Receipt': 'Genoa', Commodity: 'COSMETIC PRODUCT',
        'Final Destination': 'Jeddah', 'Cargo Description': 'COSMETIC PRODUCTS', 'B/L No.': 'MEDURL864101', 'Cargo Load Type': 'FCL',
        ETA: '2026-07-08', 'Container / Seal No.': 'SEGU9668258 / A239100, TRIU8911264 / A239002',
      }),
      items: [
        ['TRAILER DETENTION X 1 Day For 2 Trailers', 2, 80], ['TRANSPORTATION', 2, 672], ['PORT CHARGES', 2, 717.5],
        ['DEMURRAGE LINER', 2, 447.5], ['PORT HANDLING SYSTEM FEES (PORT APPOINTMENT)', 2, 34], ['CUSTOMS COMPUTER FEES (GLOBAL)', 2, 8.8],
      ].map(([desc, qty, price]) => ({ ...blankItem(), desc, qty, price })),
    };
  }

  NB.defaults = {
    CURRENCIES, DOC_TITLES, THEME_PRESETS, FONTS, DEFAULT_COLUMNS,
    uid, today, kv, blankItem, defaultBrand, mergeBrand, brandFromInvoice, newInvoice, sampleInvoice,
  };
})(window.NB = window.NB || {});
