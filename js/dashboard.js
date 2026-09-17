/* Dashboard view: KPI tiles, monthly invoiced vs collected, top customers and ageing — all in the base currency. */
(function (NB) {
  'use strict';

  const { calc, ledger, ui } = NB;
  const { esc } = ui;
  const $ = (sel) => document.querySelector(sel);

  const PERIODS = [['month', 'This Month'], ['quarter', 'This Quarter'], ['year', 'This Year'], ['12m', 'Last 12 Months']];
  const AGEING_LABELS = { current: 'Not yet due', '1-30': '1–30 days', '31-60': '31–60 days', '60+': 'Over 60 days' };
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const CHART = { width: 720, height: 250, top: 16, right: 12, bottom: 28, left: 56 };
  const BAR_GAP = 2;

  let ctx = null;
  let period = 'year';
  let lastData = null;

  function periodStart(today) {
    const [y, m] = today.split('-').map(Number);
    if (period === 'month') return `${today.slice(0, 7)}-01`;
    if (period === 'quarter') return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
    if (period === 'year') return `${y}-01-01`;
    return new Date(Date.UTC(y, m - 12, 1)).toISOString().slice(0, 10);
  }

  const niceMax = (value) => {
    if (value <= 0) return 1;
    const exp = 10 ** Math.floor(Math.log10(value));
    return [1, 2, 2.5, 5, 10].map((f) => f * exp).find((v) => v >= value);
  };
  const compact = (n) => {
    const abs = Math.abs(n);
    if (abs >= 1e6) return `${calc.round(n / 1e6, 1)}M`;
    if (abs >= 1e3) return `${calc.round(n / 1e3, 1)}K`;
    return String(calc.round(n, 0));
  };
  const monthLabel = (key, withYear = false) => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]}${withYear ? ` ${key.slice(0, 4)}` : ''}`;

  function barUp(x, y, w, h) {
    if (h <= 0) return '';
    const r = Math.min(4, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function barRight(x, y, w, h) {
    if (w <= 0) return '';
    const r = Math.min(4, h / 2, w);
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }

  /* ---------- pieces ---------- */
  function tiles(data, fmt) {
    const k = data.kpis;
    const tile = (label, value, sub = '', cls = '') => `<div class="kpi ${cls}"><span class="kpi-label">${esc(label)}</span><strong class="kpi-value">${esc(fmt(value))}<small>${esc(data.base)}</small></strong>${sub ? `<span class="kpi-sub">${sub}</span>` : ''}</div>`;
    return `<div class="kpis">
      ${tile('Invoiced', k.invoiced)}
      ${tile('Collected', k.collected, k.invoiced ? `${Math.round((k.collected / k.invoiced) * 100)}% of invoiced` : '')}
      ${tile('Outstanding', k.outstanding, 'All open invoices')}
      ${tile('Overdue', k.overdue, k.overdue ? '<i class="status-dot" aria-hidden="true"></i> Needs follow-up' : 'Nothing overdue', k.overdue ? 'kpi--alert' : '')}
      ${tile('Profit', k.profit, k.revenue ? `${k.margin}% margin on costed invoices` : 'Add line costs to track profit')}
    </div>`;
  }

  function monthlyChart(data, fmt) {
    const { width, height, top, right, bottom, left } = CHART;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const max = niceMax(Math.max(...data.monthly.flatMap((m) => [m.invoiced, m.collected]), 0));
    const y = (v) => top + plotH - (Math.max(v, 0) / max) * plotH;
    const slot = plotW / data.monthly.length;
    const barW = Math.max(4, Math.min(16, (slot - 10) / 2));
    const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => max * f);

    const grid = ticks.map((t) => `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${left - 8}" y="${y(t) + 4}" text-anchor="end">${esc(compact(t))}</text>`).join('');
    const groups = data.monthly.map((m, i) => {
      const cx = left + slot * i + slot / 2;
      const x1 = cx - barW - BAR_GAP / 2;
      const x2 = cx + BAR_GAP / 2;
      return `<g class="month" data-index="${i}">
        <rect class="hit" x="${left + slot * i}" y="${top}" width="${slot}" height="${plotH}"/>
        <path class="bar s1" d="${barUp(x1, y(m.invoiced), barW, top + plotH - y(m.invoiced))}"/>
        <path class="bar s2" d="${barUp(x2, y(m.collected), barW, top + plotH - y(m.collected))}"/>
        <text class="axis" x="${cx}" y="${height - 8}" text-anchor="middle">${esc(monthLabel(m.month))}</text></g>`;
    }).join('');
    const table = `<table class="viz-table"><thead><tr><th>Month</th><th class="num">Invoiced</th><th class="num">Collected</th></tr></thead>
      <tbody>${data.monthly.map((m) => `<tr><td>${esc(monthLabel(m.month, true))}</td><td class="num">${esc(fmt(m.invoiced))}</td><td class="num">${esc(fmt(m.collected))}</td></tr>`).join('')}</tbody></table>`;

    return `<section class="card card--wide" aria-labelledby="chart-monthly">
      <header class="card-head"><h2 id="chart-monthly">Invoiced vs collected</h2><span class="card-sub">Last 12 months · ${esc(data.base)}</span>
        <ul class="legend" role="list"><li><i class="swatch s1"></i>Invoiced</li><li><i class="swatch s2"></i>Collected</li></ul></header>
      <div class="chart" data-chart="monthly">
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly invoiced and collected amounts for the last 12 months">${grid}<line class="baseline" x1="${left}" x2="${width - right}" y1="${top + plotH}" y2="${top + plotH}"/>${groups}</svg>
        <div class="tooltip" role="status" hidden></div>
      </div>
      <details class="viz-details"><summary>View as table</summary>${table}</details>
    </section>`;
  }

  function hbarCard(id, title, sub, rows, fmt, empty) {
    if (!rows.length) return `<section class="card" aria-labelledby="${id}"><header class="card-head"><h2 id="${id}">${esc(title)}</h2><span class="card-sub">${esc(sub)}</span></header><p class="card-empty">${esc(empty)}</p></section>`;
    const max = Math.max(...rows.map((r) => r.value), 0) || 1;
    const bars = rows.map((r) => `<li class="hbar">
        <span class="hbar-label">${r.href ? `<a href="${esc(r.href)}">${esc(r.label)}</a>` : esc(r.label)}</span>
        <svg class="hbar-track" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><path class="bar s1" d="${barRight(0, 0, Math.max(0, (r.value / max) * 100), 10)}"/></svg>
        <span class="hbar-value">${esc(fmt(r.value))}${r.note ? `<small>${esc(r.note)}</small>` : ''}</span></li>`).join('');
    return `<section class="card" aria-labelledby="${id}"><header class="card-head"><h2 id="${id}">${esc(title)}</h2><span class="card-sub">${esc(sub)}</span></header>
      <ul class="hbars" role="list">${bars}</ul></section>`;
  }

  /* ---------- render ---------- */
  function render() {
    const today = ctx.today();
    const base = ctx.settings().baseCurrency || 'KWD';
    const decimals = calc.toNum((NB.defaults.CURRENCIES[base] || {}).decimals ?? 3);
    const data = ledger.dashboard(ctx.ledgerInvoices(), { today, base, baseDecimals: decimals, from: periodStart(today) });
    lastData = data;
    const fmt = (n) => calc.formatNumber(n, decimals);

    $('#dashboard-period').innerHTML = PERIODS.map(([id, label]) => `<button type="button" role="radio" data-period="${id}" aria-checked="${id === period}">${label}</button>`).join('');
    $('#dashboard-subtitle').textContent = `${data.count} document${data.count === 1 ? '' : 's'} · amounts in ${base}`;

    const notice = data.unconverted
      ? `<p class="notice">${data.unconverted} document${data.unconverted === 1 ? ' is' : 's are'} in another currency without an exchange rate to ${esc(base)} and not included. Add a rate under Items → Exchange Rate.</p>` : '';
    const customers = data.topCustomers.map((c) => ({ label: c.name, value: c.invoiced, note: c.outstanding ? `${fmt(c.outstanding)} open` : '', href: `#/customers/${encodeURIComponent(c.key)}` }));
    const ageingRows = Object.entries(AGEING_LABELS).map(([key, label]) => ({ label, value: data.ageing[key] }));
    const hasAgeing = ageingRows.some((r) => r.value);
    const periodName = PERIODS.find((p) => p[0] === period)[1].toLowerCase();

    $('#dashboard-body').innerHTML = `${notice}${tiles(data, fmt)}
      <div class="cards">${monthlyChart(data, fmt)}
        ${hbarCard('chart-customers', 'Top customers', `Invoiced · ${periodName}`, customers, fmt, 'No invoiced customers in this period.')}
        ${hbarCard('chart-ageing', 'Ageing of unpaid amounts', 'Days past due date', hasAgeing ? ageingRows : [], fmt, 'Nothing outstanding.')}
      </div>`;
  }

  /* ---------- tooltips ---------- */
  function hideTips() {
    document.querySelectorAll('[data-chart] .tooltip').forEach((t) => { t.hidden = true; });
    document.querySelectorAll('.month.is-hover').forEach((g) => g.classList.remove('is-hover'));
  }

  function onPointerMove(e) {
    const chart = e.target.closest('[data-chart="monthly"]');
    const group = e.target.closest('.month');
    if (!chart || !group || !lastData) {
      hideTips();
      return;
    }
    document.querySelectorAll('.month.is-hover').forEach((g) => { if (g !== group) g.classList.remove('is-hover'); });
    const m = lastData.monthly[Number(group.dataset.index)];
    const decimals = calc.toNum((NB.defaults.CURRENCIES[lastData.base] || {}).decimals ?? 3);
    const tip = chart.querySelector('.tooltip');
    group.classList.add('is-hover');
    tip.innerHTML = `<strong>${esc(monthLabel(m.month, true))}</strong><span><i class="swatch s1"></i>Invoiced <b>${esc(calc.formatNumber(m.invoiced, decimals))}</b></span><span><i class="swatch s2"></i>Collected <b>${esc(calc.formatNumber(m.collected, decimals))}</b></span>`;
    tip.hidden = false;
    const box = chart.getBoundingClientRect();
    const x = Math.min(e.clientX - box.left + 14, box.width - tip.offsetWidth - 4);
    tip.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, e.clientY - box.top - tip.offsetHeight - 10)}px)`;
  }

  function mount(context) {
    ctx = context;
    $('#dashboard-period').addEventListener('click', (e) => {
      const b = e.target.closest('[data-period]');
      if (!b) return;
      period = b.dataset.period;
      render();
    });
    $('#dashboard-body').addEventListener('pointermove', onPointerMove);
    $('#dashboard-body').addEventListener('pointerleave', hideTips);
  }

  NB.dashboard = { mount, render };
})(window.NB = window.NB || {});
