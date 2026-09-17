/* Renders an invoice object into printable HTML. All user text is escaped. */
(function (NB) {
  'use strict';

  const { calc, words, defaults } = NB;
  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
  const multiline = (v) => esc(v).replace(/\n/g, '<br>');
  const safeColor = (v, fallback) => (/^#[0-9a-f]{3,8}$/i.test(String(v)) ? v : fallback);
  const safeFont = (v, fallback) => (defaults.FONTS.includes(v) ? v : fallback);
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

  function logoSrc(inv) {
    if (inv.company.logo === 'none') return '';
    if (inv.company.logo === 'custom') return NB.store.getAsset('logo') || 'assets/logo.png';
    return 'assets/logo.png';
  }

  function fieldValue(field, inv) {
    return field.type === 'date' ? calc.formatDate(field.value, inv.theme.dateFormat) : field.value;
  }

  function kvList(list, inv, className = '') {
    const rows = (list || [])
      .filter((f) => (inv.sections.hideEmpty ? String(f.value ?? '').trim() : f.label || f.value))
      .map((f) => `<div class="kv${f.wide ? ' kv--wide' : ''}"><dt>${esc(f.label)}</dt>`
        + `<dd dir="auto">${f.label ? '<i>:</i>' : ''}<span>${multiline(fieldValue(f, inv))}</span></dd></div>`)
      .join('');
    return rows ? `<dl class="${className}">${rows}</dl>` : '';
  }

  function sheetStyle(inv) {
    const t = inv.theme;
    const fallback = defaults.THEME_PRESETS['Navy & Gold'];
    const vars = {
      '--inv-primary': safeColor(t.primary, fallback.primary),
      '--inv-accent': safeColor(t.accent, fallback.accent),
      '--inv-text': safeColor(t.text, fallback.text),
      '--inv-head-fill': safeColor(t.headFill, fallback.headFill),
      '--inv-head-text': safeColor(t.headText, fallback.headText),
      '--inv-band': safeColor(t.band, fallback.band),
      '--inv-body-font': `'${safeFont(t.bodyFont, 'Inter')}'`,
      '--inv-heading-font': `'${safeFont(t.headingFont, 'Cinzel')}'`,
      '--inv-size': `${Math.min(Math.max(calc.toNum(t.baseSize) || 9, 6), 14)}pt`,
      '--inv-logo-h': `${Math.min(Math.max(calc.toNum(t.logoHeight) || 30, 8), 80)}mm`,
      '--inv-margin': `${Math.min(Math.max(calc.toNum(t.margin), 0), 30)}mm`,
      '--inv-radius': `${Math.min(Math.max(calc.toNum(t.radius), 0), 12)}px`,
    };
    return Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
  }

  function header(inv) {
    const src = logoSrc(inv);
    const logo = src ? `<div class="inv-logo"><img src="${esc(src)}" alt="${esc(inv.company.name)} logo"></div>` : '';
    const company = `<div class="inv-company"><h2 class="inv-company-name" dir="auto">${esc(inv.company.name)}</h2>`
      + `<p dir="auto">${multiline(inv.company.address)}</p></div>`;
    const contacts = kvList(inv.company.contacts, { ...inv, sections: { hideEmpty: true } }, 'inv-contacts');
    const layout = pick(inv.theme.headerLayout, ['classic', 'centered', 'banner'], 'classic');
    const side = pick(inv.theme.logoPosition, ['left', 'right'], 'right');
    const tagline = inv.sections.tagline && inv.company.tagline
      ? `<p class="inv-tagline"><span>${esc(inv.company.tagline)}</span></p>` : '';
    return `<header class="inv-head inv-head--${layout} logo-${side}">${logo}${company}${contacts}</header>${tagline}`;
  }

  function titleBlock(inv) {
    const style = pick(inv.theme.titleStyle, ['band', 'underline', 'plain', 'solid'], 'band');
    const align = pick(inv.theme.titleAlign, ['left', 'center', 'right'], 'center');
    return `<div class="inv-title inv-title--${style} align-${align}"><h1 dir="auto">${esc(inv.title)}</h1></div>`;
  }

  function parties(inv) {
    const s = inv.sections;
    const c = inv.customer;
    const customer = s.customer ? `<div class="inv-customer">`
      + (inv.customerHeading ? `<p class="inv-eyebrow">${esc(inv.customerHeading)}</p>` : '')
      + `<p class="inv-customer-name" dir="auto">${esc(c.name)}</p><p dir="auto">${multiline(c.address)}</p>`
      + `${kvList(c.contacts, { ...inv, sections: { hideEmpty: true } }, 'inv-kv-tight')}</div>` : '<div></div>';
    const metaRows = [{ label: inv.numberLabel, value: inv.number }, ...inv.meta];
    const meta = s.meta ? kvList(metaRows.filter((f) => f.label), inv, 'inv-meta') : '';
    return `<section class="inv-parties">${customer}${meta}</section>`;
  }

  function shipment(inv) {
    if (!inv.sections.shipment) return '';
    const list = kvList(inv.shipment, inv, 'inv-grid2');
    if (!list) return '';
    return `<section class="inv-shipment">${inv.shipmentTitle ? `<h3 class="inv-section-title">${esc(inv.shipmentTitle)}</h3>` : ''}${list}</section>`;
  }

  function cell(col, item, index, line, inv) {
    const d = calc.toNum(inv.currency.decimals);
    const g = inv.theme.grouping;
    switch (col.key) {
      case 'no': return String(index + 1);
      case 'desc': return `<span dir="auto">${multiline(item.desc)}</span>`;
      case 'uom': return esc(item.uom);
      case 'qty': return esc(calc.formatNumber(item.qty, calc.toNum(inv.theme.qtyDecimals), g));
      case 'price': return esc(calc.formatNumber(item.price, d, g) + (inv.theme.priceWithCurrency ? ` ${inv.currency.code}` : ''));
      case 'discount': return calc.toNum(item.discount) ? `${esc(calc.toNum(item.discount))}%` : '—';
      case 'tax': return calc.toNum(item.tax) ? `${esc(calc.toNum(item.tax))}%` : '—';
      case 'amount': return esc(calc.formatNumber(line.net, d, g));
      default: return '';
    }
  }

  function itemsTable(inv, totals) {
    const cols = inv.columns.filter((c) => c.visible);
    const label = (c) => esc(String(c.label).replace('{CUR}', inv.currency.code));
    const head = cols.map((c) => `<th class="col-${esc(c.key)}">${label(c)}</th>`).join('');
    const body = inv.items.map((item, i) => `<tr>${cols.map((c) => `<td class="col-${esc(c.key)}">${cell(c, item, i, totals.lines[i], inv)}</td>`).join('')}</tr>`).join('');
    const style = pick(inv.theme.tableStyle, ['grid', 'striped', 'minimal', 'boxed'], 'grid');
    return `<table class="inv-items inv-items--${style}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function totalsBlock(inv, totals) {
    const t = inv.totals;
    const d = calc.toNum(inv.currency.decimals);
    const money = (n) => esc(calc.formatNumber(n, d, inv.theme.grouping));
    const row = (label, value, cls = '') => `<tr class="${cls}"><th>${esc(label)}</th><td>${value}</td></tr>`;
    const hasAdjustments = totals.discount || totals.lineTax || totals.tax || totals.charges.some((c) => c.amount) || totals.paid;
    const rows = [];
    if (t.alwaysShowSubtotal || hasAdjustments) rows.push(row(t.subtotalLabel, money(totals.subtotal)));
    if (totals.discount) {
      const pct = t.discountType === 'percent' ? ` (${calc.toNum(t.discountValue)}%)` : '';
      rows.push(row(`${t.discountLabel}${pct}`, `-${money(totals.discount)}`));
    }
    if (totals.lineTax) rows.push(row(t.lineTaxLabel, money(totals.lineTax)));
    if (totals.tax) rows.push(row(`${t.taxLabel} (${calc.toNum(t.taxRate)}%)`, money(totals.tax)));
    totals.charges.filter((c) => c.amount).forEach((c) => rows.push(row(c.label, money(c.amount))));
    if (totals.paid) {
      rows.push(row(t.grandLabel, money(totals.total), 'is-sub'));
      rows.push(row(t.paidLabel, `-${money(totals.paid)}`));
    }
    rows.push(row(`${t.totalLabel}`, `${money(totals.balance)} <small>${esc(inv.currency.code)}</small>`, 'is-grand'));
    return `<table class="inv-totals">${rows.join('')}</table>`;
  }

  function amountWords(inv, totals) {
    if (!inv.sections.words) return '';
    try {
      return `<p class="inv-words">${esc(words.amountToWords(totals.balance, inv.currency, inv.words))}</p>`;
    } catch (err) {
      return `<p class="inv-words is-error">${esc(err.message)}</p>`;
    }
  }

  function extras(inv) {
    const s = inv.sections;
    const f = inv.footer;
    const notes = s.notes && f.notes ? `<div class="inv-note"><h4 class="inv-section-title">${esc(f.notesTitle)}</h4><p dir="auto">${multiline(f.notes)}</p></div>` : '';
    const bankList = s.bank ? kvList(inv.bank, { ...inv, sections: { hideEmpty: true } }, 'inv-kv-tight') : '';
    const bank = bankList ? `<div class="inv-bank"><h4 class="inv-section-title">${esc(f.bankTitle)}</h4>${bankList}</div>` : '';
    return notes || bank ? `<section class="inv-extras">${notes}${bank}</section>` : '';
  }

  function footer(inv) {
    const s = inv.sections;
    const f = inv.footer;
    const stamp = s.stamp && NB.store.getAsset('stamp') ? `<img class="inv-stamp" src="${esc(NB.store.getAsset('stamp'))}" alt="Stamp">` : '';
    const signature = s.signature ? `<div class="inv-sign"><div class="inv-sign-line">${stamp}</div><span dir="auto">${esc(f.signatureLabel)}</span></div>` : '';
    const now = new Date();
    const printedAt = `${calc.formatDate(defaults.today(), inv.theme.dateFormat)} &nbsp; ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const printed = s.printed ? `<div class="inv-printed"><span>Printed On : ${printedAt}</span><span>${esc(f.preparedBy)}</span><span>${esc(inv.number)}</span></div>` : '';
    const terms = s.terms && (f.terms || f.warning)
      ? `<div class="inv-terms"><p dir="auto">${multiline(f.terms)}</p>${f.warning ? `<p class="inv-warning" dir="auto">${multiline(f.warning)}</p>` : ''}</div>` : '';
    return `<footer class="inv-foot">${signature}${printed}${terms}</footer>`;
  }

  function invoice(inv) {
    const totals = calc.computeTotals(inv);
    const t = inv.theme;
    const classes = [
      'sheet', `paper-${pick(t.paper, ['A4', 'Letter'], 'A4')}`, `density-${pick(t.density, ['compact', 'normal', 'airy'], 'normal')}`,
      t.goldRules ? 'has-rules' : '', inv.sections.pageGuides ? 'has-guides' : '',
    ].filter(Boolean).join(' ');
    const watermark = inv.sections.watermark && t.watermarkText ? `<div class="inv-watermark" aria-hidden="true">${esc(t.watermarkText)}</div>` : '';
    return `<article class="${classes}" style="${sheetStyle(inv)}">${watermark}`
      + `${header(inv)}${titleBlock(inv)}${parties(inv)}${shipment(inv)}`
      + `<section class="inv-lines">${itemsTable(inv, totals)}${totalsBlock(inv, totals)}</section>`
      + `${amountWords(inv, totals)}${extras(inv)}<div class="inv-spacer"></div>${footer(inv)}</article>`;
  }

  NB.render = { invoice, esc, multiline };
})(window.NB = window.NB || {});
