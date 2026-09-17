/* Preview canvas: renders a sheet, handles zoom, and lets the stamp be dragged, resized and nudged. */
(function (NB) {
  'use strict';

  const PX_PER_MM = 96 / 25.4;
  const SHEET_WIDTH_MM = { A4: 210, Letter: 215.9 };
  const ZOOM_STEP = 0.1;
  const NUDGE_MM = 1;
  const NUDGE_FAST_MM = 5;
  const STAMP_LIMITS = { x: [-20, 220], y: [-20, 900], size: [15, 90] };
  const clamp = (v, [min, max]) => Math.min(Math.max(v, min), max);
  const snap = (v) => Math.round(v * 2) / 2;

  function create(root, opts = {}) {
    const scroll = root.querySelector('.canvas-scroll');
    const zoomEl = root.querySelector('.canvas-zoom');
    const host = root.querySelector('.canvas-host');
    let zoom = 1;
    let paper = 'A4';
    let refocusStamp = false;
    let drag = null;
    let arranging = false;
    let layoutDrag = null;
    let colDrag = null;
    const BLOCK_LABELS = Object.fromEntries((NB.defaults.LAYOUT_BLOCKS || []).map(([id, label]) => [id, label]));
    const COLUMN_LIMITS = [6, 120];

    function applyZoom() {
      const pref = opts.getZoom ? opts.getZoom() : 0;
      const available = scroll.clientWidth - 56;
      const fit = Math.min(1.5, Math.max(0.3, available / ((SHEET_WIDTH_MM[paper] || 210) * PX_PER_MM)));
      zoom = pref || fit;
      zoomEl.style.zoom = zoom;
      const label = root.querySelector('.zoom-value');
      if (label) label.textContent = pref ? `${Math.round(zoom * 100)}%` : 'Fit';
    }

    function decorate() {
      if (!arranging) return;
      host.querySelectorAll('.sheet > .blk').forEach((blk) => { blk.dataset.label = `⠿ ${BLOCK_LABELS[blk.dataset.block] || blk.dataset.block}`; });
      host.querySelectorAll('.inv-items thead').forEach((thead) => {
        const cells = [...thead.querySelectorAll('th[data-col]')];
        cells.slice(0, -1).filter((th) => th.dataset.col !== 'desc').forEach((th) => {
          th.insertAdjacentHTML('beforeend', '<span class="col-resizer" data-col-resize title="Drag to resize · double-click to reset" aria-hidden="true"></span>');
        });
      });
    }

    function setArranging(on) {
      arranging = on;
      root.classList.toggle('is-arranging', on);
      const btn = root.querySelector('[data-arrange]');
      if (btn) btn.setAttribute('aria-pressed', String(on));
      if (opts.render) opts.render();
    }

    function render(html, paperSize = 'A4') {
      paper = paperSize;
      host.innerHTML = html;
      applyZoom();
      decorate();
      if (refocusStamp) {
        const el = host.querySelector(`[data-movable="${refocusStamp}"]`);
        if (el) el.focus({ preventScroll: true });
        refocusStamp = false;
      }
    }

    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-arrange]')) {
        setArranging(!arranging);
        if (arranging && opts.onArrangeStart) opts.onArrangeStart();
        return;
      }
      const btn = e.target.closest('[data-zoom]');
      if (!btn || !opts.setZoom) return;
      const value = btn.dataset.zoom;
      opts.setZoom(value === 'fit' ? 0 : Math.min(2, Math.max(0.3, Math.round((zoom + Number(value) * ZOOM_STEP) * 10) / 10)));
      applyZoom();
    });

    const readStamp = (el) => {
      const cs = getComputedStyle(el);
      return { x: parseFloat(cs.getPropertyValue('--sx')), y: parseFloat(cs.getPropertyValue('--sy')), size: parseFloat(cs.getPropertyValue('--ss')) };
    };

    /* ---------- arrange: reorder blocks & resize columns ---------- */
    host.addEventListener('pointerdown', (e) => {
      if (!arranging || e.button !== 0 || e.target.closest('[data-movable]')) return;
      const resizer = e.target.closest('[data-col-resize]');
      if (resizer && opts.onColumnResize) {
        e.preventDefault();
        const th = resizer.closest('th');
        resizer.setPointerCapture(e.pointerId);
        resizer.classList.add('is-active');
        const rtl = th.closest('.sheet').getAttribute('dir') === 'rtl';
        colDrag = { th, resizer, key: th.dataset.col, startX: e.clientX, start: th.getBoundingClientRect().width / (PX_PER_MM * zoom), dir: rtl ? -1 : 1, width: null };
        return;
      }
      const blk = e.target.closest('.sheet > .blk');
      if (!blk || !opts.onLayoutChange) return;
      e.preventDefault();
      blk.setPointerCapture(e.pointerId);
      const blocks = [...host.querySelectorAll('.sheet > .blk')];
      layoutDrag = { blk, blocks, startY: e.clientY, rects: blocks.map((b) => b.getBoundingClientRect()), target: null };
      blk.classList.add('is-dragging');
    });

    host.addEventListener('pointermove', (e) => {
      if (colDrag) {
        const width = clamp(colDrag.start + (colDrag.dir * (e.clientX - colDrag.startX)) / (PX_PER_MM * zoom), COLUMN_LIMITS);
        colDrag.width = width;
        colDrag.th.style.width = `${width}mm`;
        return;
      }
      if (!layoutDrag) return;
      const { blk, blocks, rects } = layoutDrag;
      blk.style.transform = `translateY(${(e.clientY - layoutDrag.startY) / zoom}px)`;
      blocks.forEach((b) => b.classList.remove('is-drop-before', 'is-drop-after'));
      const index = blocks.indexOf(blk);
      let target = index;
      rects.forEach((r, i) => {
        const mid = r.top + r.height / 2;
        if (i < index && e.clientY < mid && target === index) target = i;
        if (i > index && e.clientY > mid) target = i;
      });
      layoutDrag.target = target;
      if (target !== index) blocks[target].classList.add(target < index ? 'is-drop-before' : 'is-drop-after');
    });

    const endArrange = () => {
      if (colDrag) {
        colDrag.resizer.classList.remove('is-active');
        if (colDrag.width) opts.onColumnResize(colDrag.key, snap(colDrag.width));
        colDrag = null;
      }
      if (layoutDrag) {
        const { blk, blocks, target } = layoutDrag;
        blk.classList.remove('is-dragging');
        blk.style.transform = '';
        const ids = blocks.map((b) => b.dataset.block);
        const from = blocks.indexOf(blk);
        layoutDrag = null;
        if (target !== null && target !== from) {
          const moved = ids.filter((_, i) => i !== from);
          moved.splice(target, 0, ids[from]);
          opts.onLayoutChange(moved);
        } else {
          blocks.forEach((b) => b.classList.remove('is-drop-before', 'is-drop-after'));
        }
      }
    };
    host.addEventListener('pointerup', endArrange);
    host.addEventListener('pointercancel', endArrange);
    host.addEventListener('dblclick', (e) => {
      const resizer = e.target.closest('[data-col-resize]');
      if (resizer && opts.onColumnResize) opts.onColumnResize(resizer.closest('th').dataset.col, 0);
    });

    host.addEventListener('pointerdown', (e) => {
      const stamp = e.target.closest('[data-movable]');
      if (!stamp || !opts.onMove || e.button !== 0) return;
      e.preventDefault();
      stamp.setPointerCapture(e.pointerId);
      stamp.focus({ preventScroll: true });
      stamp.classList.add('is-dragging');
      drag = { stamp, resize: Boolean(e.target.closest('[data-stamp-resize]')), startX: e.clientX, startY: e.clientY, start: readStamp(stamp), current: null };
    });

    host.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.startX) / (PX_PER_MM * zoom);
      const dy = (e.clientY - drag.startY) / (PX_PER_MM * zoom);
      const { start } = drag;
      drag.current = drag.resize
        ? { ...start, size: clamp(start.size + Math.max(dx, dy), STAMP_LIMITS.size) }
        : { ...start, x: clamp(start.x + dx, STAMP_LIMITS.x), y: clamp(start.y + dy, STAMP_LIMITS.y) };
      drag.stamp.style.setProperty('--sx', `${drag.current.x}mm`);
      drag.stamp.style.setProperty('--sy', `${drag.current.y}mm`);
      drag.stamp.style.setProperty('--ss', `${drag.current.size}mm`);
    });

    const endDrag = () => {
      if (!drag) return;
      drag.stamp.classList.remove('is-dragging');
      if (drag.current) {
        refocusStamp = drag.stamp.dataset.movable;
        opts.onMove(drag.stamp.dataset.movable, { x: snap(drag.current.x), y: snap(drag.current.y), size: snap(drag.current.size) });
      }
      drag = null;
    };
    host.addEventListener('pointerup', endDrag);
    host.addEventListener('pointercancel', endDrag);

    host.addEventListener('keydown', (e) => {
      const stamp = e.target.closest('[data-movable]');
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!stamp || !delta || !opts.onMove) return;
      e.preventDefault();
      const step = e.shiftKey ? NUDGE_FAST_MM : NUDGE_MM;
      const s = readStamp(stamp);
      refocusStamp = stamp.dataset.movable;
      opts.onMove(stamp.dataset.movable, { x: clamp(s.x + delta[0] * step, STAMP_LIMITS.x), y: clamp(s.y + delta[1] * step, STAMP_LIMITS.y), size: s.size });
    });

    return { render, applyZoom, host, setArranging, isArranging: () => arranging };
  }

  NB.canvas = { create };
})(window.NB = window.NB || {});
