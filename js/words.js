/* Amount in words, e.g. "KUWAIT, DINARS THREE THOUSAND ... AND SIX HUNDRED FILS ONLY". */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.NB = root.NB || {}; root.NB.words = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ONES = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
    'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
  const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
  const SCALES = ['', 'THOUSAND', 'MILLION', 'BILLION', 'TRILLION'];

  const DEFAULT_TEMPLATE = '{COUNTRY}, {MAJOR_NAME} {MAJOR_WORDS}{MINOR_PART} ONLY';
  const DEFAULT_MINOR_TEMPLATE = ' AND {MINOR_WORDS} {MINOR_NAME}';

  function below1000(n) {
    const parts = [];
    if (n >= 100) {
      parts.push(`${ONES[Math.floor(n / 100)]} HUNDRED`);
      n %= 100;
    }
    if (n >= 20) parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ''));
    else if (n > 0) parts.push(ONES[n]);
    return parts.join(' ');
  }

  function integerToWords(value) {
    let n = Math.floor(Math.abs(Number(value)));
    if (!Number.isFinite(n)) throw new RangeError('Amount must be a finite number');
    if (n === 0) return ONES[0];
    if (n >= 1e15) throw new RangeError('Amount too large to spell out');
    const groups = [];
    for (let scale = 0; n > 0; scale += 1, n = Math.floor(n / 1000)) {
      const chunk = n % 1000;
      if (chunk) groups.unshift(below1000(chunk) + (SCALES[scale] ? ` ${SCALES[scale]}` : ''));
    }
    return groups.join(' ');
  }

  function applyCase(text, casing) {
    if (casing === 'lower') return text.toLowerCase();
    if (casing === 'title') return text.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    if (casing === 'sentence') return text.charAt(0) + text.slice(1).toLowerCase();
    return text;
  }

  function amountToWords(amount, currency, options = {}) {
    const decimals = Math.max(0, Math.floor(Number(currency.decimals) || 0));
    const factor = 10 ** decimals;
    const totalMinor = Math.round(Number(`${Math.abs(Number(amount) || 0)}e${decimals}`));
    const major = Math.floor(totalMinor / factor);
    const minor = totalMinor % factor;
    const minorPart = minor > 0
      ? (options.minorTemplate ?? DEFAULT_MINOR_TEMPLATE)
        .replace('{MINOR_WORDS}', integerToWords(minor))
        .replace('{MINOR_NAME}', currency.minor || '')
        .replace('{MINOR_NUMBER}', String(minor))
      : '';
    const text = (options.template || DEFAULT_TEMPLATE)
      .replace('{COUNTRY}', currency.country || '')
      .replace('{MAJOR_NAME}', currency.major || '')
      .replace('{CODE}', currency.code || '')
      .replace('{MAJOR_WORDS}', integerToWords(major))
      .replace('{MINOR_PART}', minorPart)
      .replace(/\s+/g, ' ')
      .replace(/^\s*,\s*/, '')
      .trim();
    const signed = Number(amount) < 0 && totalMinor > 0 ? `MINUS ${text}` : text;
    return applyCase(signed, options.casing || 'upper');
  }

  return { integerToWords, amountToWords, DEFAULT_TEMPLATE, DEFAULT_MINOR_TEMPLATE };
});
