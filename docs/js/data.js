/* Camada de dados: carrega e deriva séries a partir dos JSON estáticos. */

const BASE = 'data/';

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Falha ao carregar ${url} (${res.status})`);
  return res.json();
}

const METRICS = ['total', 'doc', 'tec', 'docApos', 'tecApos', 'apos'];

function buildMatrices(payload) {
  const n = payload.refs.length;
  const L = payload.labels.length;
  const m = {};
  for (const k of METRICS) m[k] = Array.from({ length: L }, () => new Float64Array(n));
  for (const [ri, li, doc, tec, docApos, tecApos] of payload.rows) {
    m.doc[li][ri] = doc;
    m.tec[li][ri] = tec;
    m.docApos[li][ri] = docApos;
    m.tecApos[li][ri] = tecApos;
    m.apos[li][ri] = docApos + tecApos;
    m.total[li][ri] = doc + tec + docApos + tecApos;
  }
  const colTotals = {};
  for (const k of METRICS) {
    const arr = new Float64Array(n);
    for (let li = 0; li < L; li++) for (let ri = 0; ri < n; ri++) arr[ri] += m[k][li][ri];
    colTotals[k] = arr;
  }
  return { ...payload, n, m, colTotals };
}

export const store = {
  index: null,
  _cats: new Map(),
  _campus: undefined,
  _campusLatest: undefined,
  _changes: undefined,

  async init() {
    this.index = await fetchJSON(`${BASE}index.json`);
    return this.index;
  },

  get refs() {
    return this.index.refs;
  },

  get refLabels() {
    return this.index.refs.map((r) => r.label);
  },

  meta(slug) {
    return this.index.categories.find((c) => c.slug === slug);
  },

  async category(slug) {
    if (this._cats.has(slug)) return this._cats.get(slug);
    const meta = this.meta(slug);
    if (!meta) throw new Error(`Categoria desconhecida: ${slug}`);
    const raw = await fetchJSON(meta.file);
    const data = buildMatrices(raw);
    this._cats.set(slug, data);
    return data;
  },

  async allCategories() {
    return Promise.all(this.index.categories.map((c) => this.category(c.slug)));
  },

  async campus() {
    if (this._campus !== undefined) return this._campus;
    if (!this.index.campus?.available) return (this._campus = null);
    this._campus = await fetchJSON(`${BASE}campus.json`).catch(() => null);
    return this._campus;
  },

  async campusLatest() {
    if (this._campusLatest !== undefined) return this._campusLatest;
    this._campusLatest = await fetchJSON(`${BASE}campus-latest.json`).catch(() => null);
    return this._campusLatest;
  },

  async changes() {
    if (this._changes !== undefined) return this._changes;
    this._changes = await fetchJSON(`${BASE}changes.json`).catch(() => null);
    return this._changes;
  },

  async vacancia() {
    if (this._vac !== undefined) return this._vac;
    this._vac = await fetchJSON(`${BASE}vacancia.json`).catch(() => null);
    return this._vac;
  },
};

/* ------------------------------------------------------------------ helpers */

/** Série de um rótulo, opcionalmente normalizada em participação (%). */
export function seriesOf(cat, labelIdx, metric = 'total', mode = 'count') {
  const arr = cat.m[metric][labelIdx];
  if (mode === 'count') return Array.from(arr);
  const tot = cat.colTotals[metric];
  return Array.from(arr, (v, i) => (tot[i] ? (v / tot[i]) * 100 : 0));
}

/** Série agregada de vários rótulos. */
export function seriesSum(cat, labelIdxs, metric = 'total') {
  const n = cat.n;
  const out = new Array(n).fill(0);
  for (const li of labelIdxs) {
    const arr = cat.m[metric][li];
    for (let i = 0; i < n; i++) out[i] += arr[i];
  }
  return out;
}

/** Índices dos rótulos ordenados pelo valor mais recente (desc). */
export function topLabelIdxs(cat, metric = 'total', k = 8) {
  return cat.labels
    .map((_, i) => i)
    .sort((a, b) => cat.m[metric][b][cat.n - 1] - cat.m[metric][a][cat.n - 1])
    .slice(0, k);
}

/** Competências de um intervalo: '5a' | '10a' | '12m' | '24m' | 'tudo'. */
export function rangeIdxs(cat, range) {
  const n = cat.n;
  if (range === 'tudo') return Array.from({ length: n }, (_, i) => i);
  const months = range === '12m' ? 12 : range === '24m' ? 24 : range === '5a' ? 60 : range === '3a' ? 36 : n;
  const start = Math.max(0, n - months);
  return Array.from({ length: n - start }, (_, i) => start + i);
}

/** Colunas de uma tabela comparativa conforme o modo. */
export function periodColumns(refs, mode, range) {
  const n = refs.length;
  if (mode === 'anos') {
    const byYear = new Map();
    for (let i = 0; i < n; i++) {
      const y = refs[i].id.slice(0, 4);
      byYear.set(y, i); // último mês de cada ano
    }
    return [...byYear.values()];
  }
  if (mode === '12m') return Array.from({ length: Math.min(12, n) }, (_, i) => n - Math.min(12, n) + i);
  if (mode === '24m') return Array.from({ length: Math.min(24, n) }, (_, i) => n - Math.min(24, n) + i);
  if (mode === 'tudo') {
    const k = 7;
    if (n <= k) return Array.from({ length: n }, (_, i) => i);
    const out = new Set([0, n - 1]);
    for (let i = 1; i < k - 1; i++) out.add(Math.round((i / (k - 1)) * (n - 1)));
    return [...out].sort((a, b) => a - b);
  }
  return rangeIdxs({ n }, range);
}

export { METRICS };
