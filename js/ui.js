/* Shared UI primitives: form builders bound to state paths, icons, status pills, HUD, confirmations. */
(function (NB) {
  'use strict';

  const { esc } = NB.render;
  const CONFIRM_WINDOW_MS = 4000;

  const ICONS = {
    up: '<path d="M8 13V3M4 7l4-4 4 4"/>',
    down: '<path d="M8 3v10M4 9l4 4 4-4"/>',
    copy: '<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10.5V3.5A1.5 1.5 0 0 1 4.5 2h6"/>',
    trash: '<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4"/>',
    star: '<path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/>',
    plus: '<path d="M8 3v10M3 8h10"/>',
    doc: '<path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13M6 8h5M6 10.5h5"/>',
    people: '<circle cx="6" cy="5.5" r="2.5"/><path d="M1.5 14c.5-2.7 2.2-4 4.5-4s4 1.3 4.5 4"/>',
    tag: '<path d="M8.6 1.5h5.9v5.9L7.4 14.5 1.5 8.6z"/><circle cx="11.3" cy="4.7" r="1"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  const STATUS_LABELS = {
    draft: 'Draft', unpaid: 'Unpaid', partial: 'Part paid', overdue: 'Overdue', paid: 'Paid', overpaid: 'Overpaid', cancelled: 'Cancelled', issued: 'Issued', converted: 'Converted', credit: 'Credit note',
  };
  const statusPill = (status) => `<span class="pill pill--${esc(status)}">${esc(STATUS_LABELS[status] || status)}</span>`;

  const getIn = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  let source = () => ({});
  const bind = (getter) => { source = getter; };

  function attrs(path, o = {}) {
    return [`data-path="${esc(path)}"`, o.kind ? `data-kind="${o.kind}"` : '', o.rerender ? 'data-rerender' : '',
      o.placeholder ? `placeholder="${esc(o.placeholder)}"` : '', o.dir ? `dir="${o.dir}"` : '', o.list ? `list="${o.list}"` : '',
      o.step != null ? `step="${o.step}"` : '', o.min != null ? `min="${o.min}"` : '', o.max != null ? `max="${o.max}"` : '',
      o.aria ? `aria-label="${esc(o.aria)}"` : '', o.id ? `id="${esc(o.id)}"` : '', o.cls ? `class="${o.cls}"` : '',
      o.extra || ''].filter(Boolean).join(' ');
  }

  function input(path, o = {}) {
    const type = o.type || 'text';
    const kind = ['number', 'range'].includes(type) ? 'num' : o.kind;
    return `<input type="${type}" ${attrs(path, { ...o, kind })} value="${esc(getIn(source(), path) ?? '')}">`;
  }
  const textarea = (path, o = {}) => `<textarea rows="${o.rows || 2}" ${attrs(path, o)}>${esc(getIn(source(), path) ?? '')}</textarea>`;
  function select(path, pairs, o = {}) {
    const current = String(getIn(source(), path) ?? '');
    const options = pairs.map(([v, l]) => `<option value="${esc(v)}"${String(v) === current ? ' selected' : ''}>${esc(l)}</option>`).join('');
    return `<select ${attrs(path, o)}>${options}</select>`;
  }
  const switchEl = (path, o = {}) => `<span class="switch"><input type="checkbox" role="switch" ${attrs(path, { ...o, kind: 'bool' })}${getIn(source(), path) ? ' checked' : ''}><i aria-hidden="true"></i></span>`;

  let uidCounter = 0;
  const nextId = () => `f${(uidCounter += 1)}`;

  // Gives a control an id for its <label>, reusing one it already has (a second id attribute would be ignored).
  function labelled(control) {
    const existing = /^<(?:input|select|textarea)\b[^>]*?\sid="([^"]+)"/.exec(control);
    if (existing) return { id: existing[1], html: control };
    const id = nextId();
    return { id, html: control.replace(/^<(input|select|textarea)/, `<$1 id="${id}"`) };
  }

  // Label + control on one line, like System Settings.
  function row(label, control, { hint = '' } = {}) {
    const { id, html } = labelled(control);
    return `<div class="row"><label for="${id}">${esc(label)}</label><div class="row-control">${html}${hint}</div></div>`;
  }
  const rowToggle = (label, path, o) => {
    const id = nextId();
    return `<div class="row row--toggle"><label for="${id}">${esc(label)}</label>${switchEl(path, { ...o, id })}</div>`;
  };
  function stack(label, control) {
    const { id, html } = labelled(control);
    return `<div class="stack"><label for="${id}">${esc(label)}</label>${html}</div>`;
  }
  const group = (title, body, { foot = '', action = '' } = {}) => `<section class="group">
      ${title || action ? `<div class="group-head"><h3 class="group-title">${esc(title)}</h3>${action}</div>` : ''}
      <div class="group-box">${body}</div>${foot ? `<p class="group-foot">${foot}</p>` : ''}</section>`;

  const tool = (iconName, act, data, label, danger = false) => `<button type="button" class="tool${danger ? ' tool--danger' : ''}" data-act="${act}" aria-label="${esc(label)}" title="${esc(label)}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${icon(iconName)}</button>`;
  const rowTools = (path, index, extra = '') => `<div class="row-tools">${extra}${tool('up', 'up', { path, index }, 'Move up')}${tool('down', 'down', { path, index }, 'Move down')}${tool('copy', 'dup', { path, index }, 'Duplicate')}${tool('trash', 'remove', { path, index }, 'Remove', true)}</div>`;

  /* ---------- HUD & confirmation ---------- */
  function toast(message, tone = 'ok') {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.dataset.tone = tone;
    el.classList.remove('is-shown');
    void el.offsetWidth;
    el.classList.add('is-shown');
  }

  let pending = null;
  function confirmTwice(key, message) {
    const now = Date.now();
    if (pending && pending.key === key && now - pending.at < CONFIRM_WINDOW_MS) {
      pending = null;
      return true;
    }
    pending = { key, at: now };
    toast(message);
    return false;
  }

  function readValue(el) {
    if (el.dataset.kind === 'bool') return el.checked;
    if (el.dataset.kind === 'num') return el.value === '' ? '' : Number(el.value);
    return el.value;
  }

  NB.ui = {
    esc, icon, statusPill, STATUS_LABELS, getIn, bind, input, textarea, select, switchEl, row, rowToggle, stack, group,
    tool, rowTools, toast, confirmTwice, readValue,
  };
})(window.NB = window.NB || {});
