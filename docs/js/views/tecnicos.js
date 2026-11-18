/* Servidores técnico-administrativos — carreira, sexo e raça/cor por recorte. */

import { store } from '../data.js';
import { lineChart, hBars, donut } from '../charts.js';
import { pageHead, card, notice } from '../ui.js';
import { esc, fmtInt, fmtPct, fmtSigned, downloadFile, toCSV, debounce } from '../util.js';

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const CARREIRAS = [
  { key: 'bas', name: 'Básico', color: 'var(--c4)' },
  { key: 'tec', name: 'Técnico', color: 'var(--c2)' },
  { key: 'sup', name: 'Superior', color: 'var(--c1)' },
  { key: 'out', name: 'Não enquadrado', color: 'var(--faint)' },
];
const RACAS = [
  { key: 'bran', name: 'Branca', color: 'var(--c1)' },
  { key: 'pard', name: 'Parda', color: 'var(--c3)' },
  { key: 'pret', name: 'Preta', color: 'var(--c4)' },
  { key: 'amar', name: 'Amarela', color: 'var(--c5)' },
  { key: 'indig', name: 'Indígena', color: 'var(--c2)' },
  { key: 'ni', name: 'Não informado', color: 'var(--faint)' },
];
const sumObj = (o) => (o ? Object.values(o).reduce((a, b) => a + b, 0) : 0);

export async function render(el) {
  const tec = await store.tecnicos();
  if (!tec) {
    el.innerHTML = pageHead({ title: 'Servidores', lead: 'Dados indisponíveis.' });
    return;
  }

  const scoped = !store.isGlobal;
  const scopeName = scoped ? store.scopeInfo.name : '';
  const scopedUnits = scoped
    ? tec.units.filter((u) =>
        store.scopeKey.startsWith('unit-') ? u.sigla === store.scopeKey.slice(5) : u.campus === scopeName
      )
    : tec.units;
  const years = tec.years;
  const last = String(years[years.length - 1]);
  const first = String(years[0]);
  const st = { q: '', unit: '', sort: 'total', dir: 'desc' };

  /* ---------------------------------------------------------- agregadores */
  const unitCareer = (u, y) => (tec.data[u.sigla] || {})[y] || { bas: 0, tec: 0, sup: 0, out: 0 };
  const aggCareer = (y) =>
    scopedUnits.reduce((a, u) => {
      const v = unitCareer(u, y);
      return { bas: a.bas + v.bas, tec: a.tec + v.tec, sup: a.sup + v.sup, out: a.out + v.out };
    }, { bas: 0, tec: 0, sup: 0, out: 0 });

  const sexYears = Object.keys(tec.sexTotals || {}).sort();
  const raceYears = Object.keys(tec.raceTotals || {}).sort();
  const aggSex = (y) =>
    scopedUnits.reduce(
      (a, u) => {
        const v = ((tec.sex || {})[u.sigla] || {})[y];
        return v ? { f: a.f + v.f, m: a.m + v.m } : a;
      },
      { f: 0, m: 0 }
    );
  const aggRace = (y) =>
    scopedUnits.reduce(
      (a, u) => {
        const v = ((tec.race || {})[u.sigla] || {})[y];
        if (!v) return a;
        for (const k of Object.keys(a)) a[k] += v[k] || 0;
        return a;
      },
      { bran: 0, pret: 0, pard: 0, amar: 0, indig: 0, ni: 0 }
    );

  const tLast = aggCareer(last);
  const tFirst = aggCareer(first);
  const totalLast = sumObj(tLast);

  const sexLast = sexYears.includes(last) ? aggSex(last) : null;
  const sexFirst = sexYears.length ? aggSex(sexYears[0]) : null;
  const raceLast = raceYears.includes(last) ? aggRace(last) : null;
  const raceFirst = raceYears.length ? aggRace(raceYears[0]) : null;
  const pctF = (s) => (s && s.f + s.m ? (s.f / (s.f + s.m)) * 100 : null);
  const pctPP = (r) => (r ? ((r.pret + r.pard) / sumObj(r)) * 100 : null);

  el.innerHTML = `
    ${pageHead({
      eyebrow: `Anuário Estatístico · Tabelas 2.14, 2.16 e 2.20`,
      title: scoped ? `Servidores · ${esc(scopeName)}` : 'Servidores',
      lead: 'Quadro <b>efetivo</b> da carreira técnico-administrativa: <b>Básico</b>, <b>Técnico</b> e <b>Superior</b> (analistas), além de <b>sexo</b> e <b>raça/cor</b>. A USP não publica cargos em vacância para esta carreira.',
      actions: `<a class="btn" href="#/vacancia">Vacância (docentes)</a><a class="btn" href="${tec.sourceUrl}" target="_blank" rel="noopener">Fonte: Anuário USP ↗</a>`,
    })}

    <div class="grid cols-4" style="margin-bottom:16px">
      <div class="kpi" style="--kc:var(--brand)"><span class="k-label">Total (${last})</span><span class="k-value">${fmtInt(totalLast)}</span><div class="k-foot"><span>${fmtSigned(totalLast - sumObj(tFirst))} desde ${first}</span></div></div>
      <div class="kpi" style="--kc:var(--c4)"><span class="k-label">Básico</span><span class="k-value">${fmtInt(tLast.bas)}</span><div class="k-foot"><span>${fmtPct((tLast.bas / (totalLast || 1)) * 100)} do quadro</span></div></div>
      <div class="kpi" style="--kc:var(--c2)"><span class="k-label">Técnico</span><span class="k-value">${fmtInt(tLast.tec)}</span><div class="k-foot"><span>${fmtPct((tLast.tec / (totalLast || 1)) * 100)} do quadro</span></div></div>
      <div class="kpi" style="--kc:var(--c1)"><span class="k-label">Superior</span><span class="k-value">${fmtInt(tLast.sup)}</span><div class="k-foot"><span>${fmtPct((tLast.sup / (totalLast || 1)) * 100)} do quadro · analistas</span></div></div>
    </div>

    <div class="section split">
      <div class="card">
        <div class="card-head">
          <div><h3>Evolução por carreira</h3><p>Servidores efetivos por ano de referência${scoped ? ` · ${esc(scopeName)}` : ''}.</p></div>
        </div>
        <div id="cChart"></div>
        <div class="legend" id="cLegend"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Sexo</h3><p id="sexSub"></p></div></div>
        <div id="sexDonut"></div>
        <div id="sexTrend" style="margin-top:8px"></div>
      </div>
    </div>

    <div class="section card">
      <div class="card-head"><div><h3>Raça/cor</h3><p id="raceSub"></p></div></div>
      <div class="split even" style="align-items:start">
        <div id="raceBars"></div>
        <div>
          <div id="raceTrend"></div>
          <p class="hint" style="margin-top:8px">A série de raça/cor começa em ${raceYears[0] || '—'} (Tabela 2.20).</p>
        </div>
      </div>
    </div>

    <div class="section card">
      <div class="card-head">
        <div><h3>Por unidade</h3><p>Quadro efetivo por carreira${scoped ? ' no recorte' : ''}.</p></div>
        <div class="spacer"></div>
        ${store.scopeKey.startsWith('unit-') ? '' : '<select id="unitSel" aria-label="Filtrar unidade"><option value="">Todas as unidades</option></select>'}
        <input type="search" id="tq" placeholder="Filtrar unidade…" style="width:190px" aria-label="Filtrar unidade">
        <button class="btn ghost" id="tcsv">CSV</button>
      </div>
      <div class="table-wrap" id="tTable" style="max-height:460px"></div>
    </div>

    <div class="section">${notice(
      '<b>De onde vem cada recorte.</b> Carreira (Básico/Técnico/Superior) e sexo vêm das tabelas 2.14/2.16 do Anuário (2014–2025); <b>raça/cor</b> existe a partir de 2020 (tabela 2.20). Os totais são anuais e podem diferir da contagem mensal do Portal da Transparência. <b>Superior</b> agrupa analistas e demais funções de nível superior.',
      'info'
    )}</div>
  `;

  /* ---------------------------------------------------------- carreira */
  const series = CARREIRAS.slice(0, 3).map((c) => ({
    name: c.name,
    color: c.color,
    values: years.map((y) => aggCareer(String(y))[c.key]),
  }));
  lineChart(el.querySelector('#cChart'), { labels: years.map(String), series, height: 270, fmt: fmtInt });
  el.querySelector('#cLegend').innerHTML = series
    .map((s) => `<span class="item"><span class="swatch" style="background:${s.color}"></span>${esc(s.name)} <b>${fmtInt(s.values[s.values.length - 1])}</b></span>`)
    .join('');

  /* ---------------------------------------------------------- sexo */
  const sexBox = el.querySelector('#sexDonut');
  if (sexLast && sexLast.f + sexLast.m > 0) {
    el.querySelector('#sexSub').textContent = `${last} · ${fmtPct(pctF(sexLast))} mulheres`;
    donut(sexBox, {
      items: [
        { label: 'Mulheres', value: sexLast.f, color: 'var(--c6)' },
        { label: 'Homens', value: sexLast.m, color: 'var(--c2)' },
      ],
      size: 150,
      thickness: 20,
      centerLabel: 'servidores',
      fmt: fmtInt,
    });
    const trend = sexYears.map((y) => pctF(aggSex(y)));
    const d = pctF(sexLast) - (sexFirst ? pctF(sexFirst) : pctF(sexLast));
    el.querySelector('#sexTrend').innerHTML = `<p class="hint">Mulheres: <b>${fmtPct(pctF(sexLast))}</b> em ${last} · ${fmtSigned(+d.toFixed(1))} p.p. desde ${sexYears[0]}</p>`;
  } else {
    sexBox.innerHTML = '<div class="empty">Sem dados de sexo neste recorte.</div>';
  }

  /* ---------------------------------------------------------- raça */
  const raceBox = el.querySelector('#raceBars');
  if (raceLast && sumObj(raceLast) > 0) {
    const total = sumObj(raceLast);
    el.querySelector('#raceSub').textContent = `${last} · ${fmtPct(pctPP(raceLast))} pretos+pardos`;
    hBars(raceBox, {
      items: RACAS.map((r) => ({ label: r.name, value: raceLast[r.key] || 0, color: r.color })),
      fmt: (v) => `${fmtInt(v)} (${fmtPct((v / total) * 100)})`,
    });
    const d = pctPP(raceLast) - (raceFirst ? pctPP(raceFirst) : pctPP(raceLast));
    el.querySelector('#raceTrend').innerHTML = `<p class="hint">Pretos + pardos: <b>${fmtPct(pctPP(raceLast))}</b> em ${last} · ${fmtSigned(+d.toFixed(1))} p.p. desde ${raceYears[0]}</p>`;
  } else {
    raceBox.innerHTML = '<div class="empty">Sem dados de raça/cor neste recorte.</div>';
  }

  /* ---------------------------------------------------------- tabela */
  const unitSel = el.querySelector('#unitSel');
  if (unitSel) {
    unitSel.innerHTML =
      '<option value="">Todas as unidades</option>' +
      scopedUnits
        .slice()
        .sort((a, b) => a.sigla.localeCompare(b.sigla, 'pt-BR'))
        .map((u) => `<option value="${esc(u.sigla)}">${esc(u.sigla)}${u.name ? ` · ${esc(u.name)}` : ''}</option>`)
        .join('');
    unitSel.addEventListener('change', (e) => {
      st.unit = e.target.value;
      drawTable();
    });
  }

  function rows() {
    let list = scopedUnits
      .map((u) => {
        const v = unitCareer(u, last);
        return { ...u, ...v, total: sumObj(v) };
      })
      .filter((r) => r.total > 0);
    if (st.unit) list = list.filter((r) => r.sigla === st.unit);
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
        ${scoped ? '' : '<th>Campus</th>'}
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
            ${scoped ? '' : `<td class="dim">${esc(r.campus)}</td>`}
            <td class="num">${fmtInt(r.bas)}</td>
            <td class="num">${fmtInt(r.tec)}</td>
            <td class="num">${fmtInt(r.sup)}</td>
            <td class="num" style="font-weight:650;background:rgba(var(--heat-rgb),${(0.04 + (r.total / maxV) * 0.3).toFixed(3)})">${fmtInt(r.total)}</td>
            <td class="num">${fmtPct((r.total / total) * 100)}</td>
          </tr>`
        )
        .join('')}</tbody>
      <tfoot><tr>
        <td>${list.length} unidades</td>${scoped ? '' : '<td></td>'}
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

  el.querySelector('#tq').addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); drawTable(); }, 140));
  el.querySelector('#tcsv').addEventListener('click', () => {
    const list = rows();
    const header = ['unidade', 'nome', 'campus', 'ano', 'basico', 'tecnico', 'superior', 'total'];
    downloadFile(
      `usp-servidores-${last}.csv`,
      toCSV(header, list.map((r) => [r.sigla, r.name, r.campus, last, r.bas, r.tec, r.sup, r.total]))
    );
  });

  drawTable();
}
