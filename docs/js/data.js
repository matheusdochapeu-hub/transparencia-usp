/* Camada de dados: carrega e deriva séries a partir dos JSON estáticos. */

const BASE = 'data/';

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Falha ao carregar ${url} (${res.status})`);
  return res.json();
}

const METRICS = ['total', 'ativo', 'doc', 'tec', 'docApos', 'tecApos', 'apos'];

/** Populações oferecidas no seletor do topo. */
export const POPS = [
  { key: 'ativo', label: 'Ativos', long: 'servidores ativos' },
  { key: 'apos', label: 'Aposentados', long: 'servidores aposentados' },
  { key: 'todos', label: 'Todos', long: 'ativos + aposentados' },
];
const POP_KEYS = ['ativo', 'apos', 'todos'];

/**
 * Colunas de vínculo que compõem uma população, opcionalmente filtrada por
 * carreira (docente, servidor técnico-administrativo ou ambos).
 */
export function populationKeys(pop, vinculo = 'ambos') {
  const table = {
    ativo: { doc: ['doc'], tec: ['tec'], ambos: ['doc', 'tec'] },
    apos: { doc: ['docApos'], tec: ['tecApos'], ambos: ['docApos', 'tecApos'] },
    todos: {
      doc: ['doc', 'docApos'],
      tec: ['tec', 'tecApos'],
      ambos: ['doc', 'tec', 'docApos', 'tecApos'],
    },
  };
  const set = table[pop] || table.todos;
  return set[vinculo] || set.ambos;
}

/** Soma de métricas de uma categoria em um mês. */
export function sumMetrics(cat, keys, li, ri) {
  let v = 0;
  for (const k of keys) v += cat.m[k][li][ri];
  return v;
}

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
    m.ativo[li][ri] = doc + tec;
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
  scopeKey: 'usp',
  scopes: [],
  population: 'ativo',
  _scopeData: null,
  _scChanged: null,
  _cards: null,
  _movers: null,

  async init() {
    const qs = new URLSearchParams(location.search);
    const pop = qs.get('pop') || localStorage.getItem('usp-population');
    if (POP_KEYS.includes(pop)) {
      this.population = pop;
      if (qs.get('pop')) localStorage.setItem('usp-population', pop);
    }
    this.index = await fetchJSON(`${BASE}index.json`);
    try {
      this.scopes = (await fetchJSON(`${BASE}scopes.json`)).scopes || [];
    } catch {
      this.scopes = [];
    }
    const scope = qs.get('scope') || localStorage.getItem('usp-scope');
    if (scope && (scope === 'usp' || this.scopes.some((s) => s.key === scope))) {
      if (scope !== 'usp') {
        try {
          await this.loadScope(scope);
        } catch {
          this.scopeKey = 'usp';
        }
      }
    }
    return this.index;
  },

  /** 'ativo' | 'apos' | 'todos'. */
  setPopulation(pop) {
    if (!POP_KEYS.includes(pop) || pop === this.population) return;
    this.population = pop;
    this._cards = null;
    this._movers = null;
    localStorage.setItem('usp-population', pop);
  },

  get popInfo() {
    return POPS.find((p) => p.key === this.population) || POPS[0];
  },

  get popLabel() {
    return this.popInfo.label;
  },

  get popLong() {
    return this.popInfo.long;
  },

  /** Métrica equivalente nas matrizes de categoria. */
  get metric() {
    return this.population === 'ativo' ? 'ativo' : this.population === 'apos' ? 'apos' : 'total';
  },

  /** Colunas de vínculo da população atual (opcionalmente por carreira). */
  keys(vinculo = 'ambos') {
    return populationKeys(this.population, vinculo);
  },

  /** Total da população em um mês (competência indexada). */
  popTotal(ri, pop = this.population) {
    if (this.isGlobal) {
      const t = this.totals[ri] || [0, 0, 0, 0];
      if (pop === 'ativo') return t[0] + t[1];
      if (pop === 'apos') return t[2] + t[3];
      return t[0] + t[1] + t[2] + t[3];
    }
    const rows = (this._scopeData.categories.categoria || {}).rows || [];
    // o recorte traz uma linha por vínculo; soma as colunas correspondentes
    let sum = 0;
    for (const row of rows) {
      if (row[0] !== ri) continue;
      sum += pop === 'ativo' ? row[2] + row[3] : pop === 'apos' ? row[4] + row[5] : row[2] + row[3] + row[4] + row[5];
    }
    return sum;
  },

  async loadScope(key) {
    if (key === 'usp') {
      this.scopeKey = 'usp';
      this._scopeData = null;
    } else {
      this._scopeData = await fetchJSON(`${BASE}scope/${key}.json`);
      this.scopeKey = key;
    }
    this._cats.clear();
    this._scChanged = null;
    this._cards = null;
    this._movers = null;
    localStorage.setItem('usp-scope', this.scopeKey);
  },

  async setScope(key) {
    if (key === this.scopeKey) return;
    await this.loadScope(key);
  },

  get isGlobal() {
    return this.scopeKey === 'usp';
  },

  get scopeInfo() {
    return this.isGlobal ? null : this._scopeData;
  },

  get scopeLabel() {
    return this.isGlobal ? 'USP' : `${this._scopeData.name} · ${this._scopeData.type === 'campus' ? 'Campus' : 'Unidade'}`;
  },

  get refs() {
    return this.isGlobal ? this.index.refs : this._scopeData.refs;
  },

  get refLabels() {
    return this.refs.map((r) => r.label);
  },

  get refIds() {
    return this.refs.map((r) => r.id);
  },

  get totals() {
    return this.isGlobal ? this.index.totals : this._scopeData.totals;
  },

  meta(slug) {
    return this.index.categories.find((c) => c.slug === slug);
  },

  async category(slug) {
    if (this._cats.has(slug)) return this._cats.get(slug);
    const meta = this.meta(slug);
    if (!meta) throw new Error(`Categoria desconhecida: ${slug}`);
    let raw;
    if (this.isGlobal) {
      raw = await fetchJSON(meta.file);
    } else {
      const c = this._scopeData.categories[slug];
      if (!c) throw new Error(`Categoria ${slug} indisponível neste recorte`);
      raw = { slug, title: meta.title, refs: this.refIds, labels: c.labels, rows: c.rows };
    }
    const data = buildMatrices(raw);
    this._cats.set(slug, data);
    return data;
  },

  async allCategories() {
    return Promise.all(this.index.categories.map((c) => this.category(c.slug)));
  },

  /** Cartões-resumo da página Categorias, sempre por população. */
  cards() {
    const pop = this.population;
    if (this.isGlobal) {
      return (this.index.cards || []).map((c) => {
        // Função Estrutura só existe para ativos — não faz sentido "vazia" em aposentados.
        const restricted = c.slug === 'funcao-estrutura';
        return { slug: c.slug, title: c.title, restricted, ...(c.byPop?.[restricted ? 'ativo' : pop] || {}) };
      });
    }
    if (this._cards) return this._cards;
    const n = this.refs.length;
    const curI = n - 1;
    const prevI = Math.max(0, n - 13);
    const sumPop = (row, p) =>
      p === 'ativo' ? row[2] + row[3] : p === 'apos' ? row[4] + row[5] : row[2] + row[3] + row[4] + row[5];
    const out = [];
    for (const meta of this.index.categories) {
      const c = this._scopeData.categories[meta.slug];
      if (!c) continue;
      const restricted = meta.slug === 'funcao-estrutura';
      const effective = restricted ? 'ativo' : pop;
      const cur = new Map();
      const prev = new Map();
      const present = new Set();
      for (const row of c.rows) {
        const [ri, li] = row;
        const v = sumPop(row, effective);
        if (!v) continue;
        present.add(li);
        if (ri === curI) cur.set(li, (cur.get(li) || 0) + v);
        if (ri === prevI) prev.set(li, (prev.get(li) || 0) + v);
      }
      let topLi = -1;
      let topV = -1;
      for (const [li, v] of cur) if (v > topV) { topV = v; topLi = li; }
      const total = [...cur.values()].reduce((a, b) => a + b, 0);
      if (topLi < 0) {
        out.push({ slug: meta.slug, title: meta.title, restricted, nValues: present.size, top: null, spark: [], total: 0 });
        continue;
      }
      const series = new Array(n).fill(0);
      for (const row of c.rows) if (row[1] === topLi) series[row[0]] += sumPop(row, effective);
      const p = prev.get(topLi) || 0;
      out.push({
        slug: meta.slug,
        title: meta.title,
        restricted,
        nValues: present.size,
        total,
        top: { label: c.labels[topLi], value: topV, share: (topV / (total || 1)) * 100, delta: topV - p, pct: p ? ((topV - p) / p) * 100 : null },
        spark: series.slice(-24),
      });
    }
    this._cards = out;
    return out;
  },

  /** Maiores mudanças da população atual (globais vêm prontas; recortes são calculados). */
  movers() {
    if (this.isGlobal) return (this.index.movers || {})[this.population] || {};
    if (this._movers) return this._movers;
    const n = this.refs.length;
    const pop = this.population;
    const sumPop = (row) =>
      pop === 'ativo' ? row[2] + row[3] : pop === 'apos' ? row[4] + row[5] : row[2] + row[3] + row[4] + row[5];
    const build = (span) => {
      const base = span == null ? 0 : Math.max(0, n - 1 - span);
      const out = [];
      for (const meta of this.index.categories) {
        if (meta.slug === 'categoria') continue;
        const c = this._scopeData.categories[meta.slug];
        if (!c) continue;
        const byLabel = new Map();
        for (const row of c.rows) {
          const [ri, li] = row;
          if (!byLabel.has(li)) byLabel.set(li, {});
          const o = byLabel.get(li);
          o[ri] = (o[ri] || 0) + sumPop(row);
        }
        for (const [li, o] of byLabel) {
          const A = o[base] || 0;
          const B = o[n - 1] || 0;
          const delta = B - A;
          if (Math.abs(delta) < 3) continue;
          out.push({ slug: meta.slug, label: c.labels[li], from: A, to: B, delta, pct: A ? (delta / A) * 100 : null });
        }
      }
      out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      return out.slice(0, 14);
    };
    this._movers = { lastMonth: build(1), last12m: build(12), all: build(null) };
    return this._movers;
  },

  async campus() {
    if (!this.isGlobal) return null;
    if (this._campus !== undefined) return this._campus;
    if (!this.index.campus?.available) return (this._campus = null);
    this._campus = await fetchJSON(`${BASE}campus.json`).catch(() => null);
    return this._campus;
  },

  async campusLatest() {
    if (!this.isGlobal) return null;
    if (this._campusLatest !== undefined) return this._campusLatest;
    this._campusLatest = await fetchJSON(`${BASE}campus-latest.json`).catch(() => null);
    return this._campusLatest;
  },

  async changes() {
    if (this.isGlobal) {
      if (this._changes === undefined) {
        this._changes = await fetchJSON(`${BASE}changes.json`).catch(() => null);
      }
      const ch = this._changes;
      if (!ch) return null;
      const rows = Array.isArray(ch.rows) ? ch.rows : (ch.rows || {})[this.population] || [];
      return { ...ch, rows };
    }
    return this._scopeChanges();
  },

  /** changes.json equivalente, calculado a partir do recorte (por população). */
  _scopeChanges() {
    if (!this._scChanged) this._scChanged = this._buildScopeChanges();
    return { ...this._scChanged, rows: this._scChanged.rowsByPop[this.population] || [] };
  },

  _buildScopeChanges() {
    const n = this.refs.length;
    const refs = this.refs;
    const windows = [
      { key: '1m', label: 'Último mês', span: 1 },
      { key: '12m', label: '12 meses', span: 12 },
      { key: '60m', label: '5 anos', span: 60 },
      { key: 'all', label: `Desde ${refs[0].label}`, span: null },
    ];
    const slugs = this.index.categories.map((c) => c.slug).filter((s) => s !== 'categoria');
    const labels = {};
    const rowsByPop = { ativo: [], apos: [], todos: [] };
    const sumPop = (row, pop) =>
      pop === 'ativo' ? row[2] + row[3] : pop === 'apos' ? row[4] + row[5] : row[2] + row[3] + row[4] + row[5];
    for (let si = 0; si < slugs.length; si++) {
      const c = this._scopeData.categories[slugs[si]];
      if (!c) continue;
      labels[slugs[si]] = c.labels;
    }
    windows.forEach((w, wi) => {
      const base = w.span == null ? 0 : Math.max(0, n - 1 - w.span);
      for (let si = 0; si < slugs.length; si++) {
        const c = this._scopeData.categories[slugs[si]];
        if (!c) continue;
        for (const pop of POP_KEYS) {
          const byLabel = new Map();
          for (const row of c.rows) {
            const [ri, li] = row;
            if (!byLabel.has(li)) byLabel.set(li, new Array(n).fill(0));
            byLabel.get(li)[ri] += sumPop(row, pop);
          }
          for (const [li, series] of byLabel) {
            const A = series[base] || 0;
            const B = series[n - 1] || 0;
            const delta = B - A;
            if (Math.abs(delta) < 3 && Math.max(A, B) < 5) continue;
            const k = Math.min(14, n - base);
            const spark = [];
            if (k <= 1) spark.push(A, B);
            else {
              const step = (n - 1 - base) / (k - 1);
              for (let i = 0; i < k; i++) spark.push(series[base + Math.round(i * step)] || 0);
            }
            rowsByPop[pop].push([wi, si, li, A, B, delta, A ? Math.round((delta / A) * 10000) / 100 : null, spark]);
          }
        }
      }
    });
    return {
      windows: windows.map((w) => ({
        key: w.key,
        label: w.label,
        fromRef: w.span == null ? 0 : Math.max(0, n - 1 - w.span),
        toRef: n - 1,
        disabled: w.span != null && w.span > n - 1,
      })),
      slugs,
      labels,
      rowsByPop,
    };
  },

  async vacancia() {
    if (this._vac !== undefined) return this._vac;
    this._vac = await fetchJSON(`${BASE}vacancia.json`).catch(() => null);
    return this._vac;
  },

  async tecnicos() {
    if (this._tec !== undefined) return this._tec;
    this._tec = await fetchJSON(`${BASE}tecnicos.json`).catch(() => null);
    return this._tec;
  },

  async vencimentos() {
    if (this._venc !== undefined) return this._venc;
    this._venc = await fetchJSON(`${BASE}vencimentos.json`).catch(() => null);
    return this._venc;
  },

  async vacanciaServidores() {
    if (this._vacS !== undefined) return this._vacS;
    this._vacS = await fetchJSON(`${BASE}vacancia-servidores.json`).catch(() => null);
    return this._vacS;
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
