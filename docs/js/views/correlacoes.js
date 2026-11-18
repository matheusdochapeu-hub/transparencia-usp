/* Correlações entre séries de categorias distintas. */

import { store } from '../data.js';
import { scatterChart } from '../charts.js';
import { pageHead, card, seg, bindSegs, corrColor, notice } from '../ui.js';
import { esc, fmtPct, pearson, spearman, pValue, linreg, nf1, debounce } from '../util.js';

const TRANSFORMS = [
  { v: 'diff', label: 'Variação mensal' },
  { v: 'share', label: 'Participação %' },
  { v: 'level', label: 'Nível (contagem)' },
];
const WINDOWS = [
  { v: '24m', label: '24 meses' },
  { v: '60m', label: '5 anos' },
  { v: 'all', label: 'Tudo' },
];

const MAXSEL = 24;
const SHORT = {
  categoria: 'Vínculo',
  classe: 'Classe',
  'faixa-etaria': 'Idade',
  formacao: 'Formação',
  funcao: 'Função',
  'funcao-estrutura': 'Estrutura',
  jornada: 'Jornada',
  nacionalidade: 'Nac.',
  'raca-cor': 'Raça',
  sexo: 'Sexo',
  'tempo-usp': 'Tempo',
};

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export async function render(el) {
  const { index } = store;
  const n = index.refs.length;

  el.innerHTML = `${pageHead({
    eyebrow: 'Analisar',
    title: 'Correlações entre categorias',
    lead: 'Compara a trajetória mensal de indicadores de categorias diferentes. Por padrão usamos a <b>variação mensal da participação</b>, que reduz correlações espúrias causadas por tendências comuns.',
  })}
  <div class="loading-wrap" style="padding:8vh 0"><div class="spinner"></div><p>Carregando as 11 categorias…</p></div>`;

  const cats = await store.allCategories();

  /* ------------------------------------------------------ indicadores */
  const paletteBySlug = Object.fromEntries(index.categories.map((c, i) => [c.slug, `var(--c${(i % 8) + 1})`]));
  const inds = [];
  for (const cat of cats) {
    const ordered = cat.labels.map((_, i) => i).sort((a, b) => cat.m.total[b][n - 1] - cat.m.total[a][n - 1]);
    const take = cat.labels.length <= 4 ? ordered : ordered.slice(0, 4);
    for (const li of take) {
      const label = cat.labels[li];
      if (!label || /^total$/i.test(label)) continue;
      inds.push({
        key: `${cat.slug}:${li}`,
        cat,
        li,
        label,
        name: label,
        catTitle: cat.title,
        color: paletteBySlug[cat.slug],
      });
    }
  }

  const st = {
    transform: 'diff',
    window: 'all',
    method: 'pearson',
    selected: new Set(),
    q: '',
    pair: null,
  };
  // seleção inicial: até 2 por categoria
  {
    const perCat = {};
    for (const ind of inds) {
      perCat[ind.cat.slug] = (perCat[ind.cat.slug] || 0) + 1;
      if (perCat[ind.cat.slug] <= 2) st.selected.add(ind.key);
    }
  }

  function startIdx() {
    if (st.window === '24m') return Math.max(1, n - 24);
    if (st.window === '60m') return Math.max(1, n - 60);
    return 1;
  }

  function seriesFor(ind) {
    const arr = ind.cat.m.total[ind.li];
    const tot = ind.cat.colTotals.total;
    const out = new Array(n).fill(null);
    const s = startIdx();
    for (let i = s; i < n; i++) {
      if (st.transform === 'level') out[i] = arr[i];
      else if (st.transform === 'share') out[i] = tot[i] ? (arr[i] / tot[i]) * 100 : null;
      else out[i] = tot[i] && tot[i - 1] ? (arr[i] / tot[i] - arr[i - 1] / tot[i - 1]) * 100 : null;
    }
    return out;
  }

  function corr(a, b) {
    return st.method === 'spearman' ? spearman(a, b) : pearson(a, b);
  }

  /* ------------------------------------------------------ layout */
  const selectedList = () => inds.filter((i) => st.selected.has(i.key));

  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Analisar',
      title: 'Correlações entre categorias',
      lead: 'Compara a trajetória mensal de indicadores de categorias diferentes. Por padrão usamos a <b>variação mensal da participação</b>, que reduz correlações espúrias causadas por tendências comuns.',
    })}
    <div class="card" style="margin-bottom:16px">
      <div class="toolbar">
        ${seg('transform', TRANSFORMS, st.transform)}
        ${seg('window', WINDOWS, st.window)}
        ${seg('method', [{ v: 'pearson', label: 'Pearson' }, { v: 'spearman', label: 'Spearman' }], st.method)}
        <div class="spacer" style="flex:1"></div>
        <span class="hint" id="nsel"></span>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><div><h3>Séries no cálculo</h3><p>Marque até 24 indicadores — a matriz usa exatamente os selecionados.</p></div><div class="spacer"></div>
        <input type="search" id="pq" placeholder="Buscar indicador…" style="width:240px" aria-label="Buscar indicador">
      </div>
      <div id="picker" style="max-height:190px;overflow:auto;display:flex;flex-direction:column;gap:10px"></div>
    </div>

    <div class="card">
      <div class="card-head"><div><h3>Matriz de correlação</h3><p id="matSub"></p></div></div>
      <div style="display:flex;align-items:center;gap:8px;font-size:.7rem;color:var(--muted);margin-bottom:8px;flex-wrap:wrap">
        <span>−1</span>
        <span style="width:120px;height:8px;border-radius:4px;background:linear-gradient(90deg,#b91c1c,#f3d6d6,#e3eef1,#0e7490)"></span>
        <span>+1</span>
        <span style="margin-left:6px">vermelho = associação negativa · azul = positiva · clique numa célula para ver a dispersão</span>
      </div>
      <div class="table-wrap" id="matrix" style="max-height:70vh"></div>
    </div>

    <div class="section" id="pairSec"></div>

    <div class="section card">
      <div class="card-head"><div><h3>Pares mais associados</h3><p>Maiores |r| entre os indicadores selecionados. Ordene por força e confira o p-valor.</p></div></div>
      <div class="table-wrap" id="pairs" style="max-height:420px"></div>
    </div>

    <div class="section">${notice(
      '<b>Leia com cautela.</b> Correlação não implica causalidade. Séries curtas, mudanças de metodologia do portal e comparações múltiplas produzem associações por acaso — um p-valor baixo não garante relação real. Além disso, muitas categorias variam quase proporcionalmente ao efetivo total, o que produz r muito alto entre quase todos os pares; nesses casos a associação diz mais sobre o tamanho da USP do que sobre os grupos. Use a matriz como ponto de partida para hipóteses, não como conclusão.',
      'warn'
    )}</div>
  `;

  function drawPicker() {
    const q = st.q ? norm(st.q) : '';
    const groups = new Map();
    for (const ind of inds) {
      if (q && !norm(ind.catTitle + ' ' + ind.label).includes(q)) continue;
      if (!groups.has(ind.cat.slug)) groups.set(ind.cat.slug, []);
      groups.get(ind.cat.slug).push(ind);
    }
    el.querySelector('#picker').innerHTML = [...groups.entries()]
      .map(
        ([slug, list]) => `<div>
          <div class="hint" style="font-weight:650;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">${esc(list[0].catTitle)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">
            ${list
              .map(
                (ind) => `<button class="pill" data-key="${esc(ind.key)}" aria-pressed="${st.selected.has(ind.key)}" style="--pc:${ind.color}">
                  <span class="swatch"></span>${esc(ind.label)}</button>`
              )
              .join('')}
          </div>
        </div>`
      )
      .join('') || '<div class="empty">Nenhum indicador.</div>';

    el.querySelectorAll('#picker [data-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.key;
        if (st.selected.has(k)) st.selected.delete(k);
        else {
          if (st.selected.size >= MAXSEL) {
            btn.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], { duration: 180 });
            return;
          }
          st.selected.add(k);
        }
        drawPicker();
        drawMatrix();
        drawPairs();
      });
    });
  }

  function drawMatrix() {
    const list = selectedList();
    el.querySelector('#nsel').textContent = `${list.length} de ${MAXSEL} indicadores`;
    el.querySelector('#matSub').textContent =
      st.transform === 'diff'
        ? 'Correlação entre variações mensais da participação (p.p.).'
        : st.transform === 'share'
        ? 'Correlação entre níveis de participação (%).'
        : 'Correlação entre contagens absolutas — sujeita a tendências comuns.';

    if (list.length < 2) {
      el.querySelector('#matrix').innerHTML = '<div class="empty">Selecione ao menos dois indicadores.</div>';
      return;
    }
    const series = list.map(seriesFor);
    const m = list.map((_, i) => list.map((__, j) => (i === j ? { r: 1, n: series[i].filter((v) => v != null).length } : corr(series[i], series[j]))));

    const shortLabel = (s) => (s.length > 24 ? s.slice(0, 23).trimEnd() + '…' : s);
    const head = `<thead><tr><th style="text-align:left">Indicador</th>${list
      .map(
        (ind) =>
          `<th title="${esc(ind.catTitle + ' · ' + ind.label)}" style="height:120px;vertical-align:bottom;padding:0 2px;font-size:.63rem;min-width:28px">
            <div style="transform:rotate(-58deg);transform-origin:left bottom;white-space:nowrap;width:0;text-align:left">
              <span style="display:inline-block;padding-bottom:5px">${esc(SHORT[ind.cat.slug] || ind.catTitle)} · ${esc(shortLabel(ind.label))}</span>
            </div>
          </th>`
      )
      .join('')}</tr></thead>`;

    const body = list
      .map(
        (ind, i) => `<tr>
          <td title="${esc(ind.catTitle + ' · ' + ind.label)}" style="font-size:.72rem">
            <span class="row-label"><span class="swatch" style="background:${ind.color}"></span><span class="t">${esc(ind.label)} <span class="dim">· ${esc(ind.catTitle)}</span></span></span>
          </td>
          ${m[i]
            .map((cell, j) => {
              if (i === j) return `<td style="background:var(--line);color:var(--muted)">1</td>`;
              const r = cell.r;
              const txt = Number.isFinite(r) ? (Math.abs(r) >= 0.995 ? (r > 0 ? '1' : '−1') : r.toFixed(2).replace('.', ',')) : '–';
              return `<td class="corr-cell" data-i="${i}" data-j="${j}" title="${esc(list[i].label)} × ${esc(list[j].label)}&#10;r = ${Number.isFinite(r) ? r.toFixed(3) : '–'} · n = ${cell.n}" style="background:${corrColor(r)};color:${Math.abs(r) > 0.55 ? '#fff' : 'var(--ink)'};cursor:pointer;font-size:.68rem">${txt}</td>`;
            })
            .join('')}
        </tr>`
      )
      .join('');

    el.querySelector('#matrix').innerHTML = `<table class="data corr-table" style="font-size:.72rem">${head}<tbody>${body}</tbody></table>`;
    el.querySelectorAll('#matrix .corr-cell').forEach((td) => {
      td.addEventListener('click', () => {
        const i = Number(td.dataset.i), j = Number(td.dataset.j);
        st.pair = [list[i], list[j]];
        drawPair();
      });
    });
  }

  function drawPairs() {
    const list = selectedList();
    const series = list.map(seriesFor);
    const rows = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const { r, n: nn } = corr(series[i], series[j]);
        if (!Number.isFinite(r)) continue;
        rows.push({ a: list[i], b: list[j], r, n: nn, p: pValue(r, nn) });
      }
    }
    rows.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
    el.querySelector('#pairs').innerHTML = `<table class="data">
      <thead><tr><th>Indicador A</th><th>Indicador B</th><th>r</th><th>n</th><th>p</th></tr></thead>
      <tbody>${rows
        .slice(0, 40)
        .map(
          (row) => `<tr data-a="${esc(row.a.key)}" data-b="${esc(row.b.key)}" style="cursor:pointer">
            <td>${esc(row.a.label)} <span class="dim">· ${esc(row.a.catTitle)}</span></td>
            <td>${esc(row.b.label)} <span class="dim">· ${esc(row.b.catTitle)}</span></td>
            <td class="num" style="background:${corrColor(row.r)};color:${Math.abs(row.r) > 0.55 ? '#fff' : 'var(--ink)'};font-weight:600">${row.r.toFixed(2)}</td>
            <td class="num dim">${row.n}</td>
            <td class="num">${row.p < 0.001 ? '<0,001' : row.p.toFixed(3).replace('.', ',')}</td>
          </tr>`
        )
        .join('')}</tbody></table>`;
    el.querySelectorAll('#pairs tbody tr').forEach((tr) => {
      tr.addEventListener('click', () => {
        const a = inds.find((i) => i.key === tr.dataset.a);
        const b = inds.find((i) => i.key === tr.dataset.b);
        if (a && b) { st.pair = [a, b]; drawPair(); }
      });
    });
  }

  function drawPair() {
    const sec = el.querySelector('#pairSec');
    if (!st.pair) { sec.innerHTML = ''; return; }
    const [a, b] = st.pair;
    const xa = seriesFor(a), yb = seriesFor(b);
    const points = [];
    for (let i = 0; i < n; i++) {
      if (xa[i] != null && yb[i] != null) points.push({ x: xa[i], y: yb[i], label: index.refs[i].label });
    }
    const { r, n: nn } = corr(xa, yb);
    if (!Number.isFinite(r) || nn < 3) {
      sec.innerHTML = `<div class="card">${notice('Não há observações suficientes para calcular a correlação com esta combinação de filtros.', 'warn')}</div>`;
      return;
    }
    const p = pValue(r, nn);
    const line = linreg(xa, yb);
    const strength = Math.abs(r) >= 0.7 ? 'forte' : Math.abs(r) >= 0.4 ? 'moderada' : 'fraca';

    sec.innerHTML = `<div class="grid cols-2">
      <div class="card">
        <div class="card-head"><div><h3>${esc(a.label)} × ${esc(b.label)}</h3>
          <p>${esc(a.catTitle)} · ${esc(b.catTitle)} — ${nn} observações</p></div></div>
        <div id="scatter"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Estatísticas</h3><p>${st.method === 'spearman' ? 'Spearman (postos)' : 'Pearson'} · ${TRANSFORMS.find((t) => t.v === st.transform).label.toLowerCase()}</p></div></div>
        <div class="stat-row" style="gap:26px">
          <div class="stat"><span class="s-label">r</span><span class="s-value" style="color:${r >= 0 ? 'var(--c2)' : 'var(--neg)'}">${r.toFixed(3).replace('.', ',')}</span></div>
          <div class="stat"><span class="s-label">r²</span><span class="s-value">${(r * r * 100).toFixed(1).replace('.', ',')}%</span></div>
          <div class="stat"><span class="s-label">p-valor</span><span class="s-value">${p < 0.001 ? '<0,001' : p.toFixed(3).replace('.', ',')}</span></div>
          <div class="stat"><span class="s-label">n</span><span class="s-value">${nn}</span></div>
        </div>
        <p style="margin-top:14px;font-size:.84rem;color:var(--ink-2)">
          Associação <b>${strength}</b> e ${r >= 0 ? 'positiva' : 'negativa'}: quando <b>${esc(a.label)}</b> ${st.transform === 'diff' ? 'sobe em relação ao mês anterior' : 'aumenta'}, <b>${esc(b.label)}</b> tende a ${r >= 0 ? 'subir' : 'cair'}.
          ${line ? `<br><span class="regress">y = ${line.intercept.toFixed(2).replace('.', ',')} + ${line.slope.toFixed(3).replace('.', ',')}·x</span>` : ''}
        </p>
        <p class="hint" style="margin-top:14px">Use o gráfico para checar se a relação é monotônica ou se depende de poucos meses atípicos. Um único ponto extremo pode inflar o r.</p>
      </div>
    </div>`;

    scatterChart(sec.querySelector('#scatter'), {
      points,
      xLabel: a.label,
      yLabel: b.label,
      color: a.color,
      line,
      height: 320,
      fmtX: (v) => (st.transform === 'level' ? String(Math.round(v)) : nf1.format(v)),
      fmtY: (v) => (st.transform === 'level' ? String(Math.round(v)) : nf1.format(v)),
    });
  }

  bindSegs(el, (k, v) => {
    if (k === 'transform') { st.transform = v; drawMatrix(); drawPairs(); if (st.pair) drawPair(); }
    if (k === 'window') { st.window = v; drawMatrix(); drawPairs(); if (st.pair) drawPair(); }
    if (k === 'method') { st.method = v; drawMatrix(); drawPairs(); if (st.pair) drawPair(); }
  });
  el.querySelector('#pq').addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); drawPicker(); }, 140));

  drawPicker();
  drawMatrix();
  drawPairs();
}
