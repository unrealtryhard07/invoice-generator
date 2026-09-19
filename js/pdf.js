/* One-click PDF download: renders the invoice off-screen, rasterises it at print resolution and saves an A4/Letter PDF. */
(function (NB) {
  'use strict';

  const LIBS = { image: 'vendor/html-to-image.js', pdf: 'vendor/jspdf.umd.min.js' };
  const PAGE_MM = { A4: [210, 297], Letter: [215.9, 279.4] };
  const PIXEL_RATIO = 2.5;
  const JPEG_QUALITY = 0.92;
  const PAGE_TOLERANCE_MM = 1;
  const EMBEDDED_SUBSETS = ['latin', 'latin-ext', 'arabic'];
  const PX_PER_MM = 96 / 25.4;
  const MIN_PAGE_FILL = 0.5;
  // Elements a page may end after without cutting content in half.
  const BREAK_AFTER = 'tr, .blk, .kv, .inv-words, .inv-terms > p, .inv-printed, .inv-sign';

  const scripts = new Map();
  function loadScript(src) {
    if (!scripts.has(src)) {
      scripts.set(src, new Promise((resolve, reject) => {
        const el = Object.assign(document.createElement('script'), { src, async: true });
        el.onload = resolve;
        el.onerror = () => {
          scripts.delete(src);
          el.remove();
          reject(new Error('The PDF engine could not be loaded. Check that the “vendor” folder is next to index.html.'));
        };
        document.head.append(el);
      }));
    }
    return scripts.get(src);
  }

  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read font data.'));
    reader.readAsDataURL(blob);
  });

  /* ---------- fonts: embed only the families this invoice uses ---------- */
  const fontCache = new Map();

  async function googleFontCss(families) {
    const link = document.querySelector('link[href*="fonts.googleapis.com/css2"]');
    if (!link) return '';
    const css = await (await fetch(link.href)).text();
    const blocks = css.split('/* ').slice(1).map((b) => `/* ${b}`);
    const wanted = blocks.filter((block) => {
      const family = (/font-family:\s*'([^']+)'/.exec(block) || [])[1];
      const subset = (/^\/\* ([\w-]+) \*\//.exec(block) || [])[1];
      return families.includes(family) && EMBEDDED_SUBSETS.includes(subset);
    });
    const inlined = await Promise.all(wanted.map(async (block) => {
      const url = (/url\((https:[^)]+)\)/.exec(block) || [])[1];
      if (!url) return block;
      const data = await blobToDataUrl(await (await fetch(url)).blob());
      return block.replace(url, data);
    }));
    return inlined.join('\n');
  }

  async function customFontCss(families) {
    const fonts = (await NB.blobs.listFonts()).filter((f) => families.includes(f.family));
    const faces = await Promise.all(fonts.map(async (f) => `@font-face { font-family: '${f.family}'; src: url(${await blobToDataUrl(f.blob)}); }`));
    return faces.join('\n');
  }

  async function fontCss(inv) {
    const t = inv.theme;
    const families = [...new Set([t.bodyFont, t.headingFont, inv.language === 'en' ? null : t.arabicFont, 'Tajawal'].filter(Boolean))].sort();
    const key = families.join('|');
    if (!fontCache.has(key)) {
      fontCache.set(key, Promise.all([googleFontCss(families), customFontCss(families)])
        .then((parts) => parts.join('\n'))
        .catch((err) => {
          fontCache.delete(key);
          throw new Error(`Fonts could not be embedded (${err.message}). Check your internet connection or use Print / PDF.`);
        }));
    }
    return fontCache.get(key);
  }

  /* ---------- rendering ---------- */
  async function captureSheet(inv) {
    const host = document.createElement('div');
    host.className = 'pdf-capture';
    host.setAttribute('aria-hidden', 'true');
    host.innerHTML = NB.render.invoice({ ...inv, sections: { ...inv.sections, pageGuides: false } });
    document.body.append(host);
    try {
      const sheet = host.querySelector('.sheet');
      await Promise.all([...sheet.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
      await document.fonts.ready;
      // Offline (Google Fonts unreachable): still produce the PDF, with the fonts this computer already has.
      const fontEmbedCSS = await fontCss(inv).catch(() => null);
      const top = sheet.getBoundingClientRect().top;
      const breaks = [...new Set([...sheet.querySelectorAll(BREAK_AFTER)]
        .map((el) => Math.round(((el.getBoundingClientRect().bottom - top) / PX_PER_MM) * 10) / 10))].sort((a, b) => a - b);
      // An empty fontEmbedCSS tells html-to-image not to fetch any font files itself.
      const canvas = await window.htmlToImage.toCanvas(sheet, { pixelRatio: PIXEL_RATIO, backgroundColor: '#ffffff', fontEmbedCSS: fontEmbedCSS ?? '' });
      return { canvas, breaks, fontsEmbedded: fontEmbedCSS !== null };
    } finally {
      host.remove();
    }
  }

  function slicePages(canvas, inv, breaks) {
    const [pageW, pageH] = PAGE_MM[inv.theme.paper] || PAGE_MM.A4;
    const pxPerMm = canvas.width / pageW;
    const sheetH = canvas.height / pxPerMm;
    if (sheetH <= pageH + PAGE_TOLERANCE_MM) return [{ sy: 0, sh: canvas.height, dy: 0, dh: Math.min(sheetH, pageH) }];

    // Later pages repeat the page margin at the top, mirroring how the browser prints.
    const margin = Math.min(Math.max(NB.calc.toNum(inv.theme.margin), 0), 30);
    const pages = [];
    let offset = 0;
    while (offset < sheetH - PAGE_TOLERANCE_MM) {
      const first = pages.length === 0;
      const dy = first ? 0 : margin;
      const room = pageH - dy - margin;
      const safe = breaks.filter((b) => b > offset + room * MIN_PAGE_FILL && b <= offset + room).pop();
      const dh = sheetH - offset <= room ? sheetH - offset : (safe ? safe - offset : room);
      pages.push({ sy: Math.round(offset * pxPerMm), sh: Math.round(dh * pxPerMm), dy, dh });
      offset += dh;
    }
    return pages;
  }

  async function downloadInvoice(inv, filename) {
    await Promise.all([loadScript(LIBS.image), loadScript(LIBS.pdf)]);
    const { canvas, breaks, fontsEmbedded } = await captureSheet(inv);
    const [pageW] = PAGE_MM[inv.theme.paper] || PAGE_MM.A4;
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: inv.theme.paper === 'Letter' ? 'letter' : 'a4', compress: true });
    const slice = document.createElement('canvas');
    slice.width = canvas.width;

    slicePages(canvas, inv, breaks).forEach((page, i) => {
      if (i > 0) pdf.addPage();
      slice.height = page.sh;
      const g = slice.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, slice.width, slice.height);
      g.drawImage(canvas, 0, page.sy, canvas.width, page.sh, 0, 0, canvas.width, page.sh);
      pdf.addImage(slice.toDataURL('image/jpeg', JPEG_QUALITY), 'JPEG', 0, page.dy, pageW, page.dh, undefined, 'FAST');
    });

    pdf.setProperties({ title: filename.replace(/\.pdf$/i, ''), subject: `${inv.title} ${inv.number}`, author: inv.company.name, creator: 'Invoice Studio' });
    pdf.save(filename);
    return { fontsEmbedded };
  }

  const safeFilename = (inv) => `${[inv.title, inv.number].filter(Boolean).join(' ')}${inv.customer.name ? ` - ${inv.customer.name}` : ''}`
    .replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Invoice';

  NB.pdf = { downloadInvoice, safeFilename };
})(window.NB = window.NB || {});
