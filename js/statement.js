/* Renders a printable statement of account using the current invoice's branding. */
(function (NB) {
  'use strict';

  const { calc, render } = NB;
  const { esc, text, num } = render;

  const TYPE_LABELS = { invoice: ['Invoice', 'فاتورة'], 'credit-note': ['Credit note', 'إشعار دائن'], payment: ['Payment', 'دفعة'] };
  const AGEING_LABELS = { current: ['Not yet due', 'غير مستحق'], '1-30': ['1–30 days', '١–٣٠ يوم'], '31-60': ['31–60 days', '٣١–٦٠ يوم'], '60+': ['Over 60 days', 'أكثر من ٦٠ يوم'] };

  function statementSheet({ brand, customer, statement: st, today }) {
    const lang = render.langOf(brand);
    const d = st.decimals;
    const money = (n) => (n ? num(brand, calc.formatNumber(n, d, brand.theme.grouping)) : '');
    const signed = (n) => num(brand, calc.formatNumber(n, d, brand.theme.grouping));
    const date = (iso) => num(brand, calc.formatDate(iso, lang === 'ar' ? 'DD/MM/YYYY' : brand.theme.dateFormat));
    const th = (en, ar, cls = '') => `<th class="${cls}">${text(brand, en, ar)}</th>`;

    const period = st.from || st.to
      ? `${st.from ? calc.formatDate(st.from, brand.theme.dateFormat) : '…'} – ${st.to ? calc.formatDate(st.to, brand.theme.dateFormat) : calc.formatDate(today, brand.theme.dateFormat)}`
      : (lang === 'ar' ? 'جميع الحركات' : 'All transactions');
    const meta = render.kvList([
      { label: 'Statement Date', labelAr: 'تاريخ الكشف', value: today, type: 'date' },
      { label: 'Period', labelAr: 'الفترة', value: period },
      { label: 'Currency', labelAr: 'العملة', value: st.currency },
      { label: 'Closing Balance', labelAr: 'الرصيد الختامي', value: calc.formatNumber(st.closing, d, brand.theme.grouping) },
    ], brand, 'inv-meta', false);
    const customerView = render.customerBox({
      ...brand,
      customerHeading: 'Statement For', customerHeadingAr: 'كشف حساب لـ',
      customer: { name: customer.name, nameAr: customer.nameAr || '', address: customer.address || '', addressAr: customer.addressAr || '', contacts: customer.contacts || [] },
    });

    const opening = st.from
      ? `<tr class="st-opening"><td class="col-date">${date(st.from)}</td><td colspan="3">${text(brand, 'Opening balance', 'الرصيد الافتتاحي')}</td><td></td><td></td><td class="col-amount">${signed(st.opening)}</td></tr>`
      : '';
    const rows = st.rows.map((r) => `<tr class="st-${esc(r.type)}">
        <td class="col-date">${date(r.date)}</td><td>${text(brand, ...TYPE_LABELS[r.type])}</td><td>${num(brand, r.ref)}</td>
        <td class="col-desc" dir="auto">${esc(r.description)}</td><td class="col-amount">${money(r.debit)}</td>
        <td class="col-amount">${money(r.credit)}</td><td class="col-amount">${signed(r.balance)}</td></tr>`).join('');
    const empty = !st.rows.length ? `<tr><td colspan="7" class="st-empty">${text(brand, 'No transactions in this period.', 'لا توجد حركات في هذه الفترة.')}</td></tr>` : '';

    const ageingTotal = calc.round(Object.values(st.ageing).reduce((a, b) => a + b, 0), d);
    const ageing = `<table class="inv-items inv-items--grid st-ageing"><thead><tr>
        ${Object.values(AGEING_LABELS).map(([en, ar]) => th(en, ar, 'col-amount')).join('')}${th('Total due', 'إجمالي المستحق', 'col-amount')}</tr></thead>
        <tbody><tr>${Object.keys(AGEING_LABELS).map((k) => `<td class="col-amount">${signed(st.ageing[k])}</td>`).join('')}
        <td class="col-amount"><strong>${signed(ageingTotal)}</strong></td></tr></tbody></table>`;

    return `<article ${render.sheetAttrs(brand, 'is-statement')}>
      ${render.header(brand)}${render.titleBlock(brand, 'STATEMENT OF ACCOUNT', 'كشف حساب')}
      <section class="inv-parties">${customerView}${meta}</section>
      <table class="inv-items inv-items--${esc(brand.theme.tableStyle)} st-table"><thead><tr>
        ${th('Date', 'التاريخ', 'col-date')}${th('Type', 'النوع')}${th('Reference', 'المرجع')}${th('Description', 'البيان', 'col-desc')}
        ${th('Debit', 'مدين', 'col-amount')}${th('Credit', 'دائن', 'col-amount')}${th('Balance', 'الرصيد', 'col-amount')}</tr></thead>
        <tbody>${opening}${rows}${empty}</tbody></table>
      <table class="inv-totals st-totals">
        <tr><th>${text(brand, 'Total debits', 'إجمالي المدين')}</th><td>${signed(st.totalDebit)}</td></tr>
        <tr><th>${text(brand, 'Total credits', 'إجمالي الدائن')}</th><td>${signed(st.totalCredit)}</td></tr>
        <tr class="is-grand"><th>${text(brand, 'Closing balance', 'الرصيد الختامي')}</th><td>${signed(st.closing)} <small>${esc(st.currency)}</small></td></tr>
      </table>
      <h3 class="inv-section-title st-ageing-title">${text(brand, 'Ageing of amounts due', 'أعمار الأرصدة المستحقة')}</h3>
      ${ageing}
      <div class="inv-spacer"></div>
      <footer class="inv-foot"><div class="inv-terms"><p>${text(brand, 'Please report any discrepancy within 14 days of the statement date.', 'يرجى إبلاغنا بأي اختلاف خلال ١٤ يوماً من تاريخ الكشف.')}</p></div></footer>
      ${render.stamp(brand)}
    </article>`;
  }

  NB.statement = { statementSheet };
})(window.NB = window.NB || {});
