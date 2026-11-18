/* Servidores técnico-administrativos por carreira e unidade — Anuário, Tabela 2.14. */

import { store } from '../data.js';
import { lineChart, hBars } from '../charts.js';
import { pageHead, card, bindSegs, notice } from '../ui.js';
import { esc, fmtInt, fmtPct, fmtSigned, downloadFile, toCSV, debounce } from '../util.js';

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const CARREIRAS = [
  { key: 'bas', name: 'Básico', color: 'var(--c4)' },
  { key: 'tec', name: 'Técnico', color: 'var(--c2)' },
  { key: 'sup', name: 'Superior', color: 'var(--c1)' },
  { key: 'out', name: 'Não enquadrado', color: 'var(--faint)' },
];
const sum = (o) => (o ? o.bas + o.tec + o.sup + o.out : 0);

export async function render(el) {
  const { index } = store;
  const tec = await store.tecnicos();
  if (!tec) {
    el.innerHTML = pageHead({ title: 'Técnico-administrativos', lead: 'Dados indisponíveis.' });
    return;
  }

  const years = tec.years;
  const last = String(years[years.length - 1]);
  const first = String(years[0]);
  const st = { year: last, campus: '', q: '', sort: 'total', dir: 'desc' };

  const T = (y) => tec.totals[String(y)];
  const tLast = T(last);
  const tFirst = T(first);

  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Anuário Estatístico · Tabela 2.14',
      title: 'Servidores técnico-administrativos',
      lead: 'Quadro <b>efetivo</b> (servidores providos) por carreira — <b>Básico</b>, <b>Técnico</b> e <b>Superior</b> — e por unidade/campus. A USP não publica cargos em vacância para esta carreira; a vacância existe apenas para docentes.',
      actions: `<a class="btn" href="#/vacancia">Ver vacância (docentes)</a><a class="btn" href="${tec.sourceUrl}" target="_blank" rel="noopener">Fonte: Anuário USP ↗</a>`,
    })}

    <div class="grid cols-4" style="margin-bottom:16px">
      <div class="kpi" style="--kc:var(--brand)"><span class="k-label">Total (${last})</span><span class="k-value">${fmtInt(sum(tLast))}</span><div class="k-foot"><span>${fmtSigned(sum(tLast) - sum(tFirst))} desde ${first}</span></div></div>
      <div class="kpi" style="--kc:var(--c4)"><span class="k-label">Básico</span><span class="k-value">${fmtInt(tLast.bas)}</span><div class="k-foot"><span>${fmtPct((tLast.bas / (sum(tLast) || 1)) * 100)} do quadro</span></div></div>
      <div class="kpi" style="--kc:var(--c2)"><span class="k-label">Técnico</span><span class="k-value">${fmtInt(tLast.tec)}</span><div class="k-foot"><span>${fmtPct((tLast.tec / (sum(tLast) || 1)) * 100)} do quadro</span></div></div>
      <div class="kpi" style="--kc:var(--c1)"><span class="k-label">Superior</span><span class="k-value">${fmtInt(tLast.sup)}</span><div class="k-foot"><span>${fmtPct((tLast.sup / (sum(tLast) || 1)) * 100)} do quadro · inclui analistas</span></div></div>
    </div>

    <div class="section split">
      <div class="card">
        <div class="card-head">
          <div><h3>Evolução por carreira</h3><p>Servidores técnico-administrativos efetivos, por ano de referência.</p></div>
        </div>
        <div id="tChart"></div>
        <div class="legend" id="tLegend"></div>
      </div>
      <div class="card">
        <div class="card-head">
          <div><h3>Por campus</h3><p id="tYearLabel"></p></div>
          <div class="spacer"></div>
          <select id="tYear" aria-label="Ano"></select>
        </div>
        <div id="tCampus"></div>
      </div>
    </div>

    <div class="section card">
      <div class="card-head">
        <div><h3>Por unidade</h3><p>Quadro efetivo por carreira. Use o filtro de campus e a busca.</p></div>
        <div class="spacer"></div>
        <select id="tCampusFilter" aria-label="Filtrar campus"><option value="">Todos os campi</option></select>
        <input type="search" id="tq" placeholder="Filtrar unidade…" style="width:190px" aria-label="Filtrar unidade">
        <button class="btn ghost" id="tcsv">CSV</button>
      </div>
      <div class="table-wrap" id="tTable" style="max-height:62vh"></div>
    </div>

    <div class="section">${notice(
      '<b>Por que não há vacância aqui.</b> O Anuário Estatístico publica cargos <b>vagos e providos</b> apenas para docentes (Tabela 2.08). Para técnicos administrativos existe só o <b>quadro efetivo</b> (Tabela 2.14) — o número de cargos criados e não providos fica no Banco de Cargos, sistema interno do DRH, sem publicação. Se esse extrato for disponibilizado, a estrutura desta aba já está pronta para recebê-lo.<br><br><b>Nota sobre a série.</b> Os totais são anuais (Anuário) e podem diferir alguns casos da contagem mensal do Portal da Transparência, que usa outra base de extração. A categoria <b>Superior</b> agrupa analistas e demais funções de nível superior.',
      'warn'
    )}</div>
  `;

  // ---- gráfico
  const series = CARREIRAS.map((c) => ({
    name: c.name,
    color: c.color,
    values: years.map((y) => T(y)[c.key]),
  }));
  lineChart(el.querySelector('#tChart'), { labels: years.map(String), series, height: 280, fmt: fmtInt });
  el.querySelector('#tLegend').innerHTML = series
    .map(
      (s, i) => `<span class="item"><span class="swatch" style="background:${s.color}"></span>${esc(s.name)} <b>${fmtInt(s.values[s.values.length - 1])}</b></span>`
    )
    .join('');

  // ---- selects
  const yearSel = el.querySelector('#tYear');
  yearSel.innerHTML = years.slice().reverse().map((y) => `<option value="${y}">${y}</option>`).join('');
  yearSel.value = st.year;

  const campi = Object.keys(tec.campus).filter((c) => c !== 'Não identificado');
  el.querySelector('#tCampusFilter').innerHTML =
    '<option value="">Todos os campi</option>' + campi.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

  function drawCampus() {
    el.querySelector('#tYearLabel').textContent = `Quadro efetivo em ${st.year}`;
    const items = campi
      .map((c) => ({ label: c, value: sum(tec.campus[c][st.year]), color: 'var(--c2)' }))
      .filter((i) => i.value > 0)
      .sort((a, b) => b.value - a.value);
    hBars(el.querySelector('#tCampus'), { items, fmt: fmtInt });
  }

  function rows() {
    let list = tec.units
      .map((u) => {
        const v = (tec.data[u.sigla] || {})[st.year] || { bas: 0, tec: 0, sup: 0, out: 0 };
        return { ...u, ...v, total: sum(v) };
      })
      .filter((r) => r.total > 0);
    if (st.campus) list = list.filter((r) => r.campus === st.campus);
    if (st.q) {
      const q = norm(st.q);
      list = list.filter((r) => norm(r.sigla + ' ' + r.name + ' ' + r.campus).includes(q));
    }
    list.sort((a, b) => (st.sort === 'sigla' ? a.sigla.localeCompare(b.sigla) : (b[st.sort] || 0) - (a[st.sort] || 0)));
    if (st.dir === 'asc') list.reverse();
    return list;
  }

  function drawTable() {
    const list = rows();
    const total = list.reduce((a, r) => a + r.total, 0) || 1;
    const maxV = Math.max(...list.map((r) => r.total), 1);
    el.querySelector('#tTable').innerHTML = `<table class="data">
      <thead><tr>
        <th class="sortable ${st.sort === 'sigla' ? 'sorted' : ''}" data-sort="sigla">Unidade</th>
        <th>Campus</th>
        <th class="sortable ${st.sort === 'bas' ? 'sorted' : ''}" data-sort="bas">Básico</th>
        <th class="sortable ${st.sort === 'tec' ? 'sorted' : ''}" data-sort="tec">Técnico</th>
        <th class="sortable ${st.sort === 'sup' ? 'sorted' : ''}" data-sort="sup">Superior</th>
        <th class="sortable ${st.sort === 'total' ? 'sorted' : ''}" data-sort="total">Total</th>
        <th>% do total</th>
      </tr></thead>
      <tbody>${list
        .map(
          (r) => `<tr>
            <td title="${esc(r.name)}"><b>${esc(r.sigla)}</b>${r.name ? ` <span class="hint">${esc(r.name)}</span>` : ''}</td>
            <td class="dim">${esc(r.campus)}</td>
            <td class="num">${fmtInt(r.bas)}</td>
            <td class="num">${fmtInt(r.tec)}</td>
            <td class="num">${fmtInt(r.sup)}</td>
            <td class="num" style="font-weight:650;background:rgba(var(--heat-rgb),${(0.04 + (r.total / maxV) * 0.3).toFixed(3)})">${fmtInt(r.total)}</td>
            <td class="num">${fmtPct((r.total / total) * 100)}</td>
          </tr>`
        )
        .join('')}</tbody>
      <tfoot><tr>
        <td>${list.length} unidades</td><td></td>
        <td class="num">${fmtInt(list.reduce((a, r) => a + r.bas, 0))}</td>
        <td class="num">${fmtInt(list.reduce((a, r) => a + r.tec, 0))}</td>
        <td class="num">${fmtInt(list.reduce((a, r) => a + r.sup, 0))}</td>
        <td class="num">${fmtInt(total)}</td>
        <td>100%</td>
      </tr></tfoot>
    </table>`;

    el.querySelectorAll('#tTable th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (st.sort === k) st.dir = st.dir === 'desc' ? 'asc' : 'desc';
        else { st.sort = k; st.dir = k === 'sigla' ? 'asc' : 'desc'; }
        drawTable();
      });
    });
  }

  yearSel.addEventListener('change', () => { st.year = yearSel.value; drawCampus(); drawTable(); });
  el.querySelector('#tCampusFilter').addEventListener('change', (e) => { st.campus = e.target.value; drawTable(); });
  el.querySelector('#tq').addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); drawTable(); }, 140));
  el.querySelector('#tcsv').addEventListener('click', () => {
    const list = rows();
    const header = ['unidade', 'nome', 'campus', 'ano', 'basico', 'tecnico', 'superior', 'total'];
    downloadFile(
      `usp-tecnicos-${st.year}.csv`,
      toCSV(header, list.map((r) => [r.sigla, r.name, r.campus, st.year, r.bas, r.tec, r.sup, r.total]))
    );
  });

  drawCampus();
  drawTable();
}
