/* Arabic amount in words, e.g. "فقط ثلاثة آلاف وتسعمائة وتسعة عشر دينار كويتي وستمائة فلس لا غير". */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.NB = root.NB || {}; root.NB.wordsAr = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ONES = ['صفر', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
    'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
  // [singular, dual, plural (3–10)]
  const SCALES = [null, ['ألف', 'ألفان', 'آلاف'], ['مليون', 'مليونان', 'ملايين'], ['مليار', 'ملياران', 'مليارات'], ['تريليون', 'تريليونان', 'تريليونات']];
  const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

  const DEFAULT_TEMPLATE = 'فقط {MAJOR_WORDS} {MAJOR_NAME}{MINOR_PART} لا غير';
  const DEFAULT_MINOR_TEMPLATE = ' و{MINOR_WORDS} {MINOR_NAME}';

  function below1000(n) {
    const parts = [];
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    if (hundreds) parts.push(HUNDREDS[hundreds]);
    if (rest >= 20) {
      const ones = rest % 10;
      const tens = TENS[Math.floor(rest / 10)];
      parts.push(ones ? `${ONES[ones]} و${tens}` : tens);
    } else if (rest > 0) {
      parts.push(ONES[rest]);
    }
    return parts.join(' و');
  }

  function scaled(chunk, [singular, dual, plural]) {
    if (chunk === 1) return singular;
    if (chunk === 2) return dual;
    if (chunk <= 10) return `${below1000(chunk)} ${plural}`;
    return `${below1000(chunk)} ${singular}`;
  }

  function integerToWords(value) {
    let n = Math.floor(Math.abs(Number(value)));
    if (!Number.isFinite(n)) throw new RangeError('Amount must be a finite number');
    if (n === 0) return ONES[0];
    if (n >= 1e15) throw new RangeError('Amount too large to spell out');
    const groups = [];
    for (let scale = 0; n > 0; scale += 1, n = Math.floor(n / 1000)) {
      const chunk = n % 1000;
      if (chunk) groups.unshift(scale === 0 ? below1000(chunk) : scaled(chunk, SCALES[scale]));
    }
    return groups.join(' و');
  }

  // Arabic puts "one" after the counted noun: "دينار كويتي واحد", not "واحد دينار كويتي".
  const spelled = (n, name) => (n === 1 && name ? { words: `${name} واحد`, name: '' } : { words: integerToWords(n), name });

  function amountToWords(amount, currency, options = {}) {
    const decimals = Math.max(0, Math.floor(Number(currency.decimals) || 0));
    const factor = 10 ** decimals;
    const totalMinor = Math.round(Number(`${Math.abs(Number(amount) || 0)}e${decimals}`));
    const major = Math.floor(totalMinor / factor);
    const minor = totalMinor % factor;
    const minorName = spelled(minor, currency.minorAr || '');
    const majorName = spelled(major, currency.majorAr || '');
    const minorPart = minor > 0
      ? (options.minorTemplate ?? DEFAULT_MINOR_TEMPLATE)
        .replace('{MINOR_WORDS}', minorName.words)
        .replace('{MINOR_NAME}', minorName.name)
        .replace('{MINOR_NUMBER}', String(minor))
      : '';
    const text = (options.template || DEFAULT_TEMPLATE)
      .replace('{MAJOR_NAME}', majorName.name)
      .replace('{CODE}', currency.code || '')
      .replace('{MAJOR_WORDS}', majorName.words)
      .replace('{MINOR_PART}', minorPart)
      .replace(/\s+/g, ' ')
      .trim();
    return Number(amount) < 0 && totalMinor > 0 ? `سالب ${text}` : text;
  }

  const toArabicDigits = (text) => String(text)
    .replace(/[0-9]/g, (d) => ARABIC_DIGITS[Number(d)])
    .replace(/\./g, '٫')
    .replace(/,/g, '٬');

  return { integerToWords, amountToWords, toArabicDigits, DEFAULT_TEMPLATE, DEFAULT_MINOR_TEMPLATE };
});
