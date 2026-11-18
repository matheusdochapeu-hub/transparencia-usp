/* Utilitários: formatação, DOM, estatística. */

export const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
export const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const nfCompact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

export const fmtInt = (v) => (v == null || Number.isNaN(v) ? '–' : nf0.format(Math.round(v)));
export const fmtCompact = (v) => (v == null ? '–' : nfCompact.format(v));
export const fmtPct = (v, d = 1) =>
  v == null || !Number.isFinite(v) ? '–' : `${nf1.format(v)}%`.replace('.', ',');
export const fmtSigned = (v) => (v > 0 ? `+${fmtInt(v)}` : fmtInt(v));
export const fmtPP = (v) => (v == null ? '–' : `${v > 0 ? '+' : ''}${nf1.format(v)} p.p.`);

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function debounce(fn, ms = 150) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function toast(msg, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), ms);
}

/* --------------------------------------------------------------- estatística */

export const sum = (arr) => arr.reduce((a, b) => a + b, 0);
export const mean = (arr) => (arr.length ? sum(arr) / arr.length : NaN);

export function stdev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(sum(arr.map((x) => (x - m) ** 2)) / (arr.length - 1));
}

/** Coeficiente de Pearson entre dois vetores (ignora pares com null/NaN). */
export function pearson(x, y) {
  const pairs = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] != null && y[i] != null && Number.isFinite(x[i]) && Number.isFinite(y[i])) pairs.push([x[i], y[i]]);
  }
  const n = pairs.length;
  if (n < 3) return { r: NaN, n };
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let num = 0, dx = 0, dy = 0;
  for (const [a, b] of pairs) {
    num += (a - mx) * (b - my);
    dx += (a - mx) ** 2;
    dy += (b - my) ** 2;
  }
  if (dx === 0 || dy === 0) return { r: 0, n };
  return { r: num / Math.sqrt(dx * dy), n };
}

export function ranks(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(arr.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}

export function spearman(x, y) {
  const pairs = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] != null && y[i] != null && Number.isFinite(x[i]) && Number.isFinite(y[i])) pairs.push([x[i], y[i]]);
  }
  if (pairs.length < 3) return { r: NaN, n: pairs.length };
  const a = ranks(pairs.map((p) => p[0]));
  const b = ranks(pairs.map((p) => p[1]));
  return { r: pearson(a, b).r, n: pairs.length };
}

function logGamma(z) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z, y = z, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a, b, x) {
  const FPMIN = 1e-300, EPS = 3e-12;
  let qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Beta incompleta regularizada I_x(a,b). */
function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** p-valor bilateral para correlação de Pearson com n observações. */
export function pValue(r, n) {
  if (!Number.isFinite(r) || n < 3) return NaN;
  const df = n - 2;
  const rr = Math.min(Math.abs(r), 0.999999);
  const t = rr * Math.sqrt(df / (1 - rr * rr));
  return betai(df / 2, 0.5, df / (df + t * t));
}

export function linreg(x, y) {
  const pairs = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) pairs.push([x[i], y[i]]);
  }
  const n = pairs.length;
  if (n < 3) return null;
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let sxx = 0, sxy = 0, syy = 0;
  for (const [a, b] of pairs) {
    sxx += (a - mx) ** 2;
    sxy += (a - mx) * (b - my);
    syy += (b - my) ** 2;
  }
  if (!sxx) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy ? (sxy * sxy) / (sxx * syy) : 0, n };
}

/* ------------------------------------------------------------------ download */

export function downloadFile(name, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function toCSV(header, rows) {
  const q = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.map(q).join(';'), ...rows.map((r) => r.map(q).join(';'))].join('\r\n');
}

/* ------------------------------------------------------------------ misc */

export const PALETTE = ['#8a1538', '#0e7490', '#b45309', '#4d7c0f', '#5b21b6', '#be185d', '#0369a1', '#a16207', '#0f766e', '#7c2d12'];

export function colorAt(i) {
  return PALETTE[i % PALETTE.length];
}

export function cls(...a) {
  return a.filter(Boolean).join(' ');
}

export const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
