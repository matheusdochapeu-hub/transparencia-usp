/* Detalhe de uma categoria: evolução, tabela comparativa, comparador e campus. */

import { store, periodColumns } from '../data.js';
import { lineChart, sparklineSVG } from '../charts.js';
import { pageHead, card, seg, bindSegs, heatStyle, notice } from '../ui.js';
import {
  esc, fmtInt, fmtPct, fmtSigned, colorAt, toCSV, downloadFile, debounce, nf1, nf0, naturalCompare,
} from '../util.js';

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const VINC_OPTS = [
  { v: 'total', label: 'Todos' },
  { v: 'doc', label: 'Docentes' },
  { v: 'tec', label: 'Servidores' },
  { v: 'apos', label: 'Aposentados' },
];

export async function render(el, slug) {
  const cat = await store.category(slug);
  const meta = store.meta(slug);
  const refs = store.refs;
  const n = refs.length;
  const isVinculo = meta.kind === 'vinculo';
  const isStructure = meta.kind === 'structure';
  const nLabels = cat.labels.length;

  const st = {
    metric: isStructure ? 'doc' : 'total',
    mode: 'count',
    range: 'tudo',
    chartMode: nLabels > 40 ? 'lines' : 'stacked',
    topN: 8,
    off: new Set(),
    focus: null,
    tableMode: 'anos',
    sortKey: 'current',
    sortDir: 'desc',
    q: '',
    cmpA: Math.max(0, n - 13),
    cmpB: n - 1,
    showAll: false,
  };
  // faixas etárias: ordem natural por idade (21-30 … 71-80, Acima de 81)
  if (meta.slug === 'faixa-etaria') {
    st.sortKey = 'label';
    st.sortDir = 'desc';
  }
  // tempo de casa: até 05 → 06-10 → 11-20 → … → 51-60
  if (meta.slug === 'tempo-usp') {
    st.sortKey = 'label';
    st.sortDir = 'desc';
  }
  // formação: progressão educacional (fundamental incompleto → doutorado)
  const FORMACAO_RANK = [
    'sem instru', 'fundamental ii incompleto', 'fundamental i incompleto', 'fundamental incompleto',
    'fundamental completo', 'fundamental profission', 'fundamental supletivo',
    'medio incompleto', 'medio completo', 'medio profission', 'medio supletivo', 'normal',
    'especializa', 'mba', 'mestrado', 'pos-doutorado', 'doutorado', 'livre docente', 'notorio saber',
  ];
  const formacaoRank = (lab) => {
    const s = norm(lab);
    const i = FORMACAO_RANK.findIndex((k) => s.includes(k));
    return i < 0 ? 999 : i;
  };
  if (meta.slug === 'formacao') {
    st.sortKey = 'label';
    st.sortDir = 'desc';
  }
  // jornada: ordem crescente de horas (RTP 12h, RTC 24h, RDIDP 40h)
  const jornadaRank = (lab) => {
    const s = norm(lab);
    if (s.includes('rdidp')) return 40;
    if (s.includes('rtc')) return 24;
    if (s.includes('rtp')) return 12;
    if (s.includes('nao informado')) return 999;
    const m = s.match(/(\d+)/);
    return m ? Number(m[1]) : 900;
  };
  if (meta.slug === 'jornada') {
    st.sortKey = 'label';
    st.sortDir = 'desc';
  }

  const tot = () => cat.colTotals[st.metric];

  function raw(li, ri) {
    return cat.m[st.metric][li][ri];
  }
  function value(li, ri) {
    if (st.mode === 'share') {
      const denom = tot()[ri];
      return denom ? (raw(li, ri) / denom) * 100 : 0;
    }
    return raw(li, ri);
  }
  const fmtV = (v) => (st.mode === 'share' ? fmtPct(v, 1) : fmtInt(v));
  const fmtSignedV = (v) => (st.mode === 'share' ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf1.format(Math.abs(v))}` : fmtSigned(v));

  /* --------------------------------------------------------------- shell */
  const lastI = n - 1;
  const curTot = tot()[lastI];
  const firstI = 0;
  const deltaTotal = curTot - tot()[firstI];
  const topLi = cat.labels.map((_, i) => i).sort((a, b) => raw(b, lastI) - raw(a, lastI))[0];
  const topShare = raw(topLi, lastI) / (curTot || 1);

  const isPyramid = meta.slug === 'faixa-etaria' || meta.slug === 'tempo-usp';
  let pyramidRows = '';
  if (isPyramid) {
    const rows = cat.labels
      .map((lab, li) => ({ lab, doc: cat.m.doc[li][lastI], tec: cat.m.tec[li][lastI] }))
      .sort((a, b) => naturalCompare(a.lab, b.lab))
      .reverse(); // maiores/mais tempo no topo
    const max = Math.max(1, ...rows.map((r) => Math.max(r.doc, r.tec)));
    pyramidRows = rows
      .map(
        (r) => `<div class="py-row">
          <div class="py-side"><span class="py-val">${fmtInt(r.doc)}</span><span class="py-bar" style="width:${((r.doc / max) * 100).toFixed(1)}%;background:var(--c1)"></span></div>
          <div class="py-label">${esc(r.lab)}</div>
          <div class="py-side right"><span class="py-bar" style="width:${((r.tec / max) * 100).toFixed(1)}%;background:var(--c2)"></span><span class="py-val">${fmtInt(r.tec)}</span></div>
        </div>`
      )
      .join('');
  }

  el.innerHTML = `
    ${pageHead({
      eyebrow: store.isGlobal ? 'Categoria' : `Recorte · ${esc(store.scopeInfo.name)}`,
      title: meta.title,
      lead: meta.description,
      actions: `<button class="btn" id="dlCat">Baixar CSV</button>`,
    })}
    ${
      (meta.breaks || []).length
        ? `<div style="margin-bottom:16px">${notice(
            `O portal reformulou os rótulos desta categoria em <b>${(meta.breaks || [])
              .map((b) => esc(store.refs.find((r) => r.id === b.ref)?.label || b.ref))
              .join(', ')}</b>. Comparações que atravessam essa data podem refletir reclassificação de nomenclatura, não variação real do efetivo.`,
            'warn'
          )}</div>`
        : ''
    }
    ${
      meta.slug === 'jornada'
        ? `<div style="margin-bottom:16px">${notice(
            '<b>Regimes docentes:</b> <b>RDIDP</b> — Regime de Dedicação Integral à Docência e à Pesquisa (40 horas semanais, com exclusividade); <b>RTC</b> — Regime de Turno Completo (24 horas); <b>RTP</b> — Regime de Tempo Parcial (12 horas). As demais linhas são jornadas em horas semanais.',
            'info'
          )}</div>`
        : ''
    }
    <div class="card" style="margin-bottom:16px">
      <div class="stat-row">
        <div class="stat"><span class="s-label">${isStructure ? 'Servidores (último mês)' : 'Total (último mês)'}</span><span class="s-value">${fmtInt(curTot)}</span></div>
        <div class="stat"><span class="s-label">Variação desde ${esc(refs[firstI].label)}</span><span class="s-value">${fmtSigned(deltaTotal)} <span class="hint">(${fmtPct((deltaTotal / (tot()[firstI] || 1)) * 100)})</span></span></div>
        <div class="stat"><span class="s-label">Valores distintos</span><span class="s-value">${fmtInt(nLabels)}</span></div>
        <div class="stat"><span class="s-label">Maior valor em ${esc(refs[lastI].label)}</span><span class="s-value">${esc(cat.labels[topLi])} <span class="hint">(${fmtPct(topShare * 100)})</span></span></div>
        <div class="stat"><span class="s-label">Série</span><span class="s-value">${n} meses</span></div>
      </div>
    </div>

    <div class="section" style="margin-top:0">
      <div class="card">
        <div class="card-head">
          <div><h3>Evolução no tempo</h3><p id="chartSub"></p></div>
          <div class="spacer"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            ${seg('mode', [{ v: 'count', label: 'Contagem' }, { v: 'share', label: 'Participação %' }], 'count')}
            ${seg('range', [{ v: '5a', label: '5 anos' }, { v: '10a', label: '10 anos' }, { v: 'tudo', label: 'Tudo' }], 'tudo')}
          </div>
        </div>
        <div class="toolbar" style="margin-bottom:12px">
          ${
            isVinculo || isStructure
              ? `<span class="hint">${isStructure ? 'Esta categoria conta apenas servidores ativos em funções de estrutura.' : 'Cada faixa representa um vínculo.'}</span>`
              : seg('vinculo', VINC_OPTS, 'total')
          }
          <div class="spacer" style="flex:1"></div>
          ${seg('chartMode', [{ v: 'stacked', label: 'Área' }, { v: 'lines', label: 'Linhas' }], st.chartMode)}
          ${seg('topN', [{ v: '5', label: 'Top 5' }, { v: '8', label: 'Top 8' }, { v: '12', label: 'Top 12' }, { v: '20', label: 'Top 20' }], '8')}
        </div>
        <div id="cChart"></div>
        <div id="cLegend" class="legend"></div>
        <div id="focusBar" class="hint" style="margin-top:6px"></div>
      </div>
    </div>

    ${
      isPyramid
        ? `<div class="section"><div class="card">
            <div class="card-head"><div><h3>${meta.slug === 'faixa-etaria' ? 'Pirâmide etária' : 'Pirâmide por tempo de casa'}</h3><p>Docentes (esquerda) e servidores (direita) em ${esc(refs[lastI].label)}.</p></div></div>
            <div class="legend" style="margin-bottom:8px">
              <span class="item"><span class="swatch" style="background:var(--c1)"></span>Docentes</span>
              <span class="item"><span class="swatch" style="background:var(--c2)"></span>Servidores</span>
            </div>
            <div class="pyramid">${pyramidRows}</div>
          </div></div>`
        : ''
    }

    <div class="section">
      <div class="card">
        <div class="card-head">
          <div><h3>Tabela comparativa por período</h3><p>Valores da categoria em cada coluna; células sombreadas indicam magnitude. Clique em uma linha para destacá-la no gráfico.</p></div>
          <div class="spacer"></div>
          ${seg('tableMode', [{ v: 'anos', label: 'Anual' }, { v: '12m', label: '12 meses' }, { v: '24m', label: '24 meses' }, { v: 'tudo', label: 'Tudo' }], 'anos')}
        </div>
        <div class="table-tools">
          <input type="search" id="q" placeholder="Filtrar valores…" style="width:220px" aria-label="Filtrar valores">
          <select id="sortSel" aria-label="Ordenar por">
            <option value="current">Maior no fim do período</option>
            <option value="delta">Maior variação absoluta</option>
            <option value="pct">Maior variação %</option>
            <option value="label"${meta.slug === 'formacao' || meta.slug === 'jornada' || meta.slug === 'tempo-usp' ? ' selected' : ''}>${meta.slug === 'formacao' ? 'Progressão educacional' : meta.slug === 'jornada' ? 'Jornada (crescente)' : meta.slug === 'tempo-usp' ? 'Tempo de casa (crescente)' : 'Nome (A–Z)'}</option>
          </select>
          <div class="spacer"></div>
          <span class="hint" id="tableCount"></span>
          <button class="btn ghost" id="dlTable">CSV desta tabela</button>
        </div>
        <div class="table-wrap" id="tWrap"></div>
        <div id="moreWrap" style="display:flex;justify-content:center;padding:10px"></div>
      </div>
    </div>

    <div class="section">
      <div class="card">
        <div class="card-head">
          <div><h3>Comparador de dois períodos</h3><p>Veja o que mudou entre duas competências — absolute e relativo.</p></div>
        </div>
        <div class="toolbar" style="margin-bottom:12px">
          <div class="field"><label for="cmpA">Período A</label><select id="cmpA"></select></div>
          <div class="field"><label for="cmpB">Período B</label><select id="cmpB"></select></div>
          <div class="spacer" style="flex:1"></div>
          <span class="hint">Ordenado pela maior mudança absoluta</span>
        </div>
        <div class="table-wrap" id="cmpWrap"></div>
      </div>
    </div>

    <div class="section" id="campusSec"></div>

    <div class="section">${notice('Contagens referem-se a registros de servidores na competência indicada. A soma das categorias equivale ao total do mês correspondente, conforme o Portal da Transparência da USP.')}</div>
  `;

  /* --------------------------------------------------------------- selects */
  const selA = el.querySelector('#cmpA');
  const selB = el.querySelector('#cmpB');
  const opts = refs.map((r, i) => `<option value="${i}">${esc(r.label)}</option>`).join('');
  selA.innerHTML = opts;
  selB.innerHTML = opts;
  selA.value = String(st.cmpA);
  selB.value = String(st.cmpB);

  /* --------------------------------------------------------------- chart */
  function drawChart() {
    const start = st.range === '5a' ? Math.max(0, n - 60) : st.range === '10a' ? Math.max(0, n - 120) : 0;
    const idxs = Array.from({ length: n - start }, (_, i) => start + i);
    const labels = idxs.map((i) => refs[i].label);
    const colT = tot();

    let series;
    let hasOutros = false;
    let stacked = st.chartMode === 'stacked';
    if (st.focus != null) {
      const li = st.focus;
      series = [{ name: cat.labels[li], color: colorAt(li), values: idxs.map((i) => value(li, i)) }];
      stacked = false;
    } else {
      const ordered = cat.labels
        .map((_, i) => i)
        .sort((a, b) => raw(b, lastI) - raw(a, lastI));
      const top = ordered.slice(0, st.topN);
      const visible = top.filter((li) => !st.off.has(li));
      series = visible.map((li) => ({
        name: cat.labels[li],
        color: colorAt(li),
        values: idxs.map((i) => value(li, i)),
      }));
      const restCount = cat.labels.length - top.length;
      if (restCount > 0 && st.chartMode === 'stacked' && visible.length === top.length) {
        const rest = ordered.slice(top.length);
        series.unshift({
          name: `Outros (${rest.length})`,
          color: 'var(--faint)',
          values: idxs.map((i) => {
            if (st.mode === 'share') return Math.max(0, 100 - top.reduce((a, li) => a + value(li, i), 0));
            return Math.max(0, colT[i] - top.reduce((a, li) => a + value(li, i), 0));
          }),
        });
        hasOutros = true;
      }
    }

    lineChart(el.querySelector('#cChart'), {
      labels,
      series,
      stacked: stacked && st.chartMode === 'stacked',
      area: st.chartMode === 'stacked',
      height: 300,
      fmt: fmtV,
    });

    const sub = el.querySelector('#chartSub');
    if (sub) {
      sub.textContent =
        st.mode === 'share'
          ? `Participação de cada valor dentro do total da categoria (${st.range === 'tudo' ? 'série completa' : st.range === '5a' ? 'últimos 5 anos' : 'últimos 10 anos'}).`
          : `Contagem de servidores por valor da categoria (${st.range === 'tudo' ? 'série completa' : st.range === '5a' ? 'últimos 5 anos' : 'últimos 10 anos'}).`;
    }

    const legendBox = el.querySelector('#cLegend');
    if (st.focus != null) {
      legendBox.innerHTML = '';
      el.querySelector('#focusBar').innerHTML = `Foco: <b>${esc(cat.labels[st.focus])}</b> · <a href="#" id="clearFocus">limpar foco</a>`;
      el.querySelector('#clearFocus')?.addEventListener('click', (e) => {
        e.preventDefault();
        st.focus = null;
        drawChart();
        drawTable();
      });
    } else {
      el.querySelector('#focusBar').innerHTML = '';
      const ordered = cat.labels.map((_, i) => i).sort((a, b) => raw(b, lastI) - raw(a, lastI));
      legendBox.innerHTML =
        ordered
          .slice(0, Math.max(st.topN, 8))
          .map(
            (li) => `<span class="item${st.off.has(li) ? ' off' : ''}" data-legend="${li}" role="button" tabindex="0">
            <span class="swatch" style="background:${colorAt(li)}"></span>${esc(cat.labels[li])}</span>`
          )
          .join('') +
        (hasOutros
          ? `<span class="item" style="cursor:default"><span class="swatch" style="background:var(--faint)"></span>Outros (${cat.labels.length - st.topN})</span>`
          : '');
      legendBox.querySelectorAll('[data-legend]').forEach((node) => {
        const toggle = () => {
          const li = Number(node.dataset.legend);
          st.off.has(li) ? st.off.delete(li) : st.off.add(li);
          drawChart();
        };
        node.addEventListener('click', toggle);
        node.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      });
    }
  }

  /* --------------------------------------------------------------- tabela */
  function tableData() {
    const cols = periodColumns(refs, st.tableMode, st.range);
    let lis = cat.labels.map((_, i) => i);
    if (st.q) {
      const q = norm(st.q);
      lis = lis.filter((li) => norm(cat.labels[li]).includes(q));
    }
    const cur = (li) => value(li, cols[cols.length - 1]);
    const first = (li) => value(li, cols[0]);
    const delta = (li) => cur(li) - first(li);
    const pct = (li) => {
      const a = first(li);
      return a ? ((cur(li) - a) / a) * 100 : null;
    };
    const cmp = {
      current: (a, b) => cur(b) - cur(a),
      delta: (a, b) => Math.abs(delta(b)) - Math.abs(delta(a)),
      pct: (a, b) => Math.abs(pct(b) ?? 0) - Math.abs(pct(a) ?? 0),
      label: (a, b) => {
        if (meta.slug === 'formacao') return formacaoRank(cat.labels[a]) - formacaoRank(cat.labels[b]);
        if (meta.slug === 'jornada') {
          const d = jornadaRank(cat.labels[a]) - jornadaRank(cat.labels[b]);
          return d !== 0 ? d : naturalCompare(cat.labels[a], cat.labels[b]);
        }
        return naturalCompare(cat.labels[a], cat.labels[b]);
      },
    }[st.sortKey];
    lis.sort(cmp);
    if (st.sortDir === 'asc') lis.reverse();
    return { cols, lis, cur, first, delta, pct };
  }

  function drawTable() {
    const { cols, lis, cur, first, delta, pct } = tableData();
    const showCols = cols.slice().reverse(); // mais recente primeiro
    const limit = st.showAll ? lis.length : Math.min(lis.length, 60);
    const shown = lis.slice(0, limit);

    let maxCell = 0;
    for (const li of shown) for (const ri of cols) maxCell = Math.max(maxCell, value(li, ri));

    const pinStyle = (v, max) => {
      const s = heatStyle(v, max);
      const m = s.match(/rgba\(var\(--heat-rgb\),([\d.]+)\)/);
      return `--heat-a:${m ? m[1] : 0}`;
    };

    const head = `<tr>
      <th class="sortable ${st.sortKey === 'label' ? 'sorted' : ''}" data-sort="label">Valor <span class="arrow">↕</span></th>
      ${showCols.map((ri, k) => `<th class="${k === 0 ? 'cmp-pin' : ''}">${esc(refs[ri].label)}</th>`).join('')}
      <th class="sortable ${st.sortKey === 'delta' ? 'sorted' : ''}" data-sort="delta">Δ <span class="arrow">↕</span></th>
      <th class="sortable ${st.sortKey === 'pct' ? 'sorted' : ''}" data-sort="pct">Δ% <span class="arrow">↕</span></th>
      <th>Tendência</th>
    </tr>`;

    const body = shown
      .map((li) => {
        const focused = st.focus === li ? ' style="background:color-mix(in srgb, var(--brand) 9%, transparent)"' : '';
        const d = delta(li);
        const p = pct(li);
        const spark = sparklineSVG(cols.map((ri) => value(li, ri)), colorAt(li), 76, 22, false);
        return `<tr data-li="${li}" style="cursor:pointer"${focused}>
          <td title="${esc(cat.labels[li])}"><span class="row-label"><span class="t">${esc(cat.labels[li])}</span></span></td>
          ${showCols
            .map((ri, k) =>
              k === 0
                ? `<td class="num cmp-pin" style="${pinStyle(value(li, ri), maxCell)}">${fmtV(value(li, ri))}</td>`
                : `<td class="num" style="${heatStyle(value(li, ri), maxCell)}">${fmtV(value(li, ri))}</td>`
            )
            .join('')}
          <td class="num">${d > 0 ? `<span class="delta up">${fmtSignedV(d)}</span>` : d < 0 ? `<span class="delta down">${fmtSignedV(d)}</span>` : '<span class="dim">0</span>'}</td>
          <td class="num ${p > 0 ? '' : p < 0 ? '' : 'dim'}" style="color:${p > 0 ? 'var(--pos)' : p < 0 ? 'var(--neg)' : 'inherit'}">${p == null ? '–' : `${p > 0 ? '+' : ''}${nf1.format(p)}%`}</td>
          <td>${spark}</td>
        </tr>`;
      })
      .join('');

    const foot = `<tr>
      <td>Total (${shown.length}${lis.length > shown.length ? ` de ${lis.length}` : ''} valores)</td>
      ${showCols.map((ri, k) => `<td class="num${k === 0 ? ' cmp-pin' : ''}">${fmtV(shown.reduce((a, li) => a + value(li, ri), 0))}</td>`).join('')}
      <td colspan="3"></td>
    </tr>`;

    el.querySelector('#tWrap').innerHTML = `<table class="data"><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
    const tbl = el.querySelector('#tWrap table');
    const w1 = tbl?.querySelector('tbody tr td:first-child')?.getBoundingClientRect().width;
    if (tbl && w1) tbl.style.setProperty('--pin-left', `${Math.round(w1)}px`);
    el.querySelector('#tableCount').textContent = `${lis.length} valores · ${cols.length} períodos`;

    el.querySelectorAll('#tWrap th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (st.sortKey === k) st.sortDir = st.sortDir === 'desc' ? 'asc' : 'desc';
        else { st.sortKey = k; st.sortDir = k === 'label' ? 'asc' : 'desc'; }
        drawTable();
      });
    });
    el.querySelectorAll('#tWrap tbody tr[data-li]').forEach((tr) => {
      tr.addEventListener('click', () => {
        const li = Number(tr.dataset.li);
        st.focus = st.focus === li ? null : li;
        drawChart();
        drawTable();
      });
    });

    if (lis.length > 60 && !st.showAll) {
      const moreWrap = el.querySelector('#moreWrap');
      moreWrap.innerHTML = `<button class="btn" id="showAll">Mostrar todos os ${lis.length} valores</button>`;
      moreWrap.querySelector('#showAll').addEventListener('click', () => { st.showAll = true; drawTable(); });
    } else {
      el.querySelector('#moreWrap').innerHTML = '';
    }
  }

  /* --------------------------------------------------------------- comparador */
  function drawCompare() {
    const A = st.cmpA, B = st.cmpB;
    const rows = cat.labels
      .map((_, li) => {
        const a = value(li, A), b = value(li, B);
        return { li, a, b, d: b - a, pct: a ? ((b - a) / a) * 100 : null };
      })
      .filter((r) => r.a !== 0 || r.b !== 0)
      .sort((x, y) => Math.abs(y.d) - Math.abs(x.d));

    const maxV = Math.max(...rows.map((r) => Math.max(r.a, r.b)), 1);
    const body = rows
      .map(
        (r) => `<tr>
          <td title="${esc(cat.labels[r.li])}">${esc(cat.labels[r.li])}</td>
          <td class="num" style="${heatStyle(r.a, maxV)}">${fmtV(r.a)}</td>
          <td class="num" style="${heatStyle(r.b, maxV)}">${fmtV(r.b)}</td>
          <td class="num">${r.d > 0 ? `<span class="delta up">${fmtSignedV(r.d)}</span>` : r.d < 0 ? `<span class="delta down">${fmtSignedV(r.d)}</span>` : '<span class="dim">0</span>'}</td>
          <td class="num">${r.pct == null ? '–' : `<span style="color:${r.pct > 0 ? 'var(--pos)' : 'var(--neg)'}">${r.pct > 0 ? '+' : ''}${nf1.format(r.pct)}%</span>`}</td>
        </tr>`
      )
      .join('');

    el.querySelector('#cmpWrap').innerHTML = `<table class="data">
      <thead><tr>
        <th>Valor</th>
        <th>${esc(refs[A].label)}</th>
        <th>${esc(refs[B].label)}</th>
        <th>Δ</th>
        <th>Δ%</th>
      </tr></thead>
      <tbody>${body || '<tr><td colspan="5" class="dim">Sem dados</td></tr>'}</tbody>
    </table>`;
  }

  /* --------------------------------------------------------------- campus */
  async function drawCampus() {
    const sec = el.querySelector('#campusSec');
    let cl = null;
    try { cl = await store.campusLatest(); } catch { /* ignore */ }
    if (!cl || !cl.data) { sec.innerHTML = ''; return; }
    const codes = (cl.campuses || []).map((c) => String(c.code));
    const names = Object.fromEntries((cl.campuses || []).map((c) => [String(c.code), c.name]));
    const pick = (row) => {
      const [, doc, tec, docApos, tecApos] = row;
      if (st.metric === 'doc') return doc;
      if (st.metric === 'tec') return tec;
      if (st.metric === 'apos') return docApos + tecApos;
      return doc + tec + docApos + tecApos;
    };
    const byLabel = new Map();
    for (const code of codes) {
      const rows = (cl.data[code] || {})[slug] || [];
      for (const row of rows) {
        const v = pick(row);
        if (!v) continue;
        const label = row[0];
        if (!byLabel.has(label)) byLabel.set(label, {});
        byLabel.get(label)[code] = (byLabel.get(label)[code] || 0) + v;
      }
    }
    if (!byLabel.size) { sec.innerHTML = ''; return; }
    const labels = [...byLabel.entries()]
      .map(([label, m]) => ({ label, m, total: codes.reduce((a, c) => a + (m[c] || 0), 0) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
    const maxCell = Math.max(...labels.flatMap((l) => codes.map((c) => l.m[c] || 0)), 1);

    sec.innerHTML = `<div class="card">
      <div class="card-head">
        <div><h3>Por campus · ${esc(cl.label || cl.ref)}</h3><p>Distribuição do valor selecionado entre os campi. Disponível apenas para a competência mais recente da extração.</p></div>
      </div>
      <div class="table-wrap" style="max-height:none">
        <table class="data">
          <thead><tr><th>Valor</th>${codes.map((c) => `<th>${esc(names[c] || c)}</th>`).join('')}<th>Total</th></tr></thead>
          <tbody>
            ${labels
              .map(
                (l) => `<tr><td>${esc(l.label)}</td>${codes
                  .map((c) => `<td class="num" style="${heatStyle(l.m[c] || 0, maxCell)}">${l.m[c] ? fmtInt(l.m[c]) : '<span class="dim">–</span>'}</td>`)
                  .join('')}<td class="num" style="font-weight:650">${fmtInt(l.total)}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  /* --------------------------------------------------------------- eventos */
  bindSegs(el, (key, v) => {
    if (key === 'mode') { st.mode = v; drawChart(); drawTable(); drawCompare(); }
    if (key === 'range') { st.range = v; drawChart(); }
    if (key === 'vinculo') { st.metric = v; st.off.clear(); drawChart(); drawTable(); drawCompare(); drawCampus(); }
    if (key === 'chartMode') { st.chartMode = v; drawChart(); }
    if (key === 'topN') { st.topN = Number(v); drawChart(); }
    if (key === 'tableMode') { st.tableMode = v; st.showAll = false; drawTable(); }
  });

  el.querySelector('#q').addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); st.showAll = false; drawTable(); }, 160));
  el.querySelector('#sortSel').addEventListener('change', (e) => {
    st.sortKey = e.target.value;
    st.sortDir = st.sortKey === 'label' ? 'asc' : 'desc';
    drawTable();
  });
  selA.addEventListener('change', () => { st.cmpA = Number(selA.value); drawCompare(); });
  selB.addEventListener('change', () => { st.cmpB = Number(selB.value); drawCompare(); });

  el.querySelector('#dlTable')?.addEventListener('click', () => {
    const { cols, lis } = tableData();
    const header = ['valor', ...cols.map((ri) => refs[ri].label)];
    const rows = lis.map((li) => [cat.labels[li], ...cols.map((ri) => +value(li, ri).toFixed(3))]);
    downloadFile(`usp-${slug}-tabela.csv`, toCSV(header, rows));
  });
  el.querySelector('#dlCat')?.addEventListener('click', () => {
    const header = ['valor', ...refs.map((r) => r.label)];
    const rows = cat.labels.map((label, li) => [label, ...cat.refs.map((_, ri) => cat.m.total[li][ri])]);
    downloadFile(`usp-${slug}-serie-completa.csv`, toCSV(header, rows));
  });

  drawChart();
  drawTable();
  drawCompare();
  drawCampus();
}
