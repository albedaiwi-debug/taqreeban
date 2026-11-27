// Shared helpers for host + phone screens.
window.GAME_NAME = 'تقريباً';

// 'arab' = ١٢٣ (Arabic-Indic digits), 'latn' = 123. One switch for the whole app.
const DIGITS = 'arab';
const LOCALE = DIGITS === 'arab' ? 'ar-EG' : 'ar-EG-u-nu-latn';

function nf(maxFrac = 2) {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: maxFrac });
}

// Full number with grouping: 8,200,000,000 -> ٨٬٢٠٠٬٠٠٠٬٠٠٠
function fmtFull(n) {
  if (n == null || !isFinite(n)) return '—';
  const frac = Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 1 ? 2 : 4;
  return nf(frac).format(n);
}

// Short form with Arabic words: 8,200,000,000 -> ٨٫٢ مليار ; 45,356 -> ٤٥٫٤ ألف ; 828 -> ٨٢٨
const SCALES = [
  [1e12, 'تريليون'],
  [1e9, 'مليار'],
  [1e6, 'مليون'],
  [1e4, 'ألف', 1e3],
];
function fmtShort(n) {
  if (n == null || !isFinite(n)) return '—';
  for (const [min, word, div = min] of SCALES) {
    if (Math.abs(n) >= min) {
      const v = n / div;
      const frac = v >= 100 ? 0 : v >= 10 ? 1 : 2;
      return `${nf(frac).format(v)} ${word}`;
    }
  }
  return fmtFull(n);
}

// Multiple: ×1.4 ; ×12 ; ×3,400
function fmtMult(m) {
  if (m == null || !isFinite(m)) return '—';
  if (m >= 1e4) return `×${fmtShort(m)}`;
  const frac = m < 10 ? 1 : 0;
  return `×${nf(frac).format(m)}`;
}

function fmtOrdinal(i) {
  return nf(0).format(i);
}

// Convert any Arabic-Indic / Persian digits and separators typed by a user to a JS number string.
function normalizeDigits(s) {
  return String(s)
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٫]/g, '.')
    .replace(/[٬,\s]/g, '');
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

function teamById(state, id) {
  return (state.teams || []).find((t) => t.id === id);
}

Object.assign(window, { fmtFull, fmtShort, fmtMult, fmtOrdinal, normalizeDigits, el, teamById, nf });
