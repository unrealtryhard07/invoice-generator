/* Renders an invoice into printable HTML (English, Arabic RTL, or bilingual). All user text is escaped. */
(function (NB) {
  'use strict';

  const { calc, words, wordsAr, defaults } = NB;
  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const clamp = (v, min, max, fallback) => {
    const n = calc.toNum(v);
    return Number.isFinite(n) && v !== '' ? Math.min(Math.max(n, min), max) : fallback;
  };

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
  const multiline = (v) => esc(v).replace(/\n/g, '<br>');
  const safeColor = (v, fallback) => (/^#[0-9a-f]{3,8}$/i.test(String(v)) ? v : fallback);
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  const langOf = (inv) => pick(inv.language, ['en', 'ar', 'bi'], 'en');

  /* ---------- bilingual primitives ---------- */
  function text(inv, en, ar, { lines = false } = {}) {
    const fmt = lines ? multiline : esc;
    const lang = langOf(inv);
    if (lang === 'ar') return ar || en ? `<span class="t-ar" dir="rtl">${fmt(ar || en)}</span>` : '';
    if (lang === 'bi' && ar) return `<span class="t-en">${fmt(en)}</span><span class="t-ar" dir="rtl">${fmt(ar)}</span>`;
    return en ? `<span class="t-en">${fmt(en)}</span>` : '';
  }

  function num(inv, value) {
    const shown = langOf(inv) === 'ar' && inv.theme.arabicDigits ? wordsAr.toArabicDigits(value) : value;
    return `<bdi class="num">${esc(shown)}</bdi>`;
  }

  function fieldValue(field, inv) {
    if (field.type !== 'date') return esc(field.value).replace(/\n/g, '<br>');
    const format = langOf(inv) === 'ar' ? 'DD/MM/YYYY' : inv.theme.dateFormat;
    return num(inv, calc.formatDate(field.value, format));
  }

  function kvList(list, inv, className = '', hideEmpty = inv.sections.hideEmpty) {
    const lang = langOf(inv);
    const rows = (list || [])
      .filter((f) => (hideEmpty ? String(f.value ?? '').trim() : f.label || f.value))
      .map((f) => {
        const label = lang === 'ar' ? (f.labelAr || f.label) : f.label;
        const arLabel = lang === 'bi' && f.labelAr ? `<dt class="kv-ar" dir="rtl">${esc(f.labelAr)}</dt>` : '';
        return `<div class="kv${f.wide ? ' kv--wide' : ''}${arLabel ? ' kv--bi' : ''}"><dt>${esc(label)}</dt>`
          + `<dd dir="auto">${label ? '<i>:</i>' : ''}<span>${fieldValue(f, inv)}</span></dd>${arLabel}</div>`;
      })
      .join('');
    return rows ? `<dl class="${className}">${rows}</dl>` : '';
  }

  /* ---------- styling ---------- */
  function sheetStyle(inv) {
    const t = inv.theme;
    const fallback = defaults.THEME_PRESETS['Navy & Black'];
    const font = (v, list, def) => (list.includes(v) || (NB.customFonts || []).includes(v) ? v : def);
    const vars = {
      '--inv-primary': safeColor(t.primary, fallback.primary),
      '--inv-accent': safeColor(t.accent, fallback.accent),
      '--inv-text': safeColor(t.text, fallback.text),
      '--inv-head-fill': safeColor(t.headFill, fallback.headFill),
      '--inv-head-text': safeColor(t.headText, fallback.headText),
      '--inv-band': safeColor(t.band, fallback.band),
      '--inv-body-font': `'${font(t.bodyFont, defaults.FONTS, 'Inter')}'`,
      '--inv-heading-font': `'${font(t.headingFont, defaults.FONTS, 'Cinzel')}'`,
      '--inv-ar-font': `'${font(t.arabicFont, defaults.AR_FONTS, 'Tajawal')}'`,
      '--inv-size': `${clamp(t.baseSize, 6, 14, 9)}pt`,
      '--inv-logo-h': `${clamp(t.logoHeight, 8, 80, 30)}mm`,
      '--inv-margin': `${clamp(t.margin, 0, 30, 12)}mm`,
      '--inv-radius': `${clamp(t.radius, 0, 12, 0)}px`,
    };
    return Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
  }

  function sheetAttrs(inv, extraClass = '') {
    const t = inv.theme;
    const lang = langOf(inv);
    const classes = ['sheet', `lang-${lang}`, `paper-${pick(t.paper, ['A4', 'Letter'], 'A4')}`,
      `density-${pick(t.density, ['compact', 'normal', 'airy'], 'normal')}`,
      t.goldRules ? 'has-rules' : '', inv.sections.pageGuides ? 'has-guides' : '', extraClass].filter(Boolean).join(' ');
    return `class="${classes}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}" lang="${lang === 'ar' ? 'ar' : 'en'}" style="${sheetStyle(inv)}"`;
  }

  /* ---------- blocks ---------- */
  function logoSrc(inv) {
    if (inv.company.logo === 'none') return '';
    const builtIn = (NB.embedded && NB.embedded.logo) || 'assets/logo.png';
    if (inv.company.logo === 'custom') return NB.store.getAsset('logo') || builtIn;
    return builtIn;
  }

  function header(inv) {
    const c = inv.company;
    const lang = langOf(inv);
    const src = logoSrc(inv);
    const logo = src ? `<div class="inv-logo"><img src="${esc(src)}" alt="${esc(c.name)} logo"></div>` : '';
    const nameAr = lang !== 'en' && c.nameAr ? `<p class="inv-company-ar" dir="rtl">${esc(c.nameAr)}</p>` : '';
    const name = lang === 'ar' ? '' : `<h2 class="inv-company-name">${esc(c.name)}</h2>`;
    const address = lang === 'ar' ? (c.addressAr || c.address) : c.address;
    const addressAr = lang === 'bi' && c.addressAr ? `<p class="t-ar" dir="rtl">${multiline(c.addressAr)}</p>` : '';
    const company = `<div class="inv-company">${name}${nameAr}<p dir="auto">${multiline(address)}</p>${addressAr}</div>`;
    const contacts = kvList(c.contacts, inv, 'inv-contacts', true);
    const layout = pick(inv.theme.headerLayout, ['classic', 'centered', 'banner'], 'classic');
    const side = pick(inv.theme.logoPosition, ['left', 'right'], 'right');
    const tagline = inv.sections.tagline && c.tagline ? `<p class="inv-tagline"><span>${esc(c.tagline)}</span></p>` : '';
    return `<header class="inv-head inv-head--${layout} logo-${side}">${logo}${company}${contacts}</header>${tagline}`;
  }

  function titleBlock(inv, en = inv.title, ar = inv.titleAr) {
    const style = pick(inv.theme.titleStyle, ['band', 'underline', 'plain', 'solid'], 'band');
    const align = pick(inv.theme.titleAlign, ['left', 'center', 'right'], 'center');
    return `<div class="inv-title inv-title--${style} align-${align}"><h1>${text(inv, en, ar)}</h1></div>`;
  }

  function customerBox(inv) {
    const c = inv.customer;
    const lang = langOf(inv);
    const heading = inv.customerHeading || inv.customerHeadingAr ? `<p class="inv-eyebrow">${text(inv, inv.customerHeading, inv.customerHeadingAr)}</p>` : '';
    const name = lang === 'ar' ? (c.nameAr || c.name) : c.name;
    const nameAr = lang === 'bi' && c.nameAr ? `<p class="inv-customer-ar" dir="rtl">${esc(c.nameAr)}</p>` : '';
    const address = lang === 'ar' ? (c.addressAr || c.address) : c.address;
    const addressAr = lang === 'bi' && c.addressAr ? `<p class="t-ar" dir="rtl">${multiline(c.addressAr)}</p>` : '';
    return `<div class="inv-customer">${heading}<p class="inv-customer-name" dir="auto">${esc(name)}</p>${nameAr}`
      + `<p dir="auto">${multiline(address)}</p>${addressAr}${kvList(c.contacts, inv, 'inv-kv-tight', true)}</div>`;
  }

  function parties(inv) {
    const customer = inv.sections.customer ? customerBox(inv) : '<div></div>';
    const metaRows = [{ label: inv.numberLabel, labelAr: inv.numberLabelAr, value: inv.number }, ...inv.meta];
    const meta = inv.sections.meta ? kvList(metaRows.filter((f) => f.label), inv, 'inv-meta') : '';
    return `<section class="inv-parties">${customer}${meta}</section>`;
  }

  const sectionTitle = (inv, en, ar) => (en || ar ? `<h3 class="inv-section-title">${text(inv, en, ar)}</h3>` : '');

  function shipment(inv) {
    if (!inv.sections.shipment) return '';
    const list = kvList(inv.shipment, inv, 'inv-grid2');
    return list ? `<section class="inv-shipment">${sectionTitle(inv, inv.shipmentTitle, inv.shipmentTitleAr)}${list}</section>` : '';
  }

  function cell(col, item, index, line, inv) {
    const d = calc.toNum(inv.currency.decimals);
    const g = inv.theme.grouping;
    const lang = langOf(inv);
    switch (col.key) {
      case 'no': return num(inv, String(index + 1));
      case 'desc': {
        if (lang === 'ar') return `<span dir="rtl">${multiline(item.descAr || item.desc)}</span>`;
        const ar = lang === 'bi' && item.descAr ? `<span class="t-ar" dir="rtl">${multiline(item.descAr)}</span>` : '';
        return `<span class="t-en" dir="auto">${multiline(item.desc)}</span>${ar}`;
      }
      case 'uom': return esc(item.uom);
      case 'qty': return num(inv, calc.formatNumber(item.qty, calc.toNum(inv.theme.qtyDecimals), g));
      case 'price': return num(inv, calc.formatNumber(item.price, d, g) + (inv.theme.priceWithCurrency ? ` ${inv.currency.code}` : ''));
      case 'discount': return calc.toNum(item.discount) ? num(inv, `${calc.toNum(item.discount)}%`) : '—';
      case 'tax': return calc.toNum(item.tax) ? num(inv, `${calc.toNum(item.tax)}%`) : '—';
      case 'amount': return num(inv, calc.formatNumber(line.net, d, g));
      default: return '';
    }
  }

  function itemsTable(inv, totals) {
    const cols = inv.columns.filter((c) => c.visible);
    const cur = (s) => String(s || '').replace('{CUR}', inv.currency.code);
    const width = (c) => (c.key !== 'desc' && calc.toNum(c.width) > 0 ? ` style="width:${clamp(c.width, 6, 120, 20)}mm"` : '');
    const head = cols.map((c) => `<th class="col-${esc(c.key)}" data-col="${esc(c.key)}"${width(c)}>${text(inv, cur(c.label), cur(c.labelAr))}</th>`).join('');
    const body = inv.items.map((item, i) => `<tr>${cols.map((c) => `<td class="col-${esc(c.key)}">${cell(c, item, i, totals.lines[i], inv)}</td>`).join('')}</tr>`).join('');
    const style = pick(inv.theme.tableStyle, ['grid', 'striped', 'minimal', 'boxed'], 'grid');
    return `<table class="inv-items inv-items--${style}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function totalsRows(inv, totals) {
    const t = inv.totals;
    const d = calc.toNum(inv.currency.decimals);
    const money = (n) => num(inv, calc.formatNumber(n, d, inv.theme.grouping));
    const row = (en, ar, value, cls = '') => `<tr class="${cls}"><th>${text(inv, en, ar)}</th><td>${value}</td></tr>`;
    const showPaid = inv.sections.payments && totals.paid > 0;
    const hasAdjustments = totals.discount || totals.lineTax || totals.tax || totals.charges.some((c) => c.amount) || showPaid;
    const rows = [];
    if (t.alwaysShowSubtotal || hasAdjustments) rows.push(row(t.subtotalLabel, t.subtotalLabelAr, money(totals.subtotal)));
    if (totals.discount) {
      const pct = t.discountType === 'percent' ? ` (${calc.toNum(t.discountValue)}%)` : '';
      rows.push(row(`${t.discountLabel}${pct}`, t.discountLabelAr ? `${t.discountLabelAr}${pct}` : '', `-${money(totals.discount)}`));
    }
    if (totals.lineTax) rows.push(row(t.lineTaxLabel, t.lineTaxLabelAr, money(totals.lineTax)));
    if (totals.tax) {
      const pct = ` (${calc.toNum(t.taxRate)}%)`;
      rows.push(row(`${t.taxLabel}${pct}`, t.taxLabelAr ? `${t.taxLabelAr}${pct}` : '', money(totals.tax)));
    }
    totals.charges.filter((c) => c.amount).forEach((c) => rows.push(row(c.label, c.labelAr, money(c.amount))));
    const code = `<small>${esc(inv.currency.code)}</small>`;
    if (showPaid) {
      rows.push(row(t.grandLabel, t.grandLabelAr, money(totals.total), 'is-sub'));
      rows.push(row(t.paidLabel, t.paidLabelAr, `-${money(totals.paid)}`));
      rows.push(row(t.balanceLabel, t.balanceLabelAr, `${money(totals.balance)} ${code}`, 'is-grand'));
    } else {
      rows.push(row(t.totalLabel, t.totalLabelAr, `${money(totals.total)} ${code}`, 'is-grand'));
    }
    return { html: `<table class="inv-totals">${rows.join('')}</table>`, amount: showPaid ? totals.balance : totals.total };
  }

  function amountWords(inv, amount) {
    if (!inv.sections.words) return '';
    const lang = langOf(inv);
    const safe = (fn) => {
      try { return esc(fn()); } catch (err) { return esc(err.message); }
    };
    const en = lang !== 'ar' ? `<p class="inv-words">${safe(() => words.amountToWords(amount, inv.currency, inv.words))}</p>` : '';
    const ar = lang !== 'en'
      ? `<p class="inv-words inv-words--ar" dir="rtl">${safe(() => wordsAr.amountToWords(amount, inv.currency, { template: inv.words.templateAr, minorTemplate: inv.words.minorTemplateAr }))}</p>`
      : '';
    return `<div class="inv-words-block">${en}${ar}</div>`;
  }

  function extras(inv) {
    const s = inv.sections;
    const f = inv.footer;
    const notes = s.notes && (f.notes || f.notesAr)
      ? `<div class="inv-note">${sectionTitle(inv, f.notesTitle, f.notesTitleAr)}<p>${text(inv, f.notes, f.notesAr, { lines: true })}</p></div>` : '';
    const bankList = s.bank ? kvList(inv.bank, inv, 'inv-kv-tight', true) : '';
    const bank = bankList ? `<div class="inv-bank">${sectionTitle(inv, f.bankTitle, f.bankTitleAr)}${bankList}</div>` : '';
    return notes || bank ? `<section class="inv-extras">${notes}${bank}</section>` : '';
  }

  function footer(inv) {
    const s = inv.sections;
    const f = inv.footer;
    const signature = s.signature ? `<div class="inv-sign"><div class="inv-sign-line"></div><span>${text(inv, f.signatureLabel, f.signatureLabelAr)}</span></div>` : '';
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const printed = s.printed
      ? `<div class="inv-printed"><span>${text(inv, 'Printed On', 'طبع في')} : ${num(inv, `${calc.formatDate(defaults.today(), inv.theme.dateFormat)}  ${time}`)}</span>`
        + `<span>${esc(f.preparedBy)}</span><span>${num(inv, inv.number)}</span></div>`
      : '';
    const warning = f.warning || f.warningAr ? `<p class="inv-warning">${text(inv, f.warning, f.warningAr, { lines: true })}</p>` : '';
    const terms = s.terms && (f.terms || f.termsAr || warning)
      ? `<div class="inv-terms"><p>${text(inv, f.terms, f.termsAr, { lines: true })}</p>${warning}</div>` : '';
    return `<footer class="inv-foot">${signature}${printed}${terms}</footer>`;
  }

  function containersBlock(inv) {
    const list = (inv.containers || []).filter((c) => c.number || c.size);
    if (!inv.sections.containers || !list.length) return '';
    const { CONTAINER_SIZES, containerSummary } = NB.documents;
    const g = inv.theme.grouping;
    const measure = (v) => (calc.toNum(v) ? num(inv, calc.formatNumber(v, 3, g)) : '');
    const sizeText = (size) => text(inv, (CONTAINER_SIZES[size] || [size])[0], (CONTAINER_SIZES[size] || [])[1]);
    const th = (en, ar, cls = '') => `<th class="${cls}">${text(inv, en, ar)}</th>`;
    const sum = containerSummary(list);
    const rows = list.map((c, i) => `<tr><td class="col-no">${num(inv, String(i + 1))}</td><td>${num(inv, c.number)}</td><td>${num(inv, c.seal)}</td>
      <td>${sizeText(c.size)}</td><td class="col-amount">${calc.toNum(c.packages) ? num(inv, String(calc.toNum(c.packages))) : ''}</td>
      <td class="col-amount">${measure(c.weight)}</td><td class="col-amount">${measure(c.volume)}</td></tr>`).join('');
    const total = `<tr class="is-total"><td></td><td colspan="3">${text(inv, sum.quantity, sum.quantityAr)}</td>
      <td class="col-amount">${sum.packages ? num(inv, String(sum.packages)) : ''}</td><td class="col-amount">${measure(sum.weight)}</td><td class="col-amount">${measure(sum.volume)}</td></tr>`;
    return `<section class="inv-containers">${sectionTitle(inv, 'Containers', 'الحاويات')}
      <table class="inv-items inv-items--grid inv-containers-table"><thead><tr>${th('No', 'م', 'col-no')}${th('Container No.', 'رقم الحاوية')}${th('Seal No.', 'رقم الختم')}
      ${th('Size / Type', 'الحجم / النوع')}${th('Packages', 'الطرود', 'col-amount')}${th('Weight (KG)', 'الوزن (كجم)', 'col-amount')}${th('Volume (CBM)', 'الحجم (م٣)', 'col-amount')}</tr></thead>
      <tbody>${rows}${list.length > 1 ? total : ''}</tbody></table></section>`;
  }

  function fxBlock(inv, amount) {
    const eq = NB.documents.equivalent(inv);
    if (!eq) return '';
    const g = inv.theme.grouping;
    const rate = `1 ${inv.currency.code} = ${calc.formatNumber(eq.rate, 6, g)} ${eq.base}`;
    const converted = `${calc.formatNumber(calc.round(amount * eq.rate, eq.decimals), eq.decimals, g)} ${eq.base}`;
    return `<section class="inv-fx"><span>${text(inv, 'Exchange rate', 'سعر الصرف')} : ${num(inv, rate)}</span>
      <span>${text(inv, `Equivalent in ${eq.base}`, `المعادل بعملة ${eq.base}`)} : <strong>${num(inv, converted)}</strong></span></section>`;
  }

  function stamp(inv) {
    const s = inv.stamp;
    if (!s || !s.show) return '';
    const builtIn = (NB.embedded && NB.embedded.stamp) || 'assets/stamp.png';
    const src = s.source === 'custom' ? (NB.store.getAsset('stamp') || builtIn) : builtIn;
    const style = [`--sx:${clamp(s.x, -20, 220, 22)}mm`, `--sy:${clamp(s.y, -20, 900, 222)}mm`, `--ss:${clamp(s.size, 15, 90, 36)}mm`,
      `--sr:${clamp(s.rotation, -180, 180, 0)}deg`, `--so:${clamp(s.opacity, 0.2, 1, 0.92)}`].join(';');
    return `<div class="inv-stamp" data-movable="stamp" tabindex="0" role="img" aria-label="Company stamp. Drag to move, arrow keys to nudge." style="${style}">`
      + `<img src="${esc(src)}" alt="" draggable="false"><span class="stamp-handle" data-stamp-resize aria-hidden="true"></span></div>`;
  }

  function qrCode(inv) {
    const q = inv.qr;
    if (!q || !q.show) return '';
    let svg;
    try {
      svg = NB.documents.qrSvg(NB.documents.qrPayload(inv));
    } catch (err) {
      svg = `<span class="qr-error">${esc(err.message)}</span>`;
    }
    const style = [`--sx:${clamp(q.x, -20, 220, 168)}mm`, `--sy:${clamp(q.y, -20, 900, 226)}mm`, `--ss:${clamp(q.size, 12, 70, 24)}mm`].join(';');
    const caption = q.caption || q.captionAr ? `<span class="qr-caption">${text(inv, q.caption, q.captionAr)}</span>` : '';
    return `<div class="inv-qr" data-movable="qr" tabindex="0" role="group" aria-label="QR code. Drag to move, arrow keys to nudge." style="${style}">`
      + `${svg}${caption}<span class="stamp-handle" data-stamp-resize aria-hidden="true"></span></div>`;
  }

  function invoice(inv) {
    const totals = calc.computeTotals(inv);
    const final = totalsRows(inv, totals);
    const watermark = inv.sections.watermark && inv.theme.watermarkText ? `<div class="inv-watermark" aria-hidden="true">${esc(inv.theme.watermarkText)}</div>` : '';
    const blocks = {
      header: header(inv), title: titleBlock(inv), parties: parties(inv), shipment: shipment(inv), containers: containersBlock(inv),
      lines: `<section class="inv-lines">${itemsTable(inv, totals)}${final.html}</section>`, fx: fxBlock(inv, final.amount),
      words: amountWords(inv, final.amount), extras: extras(inv), spacer: '', footer: footer(inv),
    };
    const body = defaults.normalizeLayout(inv.layout)
      .map((id) => ((blocks[id] || id === 'spacer') ? `<div class="blk${id === 'spacer' ? ' blk--spacer' : ''}" data-block="${id}">${blocks[id]}</div>` : ''))
      .join('');
    return `<article ${sheetAttrs(inv)}>${watermark}${body}${qrCode(inv)}${stamp(inv)}</article>`;
  }

  NB.render = { invoice, esc, multiline, text, num, kvList, sheetAttrs, header, titleBlock, customerBox, stamp, langOf };
})(window.NB = window.NB || {});
