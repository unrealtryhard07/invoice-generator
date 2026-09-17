/* Default brand, Arabic labels, presets, catalog seed and invoice factories/migration. */
(function (NB) {
  'use strict';

  const CURRENCIES = {
    KWD: { code: 'KWD', decimals: 3, major: 'DINARS', minor: 'FILS', country: 'KUWAIT', majorAr: 'دينار كويتي', minorAr: 'فلس' },
    SAR: { code: 'SAR', decimals: 2, major: 'RIYALS', minor: 'HALALAS', country: 'SAUDI ARABIA', majorAr: 'ريال سعودي', minorAr: 'هللة' },
    AED: { code: 'AED', decimals: 2, major: 'DIRHAMS', minor: 'FILS', country: 'UAE', majorAr: 'درهم إماراتي', minorAr: 'فلس' },
    QAR: { code: 'QAR', decimals: 2, major: 'RIYALS', minor: 'DIRHAMS', country: 'QATAR', majorAr: 'ريال قطري', minorAr: 'درهم' },
    BHD: { code: 'BHD', decimals: 3, major: 'DINARS', minor: 'FILS', country: 'BAHRAIN', majorAr: 'دينار بحريني', minorAr: 'فلس' },
    OMR: { code: 'OMR', decimals: 3, major: 'RIALS', minor: 'BAISA', country: 'OMAN', majorAr: 'ريال عماني', minorAr: 'بيسة' },
    USD: { code: 'USD', decimals: 2, major: 'US DOLLARS', minor: 'CENTS', country: '', majorAr: 'دولار أمريكي', minorAr: 'سنت' },
    EUR: { code: 'EUR', decimals: 2, major: 'EUROS', minor: 'CENTS', country: '', majorAr: 'يورو', minorAr: 'سنت' },
    GBP: { code: 'GBP', decimals: 2, major: 'POUNDS', minor: 'PENCE', country: '', majorAr: 'جنيه إسترليني', minorAr: 'بنس' },
    INR: { code: 'INR', decimals: 2, major: 'RUPEES', minor: 'PAISE', country: 'INDIA', majorAr: 'روبية هندية', minorAr: 'بيسة' },
    PKR: { code: 'PKR', decimals: 2, major: 'RUPEES', minor: 'PAISA', country: 'PAKISTAN', majorAr: 'روبية باكستانية', minorAr: 'بيسة' },
    CNY: { code: 'CNY', decimals: 2, major: 'YUAN', minor: 'FEN', country: 'CHINA', majorAr: 'يوان صيني', minorAr: 'فين' },
  };

  const TITLES = {
    'PROFORMA INVOICE': 'فاتورة مبدئية', 'TAX INVOICE': 'فاتورة ضريبية', 'COMMERCIAL INVOICE': 'فاتورة تجارية',
    INVOICE: 'فاتورة', QUOTATION: 'عرض سعر', 'CREDIT NOTE': 'إشعار دائن', 'DEBIT NOTE': 'إشعار مدين',
    'DELIVERY NOTE': 'إذن تسليم', RECEIPT: 'إيصال استلام',
  };
  const DOC_TITLES = Object.keys(TITLES);

  const AR_LABELS = {
    'Invoice No.': 'رقم الفاتورة', 'Invoice Date': 'تاريخ الفاتورة', 'Due Date': 'تاريخ الاستحقاق',
    'Your Reference': 'مرجعكم', 'Our Contact Person': 'مسؤول التواصل', 'Customer No.': 'رقم العميل', 'Exchange Rate': 'سعر الصرف',
    'Vessel / Voyage No.': 'السفينة / رقم الرحلة', 'Port of Loading': 'ميناء الشحن', 'Volume / Weight': 'الحجم / الوزن',
    'Port of Discharge': 'ميناء التفريغ', Quantity: 'الكمية', 'Place of Receipt': 'مكان الاستلام', Commodity: 'نوع البضاعة',
    'Final Destination': 'الوجهة النهائية', 'Cargo Description': 'وصف البضاعة', 'B/L No.': 'رقم بوليصة الشحن',
    'Cargo Load Type': 'نوع الحمولة', ETA: 'الوصول المتوقع', 'Container / Seal No.': 'رقم الحاوية / الختم',
    Telephone: 'هاتف', Mobile: 'نقال', Email: 'البريد الإلكتروني', Web: 'الموقع', Fax: 'فاكس',
    'Bank Name': 'اسم البنك', 'Account Name': 'اسم الحساب', 'Account No.': 'رقم الحساب', IBAN: 'الآيبان', 'SWIFT / BIC': 'سويفت',
    'Item No': 'م', Description: 'البيان', UoM: 'الوحدة', Qty: 'الكمية', 'Unit Price': 'سعر الوحدة',
    'Disc %': 'خصم ٪', 'Tax %': 'ضريبة ٪', 'Amount ({CUR})': 'المبلغ ({CUR})',
  };
  const arabicFor = (label) => AR_LABELS[String(label || '').trim()] || '';

  const THEME_PRESETS = {
    'Navy & Black': { primary: '#1E3160', accent: '#000000', text: '#1A1D24', headFill: '#1E3160', headText: '#FFFFFF', band: '#EEF0F5' },
    'Classic Grey': { primary: '#222222', accent: '#7A7A7A', text: '#111111', headFill: '#FFFFFF', headText: '#111111', band: '#E6E6E6' },
    'Harbour Teal': { primary: '#0E4B50', accent: '#E0A43B', text: '#132224', headFill: '#0E4B50', headText: '#FFFFFF', band: '#E7F0EF' },
    Oxblood: { primary: '#5E1B24', accent: '#B8925A', text: '#231416', headFill: '#5E1B24', headText: '#FFF8F0', band: '#F4ECE8' },
    'Ink Minimal': { primary: '#0B0B0F', accent: '#2F6FEB', text: '#0B0B0F', headFill: '#F3F4F6', headText: '#0B0B0F', band: '#FFFFFF' },
  };

  const FONTS = ['Inter', 'IBM Plex Sans', 'Source Serif 4', 'Cinzel', 'Tajawal', 'Georgia', 'Helvetica', 'Courier New'];
  const AR_FONTS = ['Tajawal', 'Noto Naskh Arabic', 'Cairo', 'Amiri'];
  const PAYMENT_METHODS = ['Bank Transfer', 'K-Net', 'Cash', 'Cheque', 'Card', 'Other'];

  const CATALOG_SEED = [
    ['TRANSPORTATION', 'نقل', 'Trip'], ['PORT CHARGES', 'رسوم الميناء', 'Container'], ['DEMURRAGE LINER', 'غرامة تأخير الخط الملاحي', 'Container'],
    ['TRAILER DETENTION', 'احتجاز الشاحنة', 'Day'], ['PORT HANDLING SYSTEM FEES (PORT APPOINTMENT)', 'رسوم نظام مناولة الميناء', 'Container'],
    ['CUSTOMS COMPUTER FEES (GLOBAL)', 'رسوم الحاسب الآلي للجمارك', 'Container'], ['CUSTOMS CLEARANCE', 'تخليص جمركي', 'Shipment'],
    ['CUSTOMS DUTY', 'رسوم جمركية', 'Shipment'], ['DELIVERY ORDER FEES', 'رسوم إذن التسليم', 'Shipment'], ['DOCUMENTATION FEES', 'رسوم المستندات', 'Shipment'],
    ['TERMINAL HANDLING CHARGES (THC)', 'رسوم مناولة المحطة', 'Container'], ['OCEAN FREIGHT', 'شحن بحري', 'Container'], ['AIR FREIGHT', 'شحن جوي', 'KG'],
    ['STORAGE', 'تخزين', 'Day'], ['LOADING / UNLOADING', 'تحميل / تنزيل', 'Container'], ['INSURANCE', 'تأمين', 'Shipment'], ['COMMISSION', 'عمولة', 'Shipment'],
  ].map(([name, nameAr, uom], i) => ({ id: `seed-${i}`, name, nameAr, uom, price: 0, tax: 0 }));

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const addDays = (iso, days) => {
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return '';
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const kv = (label, value = '', extra = {}) => ({ label, labelAr: arabicFor(label), value, ...extra });
  const blankItem = () => ({ id: uid(), desc: '', descAr: '', uom: '', qty: 1, price: 0, cost: 0, discount: 0, tax: 0 });
  const blankContainer = () => ({ id: uid(), number: '', seal: '', size: '40HC', packages: '', weight: '', volume: '' });

  const LAYOUT_BLOCKS = [['header', 'Header'], ['title', 'Title'], ['parties', 'Customer & details'], ['shipment', 'Shipment'],
    ['containers', 'Containers'], ['lines', 'Line items & totals'], ['fx', 'Exchange rate'], ['words', 'Amount in words'],
    ['extras', 'Notes & bank'], ['spacer', 'Flexible space'], ['footer', 'Signature & footer']];
  const DEFAULT_LAYOUT = LAYOUT_BLOCKS.map(([id]) => id);
  const normalizeLayout = (layout) => {
    const known = (Array.isArray(layout) ? layout : []).filter((id) => DEFAULT_LAYOUT.includes(id));
    const missing = DEFAULT_LAYOUT.filter((id) => !known.includes(id));
    return [...new Set([...known, ...missing])];
  };
  const clone = (x) => structuredClone(x);

  const DEFAULT_COLUMNS = [
    ['no', 'Item No', true], ['desc', 'Description', true], ['uom', 'UoM', false], ['qty', 'Qty', true],
    ['price', 'Unit Price', true], ['discount', 'Disc %', false], ['tax', 'Tax %', false], ['amount', 'Amount ({CUR})', true],
  ].map(([key, label, visible]) => ({ key, label, labelAr: arabicFor(label), visible }));

  // Everything that carries over from one invoice to the next.
  const BRAND_KEYS = ['title', 'titleAr', 'language', 'company', 'theme', 'sections', 'columns', 'currency', 'words', 'footer', 'bank',
    'numberLabel', 'numberLabelAr', 'customerHeading', 'customerHeadingAr', 'shipmentTitle', 'shipmentTitleAr', 'meta', 'shipment', 'totals', 'stamp', 'layout', 'fx', 'qr'];
  const NESTED_KEYS = ['company', 'totals', 'currency', 'words', 'footer', 'sections', 'theme', 'stamp', 'fx', 'qr'];

  function defaultBrand() {
    return {
      title: 'PROFORMA INVOICE', titleAr: TITLES['PROFORMA INVOICE'], language: 'bi',
      numberLabel: 'Invoice No.', numberLabelAr: arabicFor('Invoice No.'),
      customerHeading: 'Bill To', customerHeadingAr: 'العميل',
      shipmentTitle: 'Shipment Details', shipmentTitleAr: 'تفاصيل الشحنة',
      company: {
        name: 'NAYEF BASHAR TRADING EST.', nameAr: 'مؤسسة نايف بشر تجارية',
        address: 'Block __, Street __, Building __\nKuwait City, State of Kuwait', addressAr: 'الكويت',
        contacts: [kv('Telephone', '+965 ____ ____'), kv('Mobile', '+965 ____ ____'), kv('Email', 'info@yourdomain.com'), kv('Web', 'www.yourdomain.com')],
        tagline: 'IMPORT  |  EXPORT  |  COMMISSION AGENT  |  SUPPLY CHAIN & LOGISTICS',
        logo: 'default',
      },
      meta: [kv('Invoice Date', '', { type: 'date', key: 'invoiceDate' }), kv('Due Date', '', { type: 'date', key: 'dueDate' }),
        kv('Your Reference'), kv('Our Contact Person'), kv('Customer No.'), kv('Exchange Rate')],
      shipment: [kv('Vessel / Voyage No.'), kv('Port of Loading'), kv('Volume / Weight'), kv('Port of Discharge'),
        kv('Quantity'), kv('Place of Receipt'), kv('Commodity'), kv('Final Destination'), kv('Cargo Description'),
        kv('B/L No.'), kv('Cargo Load Type'), kv('ETA', '', { type: 'date' }), kv('Container / Seal No.', '', { wide: true })],
      totals: {
        subtotalLabel: 'Subtotal', subtotalLabelAr: 'المجموع الفرعي', discountLabel: 'Discount', discountLabelAr: 'الخصم',
        discountType: 'percent', discountValue: 0, taxLabel: 'VAT', taxLabelAr: 'ضريبة القيمة المضافة', taxRate: 0,
        lineTaxLabel: 'Tax', lineTaxLabelAr: 'الضريبة', charges: [], grandLabel: 'Total', grandLabelAr: 'الإجمالي',
        paidLabel: 'Paid', paidLabelAr: 'المدفوع', paid: 0, totalLabel: 'Amount to be paid', totalLabelAr: 'المبلغ المستحق',
        balanceLabel: 'Balance due', balanceLabelAr: 'الرصيد المستحق', alwaysShowSubtotal: false,
      },
      currency: { ...CURRENCIES.KWD },
      columns: clone(DEFAULT_COLUMNS),
      words: {
        template: NB.words.DEFAULT_TEMPLATE, minorTemplate: NB.words.DEFAULT_MINOR_TEMPLATE, casing: 'upper',
        templateAr: NB.wordsAr.DEFAULT_TEMPLATE, minorTemplateAr: NB.wordsAr.DEFAULT_MINOR_TEMPLATE,
      },
      bank: [kv('Bank Name'), kv('Account Name', 'Nayef Bashar Trading Est.'), kv('Account No.'), kv('IBAN'), kv('SWIFT / BIC')],
      footer: {
        signatureLabel: 'for NAYEF BASHAR TRADING EST.', signatureLabelAr: 'عن مؤسسة نايف بشر تجارية', preparedBy: '',
        notesTitle: 'Notes', notesTitleAr: 'ملاحظات', notes: '', notesAr: '', bankTitle: 'Bank Details', bankTitleAr: 'بيانات البنك',
        terms: 'Cheques are subject to realization.\nAll business is subject to our Standard Trading Conditions, available from our office on request.',
        termsAr: 'الشيكات خاضعة للتحصيل.\nجميع الأعمال تخضع لشروط التجارة القياسية الخاصة بنا والمتاحة في مكتبنا عند الطلب.',
        warning: 'We do not change our bank account. If you receive an email regarding changes to our bank account, consider it fraud and report it to the authorities and to us.',
        warningAr: 'نحن لا نغير حسابنا البنكي. إذا تلقيت بريداً إلكترونياً بشأن تغيير حسابنا البنكي فاعتبره احتيالاً وأبلغ الجهات المختصة وأبلغنا.',
      },
      sections: {
        tagline: false, customer: true, meta: true, shipment: true, words: true, notes: false, bank: false, payments: true,
        signature: true, printed: true, terms: true, hideEmpty: false, watermark: false, pageGuides: true, containers: true,
      },
      stamp: { show: true, source: 'default', x: 22, y: 222, size: 36, rotation: -8, opacity: 0.92 },
      layout: [...DEFAULT_LAYOUT],
      qr: { show: false, mode: 'summary', text: '', x: 168, y: 226, size: 24, caption: 'Scan for invoice details', captionAr: 'امسح لعرض تفاصيل الفاتورة' },
      fx: { enabled: false, base: 'KWD', baseDecimals: 3, rate: '' },
      theme: {
        ...THEME_PRESETS['Navy & Black'],
        preset: 'Navy & Black', bodyFont: 'Inter', headingFont: 'Cinzel', arabicFont: 'Tajawal', arabicDigits: false, baseSize: 9,
        headerLayout: 'classic', logoPosition: 'right', logoHeight: 30, titleStyle: 'band', titleAlign: 'center', tableStyle: 'grid',
        density: 'normal', paper: 'A4', margin: 12, radius: 0, dateFormat: 'D MMM YYYY', grouping: 'comma',
        qtyDecimals: 3, priceWithCurrency: true, watermarkText: 'DRAFT', goldRules: true,
      },
    };
  }

  function mergeBrand(saved) {
    const base = defaultBrand();
    if (!saved) return base;
    const merged = { ...base, ...saved };
    NESTED_KEYS.forEach((key) => { merged[key] = { ...base[key], ...(saved[key] || {}) }; });
    if (merged.theme.preset === 'Navy & Gold') {
      merged.theme = { ...merged.theme, ...THEME_PRESETS['Navy & Black'], preset: 'Navy & Black' };
    }
    return merged;
  }

  /* ---------- migration of older saved data ---------- */
  const withArabic = (list) => (list || []).map((f) => (f.labelAr === undefined ? { ...f, labelAr: arabicFor(f.label) } : f));
  const META_KEYS = { 'Invoice Date': 'invoiceDate', 'Due Date': 'dueDate' };

  function migrate(inv) {
    const base = defaultBrand();
    const merged = mergeBrand(inv);
    const meta = withArabic(merged.meta).map((f) => (f.key || !META_KEYS[f.label] ? f : { ...f, key: META_KEYS[f.label] }));
    const invoiceDate = (meta.find((f) => f.key === 'invoiceDate') || {}).value || today();
    const legacyPaid = NB.calc.toNum(merged.totals.paid);
    const payments = Array.isArray(inv.payments) ? inv.payments : [];
    return {
      ...merged,
      id: inv.id || uid(),
      number: inv.number ?? '',
      status: ['paid', 'overdue'].includes(inv.status) ? 'sent' : (inv.status || 'draft'),
      titleAr: inv.titleAr ?? (TITLES[String(merged.title).toUpperCase()] || ''),
      numberLabelAr: inv.numberLabelAr ?? arabicFor(merged.numberLabel),
      customerHeadingAr: inv.customerHeadingAr ?? base.customerHeadingAr,
      shipmentTitleAr: inv.shipmentTitleAr ?? base.shipmentTitleAr,
      company: { ...merged.company, contacts: withArabic(merged.company.contacts) },
      customer: { name: '', nameAr: '', address: '', addressAr: '', ...(inv.customer || {}), contacts: withArabic((inv.customer || {}).contacts) },
      meta,
      shipment: withArabic(merged.shipment),
      bank: withArabic(merged.bank),
      columns: merged.columns.map((c) => (c.labelAr === undefined ? { ...c, labelAr: arabicFor(c.label) } : c)),
      layout: normalizeLayout(merged.layout),
      containers: Array.isArray(inv.containers) ? inv.containers : [],
      items: (Array.isArray(inv.items) ? inv.items : []).map((i) => ({ descAr: '', ...i, id: i.id || uid() })),
      totals: { ...merged.totals, paid: 0 },
      payments: legacyPaid && !payments.length
        ? [{ id: uid(), date: invoiceDate, amount: legacyPaid, method: 'Advance', reference: '' }]
        : payments,
    };
  }

  function brandFromInvoice(invoice) {
    const brand = Object.fromEntries(BRAND_KEYS.map((key) => [key, clone(invoice[key])]));
    return {
      ...brand,
      meta: brand.meta.map((f) => ({ ...f, value: f.label === 'Exchange Rate' ? f.value : '' })),
      shipment: brand.shipment.map((f) => ({ ...f, value: '' })),
      totals: { ...brand.totals, discountValue: 0, paid: 0, charges: [] },
    };
  }

  /* ---------- templates ---------- */
  const metaFields = (extra) => [kv('Invoice Date', '', { type: 'date', key: 'invoiceDate' }), kv('Due Date', '', { type: 'date', key: 'dueDate' }), ...extra];
  const columnsShowing = (keys) => DEFAULT_COLUMNS.map((c) => ({ ...c, visible: keys.includes(c.key) }));
  const TEMPLATES = [
    { id: 'tpl-freight', builtIn: true, name: 'Freight Proforma', description: 'Shipment details, container table and port charges.',
      data: { title: 'PROFORMA INVOICE', titleAr: TITLES['PROFORMA INVOICE'], sections: { shipment: true, containers: true, printed: true } } },
    { id: 'tpl-commission', builtIn: true, name: 'Commission Invoice', description: 'Agent commission: principal, period and a simple amount table.',
      data: {
        title: 'INVOICE', titleAr: TITLES.INVOICE, sections: { shipment: false, containers: false },
        meta: metaFields([kv('Principal', '', { labelAr: 'الموكل' }), kv('Commission Period', '', { labelAr: 'فترة العمولة' }), kv('Your Reference')]),
        columns: columnsShowing(['no', 'desc', 'amount']),
      } },
    { id: 'tpl-simple', builtIn: true, name: 'Simple Invoice', description: 'A clean one-page invoice without shipping fields.',
      data: {
        title: 'INVOICE', titleAr: TITLES.INVOICE, sections: { shipment: false, containers: false, printed: false },
        meta: metaFields([kv('Your Reference')]), theme: { headerLayout: 'centered', titleStyle: 'underline', tableStyle: 'minimal' },
      } },
    { id: 'tpl-quotation', builtIn: true, name: 'Quotation', description: 'Price offer with a validity date — convert it to a proforma later.',
      data: {
        title: 'QUOTATION', titleAr: TITLES.QUOTATION, sections: { shipment: true, containers: false, payments: false },
        meta: [kv('Quotation Date', '', { type: 'date', key: 'invoiceDate', labelAr: 'تاريخ العرض' }), kv('Valid Until', '', { type: 'date', key: 'dueDate', labelAr: 'صالح حتى' }), kv('Your Reference'), kv('Our Contact Person')],
      } },
  ];

  /** Applies a template's design and structure; keeps the document's own content (customer, items, payments). */
  function applyTemplate(target, template) {
    const data = template.data || {};
    const merged = { ...target, ...data };
    NESTED_KEYS.forEach((key) => { if (data[key]) merged[key] = { ...target[key], ...data[key] }; });
    if (data.meta) {
      const valueFor = (f) => (target.meta.find((m) => (f.key && m.key === f.key) || m.label === f.label) || {}).value ?? f.value;
      merged.meta = data.meta.map((f) => ({ ...f, value: valueFor(f) }));
    }
    if (data.shipment) {
      merged.shipment = data.shipment.map((f) => ({ ...f, value: (target.shipment.find((m) => m.label === f.label) || {}).value ?? f.value }));
    }
    return { ...merged, id: target.id, number: target.number, customer: target.customer, items: target.items, payments: target.payments, containers: target.containers, status: target.status };
  }

  const templateFromInvoice = (inv, name) => ({ id: uid(), name, description: 'Saved from an invoice', data: brandFromInvoice(inv) });

  function newInvoice(brand, number, template = null) {
    const b = clone(mergeBrand(template ? applyTemplate(mergeBrand(brand), template) : brand));
    const date = today();
    return migrate({
      ...b,
      id: uid(),
      number,
      status: 'draft',
      customer: { name: '', nameAr: '', address: '', addressAr: '', contacts: [kv('Telephone'), kv('Email')] },
      meta: b.meta.map((f) => (f.key === 'invoiceDate' ? { ...f, value: date } : f)),
      items: [blankItem()],
      payments: [],
      containers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  function sampleInvoice(brand, number) {
    const inv = newInvoice(brand, number);
    const setValues = (list, values) => list.map((f) => (f.label in values ? { ...f, value: values[f.label] } : f));
    return {
      ...inv,
      status: 'sent',
      customer: {
        name: 'CURA HEALTH CO KSCC', nameAr: 'شركة كيورا الصحية',
        address: 'SHUAIB COMPLEX, FLOOR 2, FLAT 2\nSALEM AL MUBARAK STREET\nSALMIYA, Kuwait', addressAr: '',
        contacts: [kv('Telephone', '67057908 / 51393033'), kv('Email', 'info@curamedical-kw.com')],
      },
      meta: setValues(inv.meta, {
        'Due Date': addDays(today(), 30), 'Your Reference': 'CBDOH2600090', 'Our Contact Person': 'Asad Bhatti',
        'Customer No.': '13135', 'Exchange Rate': 'KWD @ 1.000000',
      }),
      shipment: setValues(inv.shipment, {
        'Vessel / Voyage No.': 'MSC AGAMEMNON / MG623W', 'Port of Loading': 'Genoa', 'Volume / Weight': '96.00 CBM / 17,267.000 KG',
        'Port of Discharge': 'Jeddah', Quantity: '2 X 40 FT HIGH CUBE', 'Place of Receipt': 'Genoa', Commodity: 'COSMETIC PRODUCT',
        'Final Destination': 'Jeddah', 'Cargo Description': 'COSMETIC PRODUCTS', 'B/L No.': 'MEDURL864101', 'Cargo Load Type': 'FCL',
        ETA: '2026-07-08', 'Container / Seal No.': 'SEGU9668258 / A239100, TRIU8911264 / A239002',
      }),
      items: [
        ['TRAILER DETENTION X 1 Day For 2 Trailers', 'احتجاز الشاحنة يوم واحد لعدد ٢ شاحنة', 2, 80], ['TRANSPORTATION', 'نقل', 2, 672],
        ['PORT CHARGES', 'رسوم الميناء', 2, 717.5], ['DEMURRAGE LINER', 'غرامة تأخير الخط الملاحي', 2, 447.5],
        ['PORT HANDLING SYSTEM FEES (PORT APPOINTMENT)', 'رسوم نظام مناولة الميناء', 2, 34],
        ['CUSTOMS COMPUTER FEES (GLOBAL)', 'رسوم الحاسب الآلي للجمارك', 2, 8.8],
      ].map(([desc, descAr, qty, price]) => ({ ...blankItem(), desc, descAr, qty, price })),
      containers: [
        { ...blankContainer(), number: 'SEGU9668258', seal: 'A239100', size: '40HC', weight: 8633.5, volume: 48 },
        { ...blankContainer(), number: 'TRIU8911264', seal: 'A239002', size: '40HC', weight: 8633.5, volume: 48 },
      ],
    };
  }

  NB.defaults = {
    CURRENCIES, TITLES, DOC_TITLES, AR_LABELS, THEME_PRESETS, FONTS, AR_FONTS, PAYMENT_METHODS, CATALOG_SEED, DEFAULT_COLUMNS,
    LAYOUT_BLOCKS, DEFAULT_LAYOUT, TEMPLATES, normalizeLayout, applyTemplate, templateFromInvoice, blankContainer,
    uid, today, addDays, kv, arabicFor, blankItem, defaultBrand, mergeBrand, migrate, brandFromInvoice, newInvoice, sampleInvoice,
  };
})(window.NB = window.NB || {});
