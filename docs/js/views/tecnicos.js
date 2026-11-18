/* Servidores técnico-administrativos — carreira, sexo e raça/cor por recorte. */

import { store } from '../data.js';
import { lineChart, hBars, donut } from '../charts.js';
import { pageHead, card, notice, seg, bindSegs } from '../ui.js';
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
  const st = { q: '', unit: '', sort: 'total', dir: 'desc', career: 'all' };

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
      lead: 'Quadro <b>efetivo</b> da carreira técnico-administrativa: <b>Básico</b>, <b>Técnico</b> e <b>Superior</b> (analistas), com composição por <b>sexo</b>, <b>raça/cor</b>, <b>faixa etária</b>, <b>nacionalidade</b> e <b>tempo USP</b>. A USP não publica cargos em vacância para esta carreira.',
      actions: `<a class="btn" href="#/vacancia">Vacância (docentes)</a><a class="btn" href="${tec.sourceUrl}" target="_blank" rel="noopener">Fonte: Anuário USP ↗</a>`,
    })}

    <div class="section card" style="margin-bottom:14px">
      <div class="toolbar">
        <span class="hint" style="font-weight:650">Ver por carreira:</span>
        ${seg('career', [
          { v: 'all', label: 'Todas' },
          { v: 'bas', label: 'Básico' },
          { v: 'tec', label: 'Técnico' },
          { v: 'sup', label: 'Superior (analistas)' },
        ], 'all')}
        <div class="spacer"></div>
        <span class="hint">Filtra o gráfico e a tabela de unidades</span>
      </div>
    </div>

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
        <div class="card-head">
          <div><h3>Composição</h3><p id="compSub"></p></div>
          <div class="spacer"></div>
          <select id="dimSel" aria-label="Dimensão da composição">
            <option value="sexo">Sexo</option>
            <option value="raca">Raça/cor</option>
            <option value="faixa">Faixa etária</option>
            <option value="nacionalidade">Nacionalidade</option>
            <option value="tempo">Tempo USP</option>
          </select>
        </div>
        <div id="compChart"></div>
        <div id="compTrend" style="margin-top:6px"></div>
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
  function drawCareer() {
    const series = CARREIRAS.slice(0, 3)
      .filter((c) => st.career === 'all' || c.key === st.career)
      .map((c) => ({
        name: c.name,
        color: c.color,
        values: years.map((y) => aggCareer(String(y))[c.key]),
      }));
    lineChart(el.querySelector('#cChart'), { labels: years.map(String), series, height: 270, fmt: fmtInt });
    el.querySelector('#cLegend').innerHTML = series
      .map((s) => `<span class="item"><span class="swatch" style="background:${s.color}"></span>${esc(s.name)} <b>${fmtInt(s.values[s.values.length - 1])}</b></span>`)
      .join('');
  }
  drawCareer();
  bindSegs(el, (k, v) => {
    if (k === 'career') {
      st.career = v;
      drawCareer();
      drawTable();
      drawComposition();
    }
  });

  /* ------------------------------------------------------ composição */
  const DIMS = {
    sexo: { label: 'Sexo' },
    raca: { label: 'Raça/cor' },
    faixa: { label: 'Faixa etária', slug: 'faixa-etaria' },
    nacionalidade: { label: 'Nacionalidade', slug: 'nacionalidade' },
    tempo: { label: 'Tempo USP', slug: 'tempo-usp' },
  };
  st.dim = 'sexo';

  const careerName = () => (CARREIRAS.find((c) => c.key === st.career) || {}).name || '';
  const aggCareerKind = (field, y, base) =>
    scopedUnits.reduce((a, u) => {
      const v = ((tec[field] || {})[u.sigla] || {})[y];
      if (!v) return a;
      const s = v[st.career] || {};
      for (const k of Object.keys(a)) a[k] += s[k] || 0;
      return a;
    }, { ...base });

  async function drawComposition() {
    const box = el.querySelector('#compChart');
    const sub = el.querySelector('#compSub');
    const trend = el.querySelector('#compTrend');
    if (!box) return;
    trend.innerHTML = '';
    const dim = st.dim;

    if (dim === 'sexo') {
      const s = st.career === 'all' ? sexLast : aggCareerKind('sexCareer', last, { f: 0, m: 0 });
      if (!s || s.f + s.m === 0) {
        box.innerHTML = '<div class="empty">Sem dados de sexo neste recorte.</div>';
        sub.textContent = '';
        return;
      }
      sub.textContent = `Sexo · ${last}${st.career !== 'all' ? ` · ${careerName()}` : ''}`;
      donut(box, {
        items: [
          { label: 'Mulheres', value: s.f, color: 'var(--c6)' },
          { label: 'Homens', value: s.m, color: 'var(--c2)' },
        ],
        size: 150,
        thickness: 20,
        centerLabel: 'servidores',
        fmt: fmtInt,
      });
      const d = st.career === 'all' && sexFirst ? pctF(s) - pctF(sexFirst) : null;
      trend.innerHTML = `<p class="hint">Mulheres: <b>${fmtPct(pctF(s))}</b>${d != null ? ` · ${fmtSigned(+d.toFixed(1))} p.p. desde ${sexYears[0]}` : ''}</p>`;
      return;
    }

    if (dim === 'raca') {
      const empty = { bran: 0, pret: 0, pard: 0, amar: 0, indig: 0, ni: 0 };
      const r = st.career === 'all' ? raceLast : aggCareerKind('raceCareer', last, empty);
      if (!r || sumObj(r) === 0) {
        box.innerHTML = '<div class="empty">Sem dados de raça/cor neste recorte.</div>';
        sub.textContent = '';
        return;
      }
      const total = sumObj(r);
      sub.textContent = `Raça/cor · ${last}${st.career !== 'all' ? ` · ${careerName()}` : ''} · ${fmtPct(pctPP(r))} pretos+pardos`;
      hBars(box, {
        items: RACAS.map((x) => ({ label: x.name, value: r[x.key] || 0, color: x.color })),
        fmt: (v) => `${fmtInt(v)} (${fmtPct((v / total) * 100)})`,
      });
      const d = st.career === 'all' && raceFirst ? pctPP(r) - pctPP(raceFirst) : null;
      trend.innerHTML = `<p class="hint">Pretos + pardos: <b>${fmtPct(pctPP(r))}</b>${d != null ? ` · ${fmtSigned(+d.toFixed(1))} p.p. desde ${raceYears[0]}` : ''}</p>`;
      return;
    }

    // dimensões mensais do Portal (faixa etária, nacionalidade, tempo USP)
    const cfg = DIMS[dim];
    try {
      const c = await store.category(cfg.slug);
      const ri = c.n - 1;
      const items = c.labels
        .map((lab, li) => ({ label: lab, value: c.m.tec[li][ri] }))
        .filter((x) => x.value > 0)
        .sort((a, b) => b.value - a.value);
      const top = items.slice(0, 10);
      const rest = items.slice(10).reduce((a, x) => a + x.value, 0);
      if (rest > 0) top.push({ label: 'Outros', value: rest });
      const total = top.reduce((a, x) => a + x.value, 0) || 1;
      sub.textContent = `${cfg.label} · ${store.refLabels[ri]}${st.career !== 'all' ? ' · total (sem corte por carreira)' : ''}`;
      hBars(box, {
        items: top.map((x) => ({ ...x, color: 'var(--c2)' })),
        fmt: (v) => `${fmtInt(v)} (${fmtPct((v / total) * 100)})`,
      });
      if (st.career !== 'all') {
        trend.innerHTML = '<p class="hint">Faixa etária, nacionalidade e tempo USP vêm da consulta mensal do Portal — sem abertura por carreira (B/T/S).</p>';
      }
    } catch (e) {
      box.innerHTML = '<div class="empty">Dados indisponíveis neste recorte.</div>';
      sub.textContent = '';
    }
  }
  await drawComposition();
  el.querySelector('#dimSel').addEventListener('change', (e) => {
    st.dim = e.target.value;
    drawComposition();
  });

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
    const prevY = years.length > 1 ? String(years[years.length - 2]) : last;
    const fiveY = String(years[Math.max(0, years.length - 6)]);
    let list = scopedUnits
      .map((u) => {
        const v = unitCareer(u, last);
        const total = sumObj(v);
        const prev = sumObj(unitCareer(u, prevY));
        const five = sumObj(unitCareer(u, fiveY));
        return { ...u, ...v, total, d1: total - prev, d5: total - five };
      })
      .filter((r) => r.total > 0);
    if (st.unit) list = list.filter((r) => r.sigla === st.unit);
    if (st.q) {
      const q = norm(st.q);
      list = list.filter((r) => norm(r.sigla + ' ' + r.name + ' ' + r.campus).includes(q));
    }
    const key = st.sort;
    list.sort((a, b) =>
      key === 'sigla' ? a.sigla.localeCompare(b.sigla) : (key === 'd1' || key === 'd5' ? Math.abs(b[key]) - Math.abs(a[key]) : (b[key] || 0) - (a[key] || 0))
    );
    if (st.dir === 'asc') list.reverse();
    return list;
  }

  const deltaCell = (v) =>
    v === 0
      ? '<span class="dim">0</span>'
      : v > 0
      ? `<span class="delta up">▲ ${fmtSigned(v)}</span>`
      : `<span class="delta down">▼ ${fmtSigned(v)}</span>`;

  function drawTable() {
    const list = rows();
    const cols = st.career === 'all' ? CARREIRAS.slice(0, 3) : CARREIRAS.filter((c) => c.key === st.career);
    const val = (r) => (st.career === 'all' ? r.total : r[st.career] || 0);
    const sorted = list.slice().sort((a, b) => val(b) - val(a));
    const total = list.reduce((a, r) => a + val(r), 0) || 1;
    const maxV = Math.max(...list.map(val), 1);
    el.querySelector('#tTable').innerHTML = `<table class="data">
      <thead><tr>
        <th class="sortable ${st.sort === 'sigla' ? 'sorted' : ''}" data-sort="sigla">Unidade</th>
        ${scoped ? '' : '<th>Campus</th>'}
        ${cols.map((c) => `<th class="sortable ${st.sort === c.key ? 'sorted' : ''}" data-sort="${c.key}">${esc(c.name)}</th>`).join('')}
        <th class="sortable ${st.sort === 'total' ? 'sorted' : ''}" data-sort="total">${st.career === 'all' ? 'Total' : esc(cols[0].name)}</th>
        <th class="sortable ${st.sort === 'd1' ? 'sorted' : ''}" data-sort="d1">Δ 1 ano</th>
        <th class="sortable ${st.sort === 'd5' ? 'sorted' : ''}" data-sort="d5">Δ 5 anos</th>
        <th>% do total</th>
      </tr></thead>
      <tbody>${list
        .map(
          (r) => `<tr>
            <td title="${esc(r.name)}"><b>${esc(r.sigla)}</b>${r.name ? ` <span class="hint">${esc(r.name)}</span>` : ''}</td>
            ${scoped ? '' : `<td class="dim">${esc(r.campus)}</td>`}
            ${cols.map((c) => `<td class="num">${fmtInt(r[c.key])}</td>`).join('')}
            <td class="num" style="font-weight:650;background:rgba(var(--heat-rgb),${(0.04 + (val(r) / maxV) * 0.3).toFixed(3)})">${fmtInt(val(r))}</td>
            <td class="num">${deltaCell(r.d1)}</td>
            <td class="num">${deltaCell(r.d5)}</td>
            <td class="num">${fmtPct((val(r) / total) * 100)}</td>
          </tr>`
        )
        .join('')}</tbody>
      <tfoot><tr>
        <td>${list.length} unidades</td>${scoped ? '' : '<td></td>'}
        ${cols.map((c) => `<td class="num">${fmtInt(list.reduce((a, r) => a + (r[c.key] || 0), 0))}</td>`).join('')}
        <td class="num">${fmtInt(total)}</td>
        <td class="num">${deltaCell(list.reduce((a, r) => a + r.d1, 0))}</td>
        <td class="num">${deltaCell(list.reduce((a, r) => a + r.d5, 0))}</td>
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
