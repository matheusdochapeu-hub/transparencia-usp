/* Ranking de mudanças entre períodos, com filtros e período personalizado. */

import { store } from '../data.js';
import { hBars, sparklineSVG } from '../charts.js';
import { pageHead, card, seg, bindSegs, notice } from '../ui.js';
import { esc, fmtInt, fmtSigned, debounce, nf1, naturalCompare, downloadFile, toCSV } from '../util.js';

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const SORTS = [
  { v: 'abs', label: 'Maior variação absoluta' },
  { v: 'delta', label: 'Maior alta' },
  { v: 'pct', label: 'Maior variação %' },
  { v: 'from', label: 'Maior valor antes' },
  { v: 'to', label: 'Maior valor depois' },
  { v: 'label', label: 'Valor (A–Z)' },
  { v: 'cat', label: 'Categoria (A–Z)' },
];

export async function render(el) {
  const ch = await store.changes();
  const { index } = store;
  if (!ch) {
    el.innerHTML = pageHead({ title: 'Mudanças', lead: 'Ranking indisponível.' });
    return;
  }
  const refs = store.refs;
  const n = refs.length;

  const WIN = ch.windows.filter((w) => !w.disabled);
  const st = {
    win: (WIN.find((w) => w.key === '12m') || WIN[0]).key,
    slug: '',
    q: '',
    dir: 'all',
    minDelta: 0,
    minPct: 0,
    status: 'all',
    sort: 'abs',
    sortDir: 'desc',
    showAll: false,
  };

  // período personalizado
  let custom = null;
  let customKey = '';
  let token = 0;

  const brokenCats = index.categories.filter((c) => (c.breaks || []).length);
  const options = refs.map((r, i) => `<option value="${i}">${esc(r.label)}</option>`).join('');

  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Comparar',
      title: 'O que mudou',
      lead: `Ranking de todas as categorias pela variação de efetivo entre duas competências — <b>${esc(store.popLong)}</b>. Escolha uma janela pronta ou defina um período personalizado, e filtre por valor, categoria, direção ou magnitude.`,
    })}
    ${
      brokenCats.length
        ? `<div style="margin-bottom:16px">${notice(
            `Atenção: o portal reformulou a nomenclatura de <b>${brokenCats
              .map((c) => esc(c.title))
              .join(', ')}</b> em algum momento da série. Rótulos marcados como <b>novo</b> ou <b>extinto</b> podem ser apenas renomeações.`,
            'warn'
          )}</div>`
        : ''
    }

    <div class="card" style="margin-bottom:16px">
      <div class="toolbar" style="margin-bottom:10px">
        ${seg('win', [...WIN.map((w) => ({ v: w.key, label: w.label })), { v: 'custom', label: 'Personalizado' }], st.win)}
        <div id="customWrap" class="toolbar" style="gap:8px" hidden>
          <div class="field" style="gap:3px">
            <label for="fromSel">De</label>
            <select id="fromSel" aria-label="Mês inicial">${options}</select>
          </div>
          <div class="field" style="gap:3px">
            <label for="toSel">Até</label>
            <select id="toSel" aria-label="Mês final">${options}</select>
          </div>
        </div>
        <select id="catSel" aria-label="Filtrar categoria">
          <option value="">Todas as categorias</option>
          ${ch.slugs.map((s) => `<option value="${s}">${esc(index.categories.find((c) => c.slug === s)?.title || s)}</option>`).join('')}
        </select>
        ${seg('dir', [
          { v: 'all', label: 'Todas' },
          { v: 'up', label: 'Altas' },
          { v: 'down', label: 'Quedas' },
        ], 'all')}
        <div class="spacer" style="flex:1"></div>
        <span class="hint" id="winLabel"></span>
      </div>
      <div class="toolbar">
        <div class="field" style="gap:3px">
          <label for="q">Valor</label>
          <input type="search" id="q" list="valList" placeholder="Ex.: Professor Doutor" style="width:210px">
          <datalist id="valList"></datalist>
        </div>
        <div class="field" style="gap:3px">
          <label for="minDelta">Variação mínima</label>
          <select id="minDelta">
            <option value="0">Qualquer</option>
            <option value="5">≥ 5</option>
            <option value="10">≥ 10</option>
            <option value="20">≥ 20</option>
            <option value="50">≥ 50</option>
            <option value="100">≥ 100</option>
          </select>
        </div>
        <div class="field" style="gap:3px">
          <label for="minPct">Variação % mínima</label>
          <select id="minPct">
            <option value="0">Qualquer</option>
            <option value="1">≥ 1%</option>
            <option value="5">≥ 5%</option>
            <option value="10">≥ 10%</option>
            <option value="25">≥ 25%</option>
            <option value="50">≥ 50%</option>
          </select>
        </div>
        <div class="field" style="gap:3px">
          <label for="status">Situação</label>
          <select id="status">
            <option value="all">Todos</option>
            <option value="existing">Já existia</option>
            <option value="new">Novo</option>
            <option value="gone">Extinto</option>
          </select>
        </div>
        <div class="field" style="gap:3px">
          <label for="sortSel">Ordenar por</label>
          <select id="sortSel">${SORTS.map((s) => `<option value="${s.v}">${esc(s.label)}</option>`).join('')}</select>
        </div>
        <button class="btn" id="clear" style="align-self:flex-end">Limpar</button>
        <div class="spacer" style="flex:1"></div>
        <button class="btn ghost" id="csv" style="align-self:flex-end">CSV</button>
      </div>
      <p class="hint" id="filterInfo" style="margin-top:10px"></p>
    </div>

    <div class="grid cols-2 section" style="margin-top:0">
      <div class="card"><div class="card-head"><div><h3>Maiores altas</h3><p>Variação absoluta no período, dentro dos filtros.</p></div></div><div id="ups"></div></div>
      <div class="card"><div class="card-head"><div><h3>Maiores quedas</h3><p>Variação absoluta no período, dentro dos filtros.</p></div></div><div id="downs"></div></div>
    </div>

    <div class="section card">
      <div class="card-head"><div><h3>Tabela completa</h3><p id="tblSub"></p></div><div class="spacer"></div><span class="hint" id="count"></span></div>
      <div class="table-wrap" id="wrap"></div>
      <div id="moreWrap" style="display:flex;justify-content:center;padding:10px"></div>
    </div>
  `;

  const fromSel = el.querySelector('#fromSel');
  const toSel = el.querySelector('#toSel');
  fromSel.value = String(Math.max(0, n - 25));
  toSel.value = String(n - 1);

  const activeCh = () => (st.win === 'custom' ? custom : ch);
  const winMeta = () => activeCh().windows.find((w) => w.key === st.win) || activeCh().windows[0];
  const shortCat = (slug) => index.categories.find((c) => c.slug === slug)?.title || slug;

  /** Calcula o delta entre dois meses arbitrários a partir das séries completas. */
  async function buildCustom(fromIdx, toIdx) {
    const cats = await store.allCategories();
    const labels = {};
    const rows = [];
    for (let si = 0; si < ch.slugs.length; si++) {
      const slug = ch.slugs[si];
      const cat = cats.find((c) => c.slug === slug);
      if (!cat) continue;
      labels[slug] = cat.labels;
      const span = toIdx - fromIdx;
      const k = Math.min(14, span + 1);
      for (let li = 0; li < cat.labels.length; li++) {
        const series = cat.m[store.metric][li];
        const a = series[fromIdx] || 0;
        const b = series[toIdx] || 0;
        const delta = b - a;
        if (Math.abs(delta) < 3 && Math.max(a, b) < 5) continue;
        const spark = [];
        for (let i = 0; i < k; i++) spark.push(series[fromIdx + Math.round((i * span) / Math.max(1, k - 1))] || 0);
        rows.push([0, si, li, a, b, delta, a ? (delta / a) * 100 : null, spark]);
      }
    }
    return {
      windows: [{ key: 'custom', label: `${refs[fromIdx].label} → ${refs[toIdx].label}`, fromRef: fromIdx, toRef: toIdx }],
      slugs: ch.slugs,
      labels,
      rows,
    };
  }

  async function ensureCustom(showLoading = true) {
    let from = Number(fromSel.value);
    let to = Number(toSel.value);
    if (from >= to) {
      if (from > to) {
        const tmp = from;
        from = to;
        to = tmp;
        fromSel.value = String(from);
        toSel.value = String(to);
      } else {
        to = Math.min(n - 1, from + 1);
        toSel.value = String(to);
      }
    }
    const key = `${from}-${to}`;
    if (custom && customKey === key) return custom;
    const my = ++token;
    if (showLoading) el.querySelector('#wrap').innerHTML = '<div class="empty">Calculando período personalizado…</div>';
    const data = await buildCustom(from, to);
    if (my !== token) return null;
    custom = data;
    customKey = key;
    return custom;
  }

  function allLabels() {
    const src = activeCh();
    const set = new Set();
    const slugs = st.slug ? [st.slug] : src.slugs;
    for (const s of slugs) for (const l of src.labels[s] || []) set.add(l);
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  function filtered() {
    const src = activeCh();
    const wi = src.windows.findIndex((w) => w.key === st.win);
    const slugIdx = st.slug ? src.slugs.indexOf(st.slug) : -1;
    const q = st.q ? norm(st.q) : '';
    const out = [];
    for (const row of src.rows) {
      const [w, si, li, from, to, delta, pct, spark] = row;
      if (w !== (wi < 0 ? 0 : wi)) continue;
      if (slugIdx >= 0 && si !== slugIdx) continue;
      if (st.dir === 'up' && delta <= 0) continue;
      if (st.dir === 'down' && delta >= 0) continue;
      if (st.minDelta && Math.abs(delta) < st.minDelta) continue;
      if (st.minPct && (pct == null || Math.abs(pct) < st.minPct)) continue;
      if (st.status === 'new' && from !== 0) continue;
      if (st.status === 'gone' && to !== 0) continue;
      if (st.status === 'existing' && (from === 0 || to === 0)) continue;
      const label = src.labels[src.slugs[si]][li];
      if (q && !(norm(label).includes(q) || norm(shortCat(src.slugs[si])).includes(q))) continue;
      out.push({ si, li, label, from, to, delta, pct, spark, slug: src.slugs[si] });
    }
    const dir = st.sortDir === 'asc' ? 1 : -1;
    const key = {
      abs: (r) => Math.abs(r.delta),
      delta: (r) => r.delta,
      pct: (r) => (r.pct == null ? -Infinity : r.pct),
      from: (r) => r.from,
      to: (r) => r.to,
      label: (r) => norm(r.label),
      cat: (r) => norm(shortCat(r.slug)),
    }[st.sort];
    out.sort((a, b) => {
      if (st.sort === 'label') return naturalCompare(a.label, b.label) * dir;
      const va = key(a);
      const vb = key(b);
      if (typeof va === 'string') return va.localeCompare(vb, 'pt-BR') * dir;
      return (va - vb) * dir;
    });
    return out;
  }

  function drawBars() {
    const rows = filtered();
    const ups = rows.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 8);
    const downs = rows.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 8);
    hBars(el.querySelector('#ups'), {
      items: ups.map((r) => ({ label: `${r.label} · ${shortCat(r.slug)}`, value: r.delta, color: 'var(--pos)' })),
      fmt: (v) => `+${fmtInt(v)}`,
    });
    hBars(el.querySelector('#downs'), {
      items: downs.map((r) => ({ label: `${r.label} · ${shortCat(r.slug)}`, value: -r.delta, color: 'var(--neg)' })),
      fmt: (v) => `−${fmtInt(v)}`,
    });
  }

  function sortHeader(key) {
    const arrow = st.sort === key ? (st.sortDir === 'desc' ? ' ↓' : ' ↑') : ' ↕';
    const label = key === 'label' ? 'Valor' : key === 'cat' ? 'Categoria' : key === 'from' ? 'Antes' : key === 'to' ? 'Depois' : key === 'delta' ? 'Δ' : 'Δ%';
    return `<th class="sortable ${key === 'cat' ? 'cat-col' : ''} ${st.sort === key ? 'sorted' : ''}" data-sort="${key}">${label}<span class="arrow">${arrow}</span></th>`;
  }

  function drawTable() {
    const rows = filtered();
    const limit = st.showAll ? rows.length : Math.min(rows.length, 80);
    const shown = rows.slice(0, limit);
    const maxAbs = Math.max(...shown.map((r) => Math.max(r.from, r.to)), 1);

    el.querySelector('#count').textContent = `${rows.length} valores`;
    el.querySelector('#tblSub').textContent = `${winMeta().label}: compara ${store.refs[winMeta().fromRef].label} com ${store.refs[winMeta().toRef].label}.`;
    el.querySelector('#wrap').innerHTML = `<table class="data">
      <thead><tr>${sortHeader('label')}${sortHeader('cat')}${sortHeader('from')}${sortHeader('to')}${sortHeader('delta')}${sortHeader('pct')}<th>Tendência</th></tr></thead>
      <tbody>${shown
        .map(
          (r) => `<tr>
            <td title="${esc(r.label)}"><span class="cell-label">${esc(r.label)}</span>${
              r.from === 0
                ? ' <span class="badge" style="margin-left:6px">novo</span>'
                : r.to === 0
                ? ' <span class="badge" style="margin-left:6px;background:var(--panel-2);color:var(--muted);border-color:var(--line)">extinto</span>'
                : ''
            }<span class="cell-sub">${esc(shortCat(r.slug))}</span></td>
            <td class="dim cat-col"><a href="#/categoria/${r.slug}" style="color:inherit">${esc(shortCat(r.slug))}</a></td>
            <td class="num" style="background:rgba(var(--heat-rgb),${(0.02 + (r.from / maxAbs) * 0.28).toFixed(3)})">${fmtInt(r.from)}</td>
            <td class="num" style="background:rgba(var(--heat-rgb),${(0.02 + (r.to / maxAbs) * 0.28).toFixed(3)})">${fmtInt(r.to)}</td>
            <td class="num">${r.delta > 0 ? `<span class="delta up">▲ ${fmtSigned(r.delta)}</span>` : `<span class="delta down">▼ ${fmtSigned(r.delta)}</span>`}</td>
            <td class="num" style="color:${r.pct > 0 ? 'var(--pos)' : r.pct < 0 ? 'var(--neg)' : 'inherit'}">${r.pct == null ? '–' : `${r.pct > 0 ? '+' : ''}${nf1.format(r.pct)}%`}</td>
            <td>${sparklineSVG(r.spark, r.delta >= 0 ? 'var(--pos)' : 'var(--neg)', 90, 24, false)}</td>
          </tr>`
        )
        .join('')}</tbody>
    </table>`;

    el.querySelectorAll('#wrap th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (st.sort === k) st.sortDir = st.sortDir === 'desc' ? 'asc' : 'desc';
        else {
          st.sort = k;
          st.sortDir = k === 'label' || k === 'cat' ? 'asc' : 'desc';
        }
        el.querySelector('#sortSel').value = st.sort;
        drawTable();
      });
    });

    const more = el.querySelector('#moreWrap');
    if (rows.length > 80 && !st.showAll) {
      more.innerHTML = `<button class="btn" id="more">Mostrar todos os ${rows.length} valores</button>`;
      more.querySelector('#more').addEventListener('click', () => { st.showAll = true; drawTable(); });
    } else more.innerHTML = '';
  }

  function drawFilterInfo() {
    const parts = [];
    if (st.slug) parts.push(`categoria: ${shortCat(st.slug)}`);
    if (st.q) parts.push(`valor contém “${st.q}”`);
    if (st.dir === 'up') parts.push('somente altas');
    if (st.dir === 'down') parts.push('somente quedas');
    if (st.minDelta) parts.push(`|Δ| ≥ ${st.minDelta}`);
    if (st.minPct) parts.push(`|Δ%| ≥ ${st.minPct}%`);
    if (st.status !== 'all') parts.push({ new: 'só novos', gone: 'só extintos', existing: 'só existentes' }[st.status]);
    const total = filtered().length;
    el.querySelector('#filterInfo').textContent = parts.length
      ? `Filtros ativos: ${parts.join(' · ')} — ${total} valores`
      : `${total} valores no período`;
  }

  function redraw() {
    const wm = winMeta();
    el.querySelector('#winLabel').textContent = `${store.refs[wm.fromRef].label} → ${store.refs[wm.toRef].label}`;
    el.querySelector('#valList').innerHTML = allLabels().map((l) => `<option value="${esc(l)}"></option>`).join('');
    drawFilterInfo();
    drawBars();
    drawTable();
  }

  async function setWin(v) {
    st.win = v;
    el.querySelector('#customWrap').hidden = v !== 'custom';
    st.showAll = false;
    if (v === 'custom') {
      try {
        const data = await ensureCustom();
        if (!data) return;
      } catch (e) {
        console.error(e);
        el.querySelector('#wrap').innerHTML = `<div class="empty">Não foi possível calcular o período: ${esc(e.message || e)}</div>`;
        return;
      }
    }
    redraw();
  }

  bindSegs(el, (k, v) => {
    if (k === 'win') setWin(v);
    if (k === 'dir') { st.dir = v; st.showAll = false; redraw(); }
  });
  el.querySelector('#catSel').addEventListener('change', (e) => { st.slug = e.target.value; st.showAll = false; redraw(); });
  el.querySelector('#minDelta').addEventListener('change', (e) => { st.minDelta = Number(e.target.value); st.showAll = false; redraw(); });
  el.querySelector('#minPct').addEventListener('change', (e) => { st.minPct = Number(e.target.value); st.showAll = false; redraw(); });
  el.querySelector('#status').addEventListener('change', (e) => { st.status = e.target.value; st.showAll = false; redraw(); });
  el.querySelector('#sortSel').addEventListener('change', (e) => {
    st.sort = e.target.value;
    st.sortDir = st.sort === 'label' || st.sort === 'cat' ? 'asc' : 'desc';
    drawTable();
  });
  el.querySelector('#q').addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); st.showAll = false; redraw(); }, 160));
  fromSel.addEventListener('change', async () => { await ensureCustom(); redraw(); });
  toSel.addEventListener('change', async () => { await ensureCustom(); redraw(); });

  el.querySelector('#clear').addEventListener('click', () => {
    Object.assign(st, { slug: '', q: '', dir: 'all', minDelta: 0, minPct: 0, status: 'all', showAll: false });
    el.querySelector('#catSel').value = '';
    el.querySelector('#q').value = '';
    el.querySelector('#minDelta').value = '0';
    el.querySelector('#minPct').value = '0';
    el.querySelector('#status').value = 'all';
    el.querySelectorAll('[data-seg="dir"] button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === 'all')));
    redraw();
  });

  el.querySelector('#csv').addEventListener('click', () => {
    const rows = filtered();
    const header = ['valor', 'categoria', 'antes', 'depois', 'delta', 'delta_pct', 'periodo_de', 'periodo_ate'];
    const wm = winMeta();
    downloadFile(
      `usp-mudancas-${st.win}.csv`,
      toCSV(header, rows.map((r) => [r.label, shortCat(r.slug), r.from, r.to, r.delta, r.pct == null ? '' : r.pct, store.refs[wm.fromRef].label, store.refs[wm.toRef].label]))
    );
  });

  redraw();
}
