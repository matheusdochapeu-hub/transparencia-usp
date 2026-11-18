/* Panorama geral do efetivo. */

import { store } from '../data.js';
import { lineChart, donut, hBars, sparklineSVG } from '../charts.js';
import { esc, fmtInt, fmtPct, fmtSigned, toCSV, downloadFile } from '../util.js';
import { pageHead, card, seg, bindSegs, notice } from '../ui.js';

const VINC = [
  { key: 'doc', name: 'Docentes', color: 'var(--c1)' },
  { key: 'tec', name: 'Servidores', color: 'var(--c2)' },
  { key: 'docApos', name: 'Docentes aposentados', color: 'var(--c3)' },
  { key: 'tecApos', name: 'Servidores aposentados', color: 'var(--c4)' },
];

export async function render(el) {
  const { index } = store;
  const T = store.totals;
  const refs = store.refs;
  const n = T.length;
  const moversAll = store.movers();
  const last = T[n - 1];
  const prev12 = T[Math.max(0, n - 13)];
  const first = T[0];

  const active = last[0] + last[1];
  const active12 = prev12[0] + prev12[1];
  const activeFirst = first[0] + first[1];
  const apos = last[2] + last[3];
  const apos12 = prev12[2] + prev12[3];

  const spark = (getter, k = 24) => sparklineSVG(T.slice(-k).map(getter), 'var(--brand)', 74, 26);
  const kpis = [
    { label: 'Efetivo ativo', value: active, delta: active - active12, pct: active12 ? ((active - active12) / active12) * 100 : null, spark: spark((t) => t[0] + t[1]), color: 'var(--brand)' },
    { label: 'Docentes ativos', value: last[0], delta: last[0] - prev12[0], pct: prev12[0] ? ((last[0] - prev12[0]) / prev12[0]) * 100 : null, spark: spark((t) => t[0]), color: 'var(--c1)' },
    { label: 'Servidores ativos', value: last[1], delta: last[1] - prev12[1], pct: prev12[1] ? ((last[1] - prev12[1]) / prev12[1]) * 100 : null, spark: spark((t) => t[1]), color: 'var(--c2)' },
    { label: 'Aposentados', value: apos, delta: apos - apos12, pct: apos12 ? ((apos - apos12) / apos12) * 100 : null, spark: spark((t) => t[2] + t[3]), color: 'var(--c3)' },
  ];

  const kpiHTML = `<div class="kpis">${kpis
    .map(
      (k) => `<div class="kpi" style="--kc:${k.color}">
        <span class="k-label">${k.label}</span>
        <span class="k-value">${fmtInt(k.value)}</span>
        <div class="k-foot">
          <span class="delta ${k.delta > 0 ? 'up' : k.delta < 0 ? 'down' : 'flat'}">${k.delta > 0 ? '▲' : k.delta < 0 ? '▼' : '·'} ${fmtSigned(k.delta)}</span>
          <span>${k.pct == null ? '' : `(${k.pct > 0 ? '+' : ''}${fmtPct(k.pct)})`} em 12 meses</span>
        </div>
        <div class="k-spark">${k.spark}</div>
      </div>`
    )
    .join('')}</div>`;

  const movers = (moversAll?.lastMonth || []).slice(0, 8);
  const moverRows = movers
    .map((m) => {
      const meta = index.categories.find((c) => c.slug === m.slug);
      return `<tr>
        <td><a href="#/categoria/${m.slug}">${esc(m.label)}</a> <span class="hint">· ${esc(meta?.title || m.slug)}</span></td>
        <td class="num dim">${fmtInt(m.from)}</td>
        <td class="num">${fmtInt(m.to)}</td>
        <td class="num">${m.delta > 0 ? '<span class="delta up">▲ ' + fmtSigned(m.delta) + '</span>' : '<span class="delta down">▼ ' + fmtSigned(m.delta) + '</span>'}</td>
      </tr>`;
    })
    .join('');

  const topDocenteShare = last[0] / (active || 1);
  const firstShare = first[0] / (first[0] + first[1] || 1);
  const bigMove = movers[0];
  const insights = [
    `O efetivo ativo ${active >= activeFirst ? 'cresceu' : 'recuou'} <b>${fmtPct(Math.abs((active - activeFirst) / (activeFirst || 1)) * 100)}</b> desde ${esc(refs[0].label)} (${fmtInt(activeFirst)} → ${fmtInt(active)}).`,
    `Docentes são <b>${fmtPct(topDocenteShare * 100)}</b> do efetivo ativo; em ${esc(refs[0].label)} eram <b>${fmtPct(firstShare * 100)}</b>.`,
    bigMove
      ? `Maior variação no último mês: <b>${esc(bigMove.label)}</b> (${esc(index.categories.find((c) => c.slug === bigMove.slug)?.title)}) com <b>${fmtSigned(bigMove.delta)}</b>.`
      : 'Sem variações relevantes no último mês.',
    `Aposentados somam <b>${fmtInt(apos)}</b> registros — <b>${fmtPct((apos / (active + apos || 1)) * 100)}</b> de todo o efetivo.`,
  ];

  el.innerHTML = `
    ${pageHead({
      eyebrow: store.isGlobal ? 'Portal da Transparência · USP' : `Recorte · ${store.scopeInfo.type === 'campus' ? 'Campus' : 'Unidade'}`,
      title: store.isGlobal ? 'Panorama do efetivo' : `Panorama · ${store.scopeInfo.name}`,
      lead: `Série histórica de ${fmtInt(n)} competências mensais (${esc(refs[0].label)} a ${esc(refs[n - 1].label)}), organizada para comparação. Dados públicos e agregados, sem identificação de pessoas.`,
      actions: `<a class="btn" href="#/dados">Ver dados brutos</a><button class="btn primary" id="dlTotais">Baixar série (CSV)</button>`,
    })}
    ${kpiHTML}

    <div class="section split">
      <section class="card">
        <div class="card-head">
          <div><h3>Evolução do efetivo por vínculo</h3><p>Cada faixa soma o total de servidores registrados na competência.</p></div>
          <div class="spacer"></div>
          ${seg('range', [
            { v: '5a', label: '5 anos' },
            { v: '10a', label: '10 anos' },
            { v: 'tudo', label: 'Tudo' },
          ], 'tudo')}
        </div>
        <div id="mainChart"></div>
        <div id="mainLegend" class="legend"></div>
      </section>
      <section class="card">
        <div class="card-head"><div><h3>Composição atual</h3><p>${esc(refs[n - 1].label)}</p></div></div>
        <div id="donut"></div>
      </section>
    </div>

    <div class="section grid cols-2">
      <section class="card">
        <div class="card-head">
          <div><h3>Maiores mudanças no último mês</h3><p>Variação absoluta de servidores entre ${esc(refs[Math.max(0, n - 2)].label)} e ${esc(refs[n - 1].label)}.</p></div>
          <div class="spacer"></div>
          <a class="btn" href="#/mudancas">Ver ranking completo</a>
        </div>
        ${moverRows ? `<div class="table-wrap" style="max-height:none"><table class="data"><thead><tr><th>Valor</th><th>Antes</th><th>Depois</th><th>Δ</th></tr></thead><tbody>${moverRows}</tbody></table></div>` : '<div class="empty">Sem variações registradas.</div>'}
      </section>
      <section class="card" id="campusCard">
        <div class="card-head"><div><h3>Efetivo por campus</h3><p>${esc(refs[n - 1].label)} · soma dos campi equivale ao total da USP.</p></div></div>
        <div id="campusBars"><div class="skeleton" style="height:210px"></div></div>
        <p class="hint" id="vacHint" style="margin-top:12px"></p>
      </section>
    </div>

    <div class="section">
      ${card({
        title: 'Leituras rápidas',
        sub: 'Observações automáticas sobre os dados mais recentes.',
        body: `<ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:7px;font-size:.86rem;color:var(--ink-2)">${insights.map((i) => `<li>${i}</li>`).join('')}</ul>`,
      })}
    </div>

    <div class="section">${notice('Os números refletem o <b>efetivo registrado</b> na competência, conforme publicado pela USP. Vínculos acumulados (por exemplo, aposentados) aparecem separadamente. Datos mensais podem sofrer pequenas revisões pelo próprio portal.')}</div>
  `;

  const state = { range: 'tudo', off: new Set() };

  const drawMain = () => {
    const start = state.range === '5a' ? Math.max(0, n - 60) : state.range === '10a' ? Math.max(0, n - 120) : 0;
    const idxs = Array.from({ length: n - start }, (_, i) => start + i);
    const labels = idxs.map((i) => refs[i].label);
    const series = VINC.map((v) => ({
      name: v.name,
      color: v.color,
      off: state.off.has(v.key),
      values: idxs.map((i) => T[i][VINC.findIndex((x) => x.key === v.key)]),
    }));
    lineChart(el.querySelector('#mainChart'), { labels, series, stacked: true, height: 286, fmt: (v) => fmtInt(v) });
    el.querySelector('#mainLegend').innerHTML = series
      .map(
        (s, i) => `<span class="item${s.off ? ' off' : ''}" data-legend="${VINC[i].key}" role="button" tabindex="0">
          <span class="swatch" style="background:${s.color}"></span>${esc(s.name)} <b>${fmtInt(s.values[s.values.length - 1])}</b></span>`
      )
      .join('');
    el.querySelectorAll('#mainLegend [data-legend]').forEach((node) => {
      const toggle = () => {
        const k = node.dataset.legend;
        state.off.has(k) ? state.off.delete(k) : state.off.add(k);
        drawMain();
      };
      node.addEventListener('click', toggle);
      node.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
  };

  bindSegs(el, (key, v) => {
    if (key === 'range') { state.range = v; drawMain(); }
  });
  drawMain();

  donut(el.querySelector('#donut'), {
    items: VINC.map((v, i) => ({ label: v.name, value: T[n - 1][i], color: v.color })),
    centerLabel: 'registros',
    fmt: fmtInt,
  });

  el.querySelector('#dlTotais')?.addEventListener('click', () => {
    const header = ['competencia', 'docentes', 'servidores', 'docentes_aposentados', 'servidores_aposentados', 'total'];
    const rows = refs.map((r, i) => [r.label, ...T[i], T[i].reduce((a, b) => a + b, 0)]);
    downloadFile('usp-totais-servidores.csv', toCSV(header, rows));
  });

  // campi (só faz sentido no recorte USP)
  if (!store.isGlobal) {
    el.querySelector('#campusCard')?.remove();
    return;
  }
  const campus = await store.campus();
  const box = el.querySelector('#campusBars');
  if (!box) return;
  if (!campus) {
    box.innerHTML = '<div class="empty">Dados por campus não disponíveis.</div>';
    return;
  }
  const items = campus.campuses
    .map((c) => ({ label: c.name, value: c.series[c.series.length - 1].reduce((a, b) => a + b, 0), color: 'var(--brand)' }))
    .sort((a, b) => b.value - a.value);
  hBars(box, { items, fmt: fmtInt });

  // vacância de docentes (Anuário) — resumo com link (apenas recorte USP)
  const vac = store.isGlobal ? index.vacancia : null;
  const hint = el.querySelector('#vacHint');
  if (vac?.available && vac.totals && hint) {
    const t = vac.totals;
    const vg = t.iv + t.fv;
    const tot = t.iv + t.ip + t.fv + t.fp;
    hint.innerHTML = `<b>${fmtInt(vg)}</b> cargos de docente em vacância em ${vac.year} (${fmtPct((vg / (tot || 1)) * 100)} dos cargos) · <a href="#/vacancia">ver por campus →</a>`;
  }
}
