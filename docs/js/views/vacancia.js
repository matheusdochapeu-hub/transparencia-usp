/* Cargos em vacância (docentes) — Anuário Estatístico da USP, Tabela 2.08. */

import { store } from '../data.js';
import { lineChart, hBars } from '../charts.js';
import { pageHead, card, seg, bindSegs, notice } from '../ui.js';
import { esc, fmtInt, fmtPct, fmtSigned, colorAt, nf1, downloadFile, toCSV, debounce } from '../util.js';

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const total = (v) => (v ? v.iv + v.ip + v.fv + v.fp : 0);
const vagos = (v) => (v ? v.iv + v.fv : 0);
const providos = (v) => (v ? v.ip + v.fp : 0);

export async function render(el) {
  const { index } = store;
  const vac = await store.vacancia();
  if (!vac) {
    el.innerHTML = pageHead({ title: 'Vacância', lead: 'Dados indisponíveis.' });
    return;
  }

  const years = vac.years;
  const last = String(years[years.length - 1]);
  const first = String(years[0]);
  const st = { year: last, sort: 'vagos', dir: 'desc', q: '' };

  const T = (y) => vac.totals[String(y)];

  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Anuário Estatístico · Tabela 2.08',
      title: 'Cargos em vacância',
      lead: 'Cargos de professor autorizados que estão <b>sem provimento</b>, por unidade e campus. É o estoque de vagas que a USP pode (ou não) converter em concurso — não confundir com concursos já abertos.',
      actions: `<a class="btn" href="${vac.sourceUrl}" target="_blank" rel="noopener">Fonte: Anuário USP ↗</a>`,
    })}

    <div class="grid cols-4" style="margin-bottom:16px">
      <div class="kpi" style="--kc:var(--c1)"><span class="k-label">Cargos docentes (${last})</span><span class="k-value">${fmtInt(total(T(last)))}</span><div class="k-foot"><span>inicial + final, todas as unidades</span></div></div>
      <div class="kpi" style="--kc:var(--c3)"><span class="k-label">Em vacância</span><span class="k-value">${fmtInt(vagos(T(last)))}</span><div class="k-foot"><span>${fmtPct((vagos(T(last)) / (total(T(last)) || 1)) * 100)} dos cargos</span></div></div>
      <div class="kpi" style="--kc:var(--c2)"><span class="k-label">Providos</span><span class="k-value">${fmtInt(providos(T(last)))}</span><div class="k-foot"><span>taxa de ocupação ${fmtPct((providos(T(last)) / (total(T(last)) || 1)) * 100)}</span></div></div>
      <div class="kpi" style="--kc:var(--c4)"><span class="k-label">Variação da vacância</span><span class="k-value">${fmtSigned(vagos(T(last)) - vagos(T(first)))}</span><div class="k-foot"><span>desde ${first} (${fmtInt(vagos(T(first)))} → ${fmtInt(vagos(T(last)))})</span></div></div>
    </div>

    <div class="section split">
      <div class="card">
        <div class="card-head">
          <div><h3>Evolução dos cargos</h3><p>Total autorizado, providos e vagos — anos de referência do Anuário.</p></div>
        </div>
        <div id="vChart"></div>
        <div class="legend" id="vLegend"></div>
      </div>
      <div class="card">
        <div class="card-head">
          <div><h3>Vacância por campus</h3><p id="vYearLabel"></p></div>
          <div class="spacer"></div>
          ${seg('year', years.slice(-6).map((y) => ({ v: String(y), label: String(y) })), last)}
        </div>
        <div id="vCampus"></div>
        <p class="hint" id="vRusp" style="margin-top:10px"></p>
      </div>
    </div>

    <div class="section card">
      <div class="card-head">
        <div><h3>Por unidade</h3><p>Cargos inicial e final, vagos e providos. “RUSP” reúne os órgãos centrais (banco de cargos).</p></div>
        <div class="spacer"></div>
        <input type="search" id="vq" placeholder="Filtrar unidade…" style="width:200px" aria-label="Filtrar unidade">
        <button class="btn ghost" id="vcsv">CSV</button>
      </div>
      <div class="table-wrap" id="vTable" style="max-height:62vh"></div>
    </div>

    <div class="section">${notice(
      '<b>O que este dado é — e o que não é.</b> A USP publica anualmente, no Anuário Estatístico, quantos cargos de docente estão <b>vagos</b> (sem provimento) e <b>providos</b>, por unidade. Isso não indica que haverá concurso: a distribuição de cargos entre unidades e a abertura de editais seguem regras próprias (CAA/Reitoria). Para <b>técnicos administrativos</b> a USP não publica a mesma tabela — esse número existe apenas em sistemas internos (Banco de Cargos) e não é acessível publicamente.',
      'warn'
    )}</div>
  `;

  // ---- gráfico de evolução
  const series = [
    { name: 'Cargos autorizados', color: 'var(--muted)', values: years.map((y) => total(T(y))) },
    { name: 'Providos', color: 'var(--c2)', values: years.map((y) => providos(T(y))) },
    { name: 'Em vacância', color: 'var(--c3)', values: years.map((y) => vagos(T(y))) },
  ];
  lineChart(el.querySelector('#vChart'), {
    labels: years.map(String),
    series,
    height: 280,
    fmt: fmtInt,
  });
  el.querySelector('#vLegend').innerHTML = series
    .map((s) => `<span class="item"><span class="swatch" style="background:${s.color}"></span>${esc(s.name)} <b>${fmtInt(s.values[s.values.length - 1])}</b></span>`)
    .join('');

  function drawCampus() {
    const y = st.year;
    el.querySelector('#vYearLabel').textContent = `Cargos em vacância em ${y}`;
    const items = Object.entries(vac.campus)
      .filter(([campus]) => campus !== 'Órgãos centrais (RUSP)')
      .map(([campus, byYear]) => ({ label: campus, value: vagos(byYear[y]), color: 'var(--c3)' }))
      .filter((i) => i.value > 0)
      .sort((a, b) => b.value - a.value);
    hBars(el.querySelector('#vCampus'), { items, fmt: fmtInt });

    const rus = (vac.campus['Órgãos centrais (RUSP)'] || {})[y];
    el.querySelector('#vRusp').innerHTML = rus
      ? `Além dos campi, o banco de cargos dos órgãos centrais (RUSP) concentra <b>${fmtInt(vagos(rus))}</b> cargos de docente vagos — posições não distribuídas às unidades.`
      : '';
  }

  function rows() {
    const y = st.year;
    let list = vac.units.map((u) => {
      const v = (vac.data[u.sigla] || {})[y] || { iv: 0, ip: 0, fv: 0, fp: 0 };
      return { ...u, ...v, total: total(v), vagos: vagos(v), ocup: v.iv + v.ip + v.fv + v.fp ? providos(v) / total(v) : 0 };
    });
    if (st.q) {
      const q = norm(st.q);
      list = list.filter((r) => norm(r.sigla + ' ' + r.name + ' ' + r.campus).includes(q));
    }
    const key = st.sort;
    list.sort((a, b) => (key === 'sigla' ? a.sigla.localeCompare(b.sigla) : (b[key] || 0) - (a[key] || 0)));
    if (st.dir === 'asc') list.reverse();
    return list;
  }

  function drawTable() {
    const list = rows();
    const maxV = Math.max(...list.map((r) => r.total), 1);
    el.querySelector('#vTable').innerHTML = `<table class="data">
      <thead><tr>
        <th class="sortable ${st.sort === 'sigla' ? 'sorted' : ''}" data-sort="sigla">Unidade</th>
        <th>Campus</th>
        <th class="sortable ${st.sort === 'iv' ? 'sorted' : ''}" data-sort="iv">Inicial vagos</th>
        <th>Inicial providos</th>
        <th class="sortable ${st.sort === 'fv' ? 'sorted' : ''}" data-sort="fv">Final vagos</th>
        <th>Final providos</th>
        <th class="sortable ${st.sort === 'vagos' ? 'sorted' : ''}" data-sort="vagos">Total vagos</th>
        <th class="sortable ${st.sort === 'ocup' ? 'sorted' : ''}" data-sort="ocup">Ocupação</th>
      </tr></thead>
      <tbody>${list
        .map(
          (r) => `<tr>
            <td title="${esc(r.name)}"><b>${esc(r.sigla)}</b>${r.name ? ` <span class="hint">${esc(r.name)}</span>` : ''}</td>
            <td class="dim">${esc(r.campus)}</td>
            <td class="num">${fmtInt(r.iv)}</td>
            <td class="num dim">${fmtInt(r.ip)}</td>
            <td class="num">${fmtInt(r.fv)}</td>
            <td class="num dim">${fmtInt(r.fp)}</td>
            <td class="num" style="font-weight:650;background:rgba(var(--heat-rgb),${(0.04 + (r.vagos / maxV) * 0.34).toFixed(3)})">${fmtInt(r.vagos)}</td>
            <td class="num">${r.total ? fmtPct(r.ocup * 100) : '–'}</td>
          </tr>`
        )
        .join('')}</tbody>
      <tfoot><tr>
        <td>${list.length} unidades</td><td></td>
        <td class="num">${fmtInt(list.reduce((a, r) => a + r.iv, 0))}</td>
        <td class="num">${fmtInt(list.reduce((a, r) => a + r.ip, 0))}</td>
        <td class="num">${fmtInt(list.reduce((a, r) => a + r.fv, 0))}</td>
        <td class="num">${fmtInt(list.reduce((a, r) => a + r.fp, 0))}</td>
        <td class="num">${fmtInt(list.reduce((a, r) => a + r.vagos, 0))}</td>
        <td></td>
      </tr></tfoot>
    </table>`;

    el.querySelectorAll('#vTable th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (st.sort === k) st.dir = st.dir === 'desc' ? 'asc' : 'desc';
        else { st.sort = k; st.dir = k === 'sigla' ? 'asc' : 'desc'; }
        drawTable();
      });
    });
  }

  bindSegs(el, (k, v) => { if (k === 'year') { st.year = v; drawCampus(); drawTable(); } });
  el.querySelector('#vq').addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); drawTable(); }, 140));
  el.querySelector('#vcsv').addEventListener('click', () => {
    const list = rows();
    const header = ['unidade', 'nome', 'campus', 'ano', 'inicial_vagos', 'inicial_providos', 'final_vagos', 'final_providos', 'total_vagos'];
    downloadFile(
      `usp-vacancia-docentes-${st.year}.csv`,
      toCSV(header, list.map((r) => [r.sigla, r.name, r.campus, st.year, r.iv, r.ip, r.fv, r.fp, r.vagos]))
    );
  });

  drawCampus();
  drawTable();

  /* ------------------------------------------------ vacância de servidores */
  const serv = await store.vacanciaServidores();
  const extra = document.createElement('div');
  extra.className = 'section';

  if (!serv) {
    extra.innerHTML = `<div class="card">
      <div class="card-head"><div><h3>Vacância de servidores (técnico-administrativos)</h3><p>Aguardando extrato do DRH.</p></div></div>
      ${notice(
        'A USP <b>não publica</b> cargos em vacância desta carreira. Este painel já está preparado para exibi-los: basta importar um arquivo com uma linha por combinação — <code>competencia; unidade; campus; carreira; classe; letra; situacao; quantidade</code> — e rodar <code>python scripts/import_vacancia.py --input arquivo.csv</code>. Enquanto isso, veja a aba <a href="#/tecnicos">Servidores</a> (quadro efetivo) e <a href="#/movimento">Movimento</a> (saldo anual).',
        'warn'
      )}
    </div>`;
  } else {
    const refs = serv.refs;
    const last = refs[refs.length - 1];
    const first = refs[0];
    const T = (r) => serv.totals[r] || { provido: 0, vago: 0 };
    const ocup = (t) => (t.provido + t.vago ? (t.provido / (t.provido + t.vago)) * 100 : 0);
    const units = serv.units || [];

    const rowsS = units
      .map((u) => {
        const d = (serv.data[last] || {})[u.sigla] || {};
        let prov = 0, vago = 0;
        for (const c of Object.values(d)) { prov += c.provido || 0; vago += c.vago || 0; }
        return { ...u, prov, vago, total: prov + vago };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.vago - a.vago);

    const campus = {};
    for (const r of rowsS) campus[r.campus || '—'] = (campus[r.campus || '—'] || 0) + r.vago;

    extra.innerHTML = `<div class="card">
      <div class="card-head"><div><h3>Vacância de servidores (técnico-administrativos)</h3><p>Extrato importado · ${esc(serv.source || 'DRH')} · ${esc(last)}</p></div><div class="spacer"></div><span class="badge">dados importados</span></div>
      <div class="grid cols-4" style="margin-bottom:14px">
        <div class="kpi" style="--kc:var(--c2)"><span class="k-label">Providos</span><span class="k-value">${fmtInt(T(last).provido)}</span></div>
        <div class="kpi" style="--kc:var(--c3)"><span class="k-label">Vagos</span><span class="k-value">${fmtInt(T(last).vago)}</span></div>
        <div class="kpi" style="--kc:var(--c4)"><span class="k-label">Ocupação</span><span class="k-value">${fmtPct(ocup(T(last)))}</span></div>
        <div class="kpi" style="--kc:var(--brand)"><span class="k-label">Variação da vacância</span><span class="k-value">${fmtSigned(T(last).vago - T(first).vago)}</span><div class="k-foot"><span>${esc(first)} → ${esc(last)}</span></div></div>
      </div>
      <div class="split">
        <div><h4 style="font-size:.85rem;margin-bottom:8px">Vagos por campus</h4><div id="svCampus"></div></div>
        <div class="table-wrap" style="max-height:360px">
          <table class="data"><thead><tr><th>Unidade</th><th>Campus</th><th>Providos</th><th>Vagos</th><th>Ocupação</th></tr></thead>
          <tbody>${rowsS.map((r) => `<tr><td>${esc(r.sigla)}</td><td class="dim">${esc(r.campus || '—')}</td><td class="num">${fmtInt(r.prov)}</td><td class="num" style="font-weight:650">${fmtInt(r.vago)}</td><td class="num">${fmtPct(r.total ? (r.prov / r.total) * 100 : 0)}</td></tr>`).join('')}</tbody></table>
        </div>
      </div>
    </div>`;
    el.appendChild(extra);
    hBars(extra.querySelector('#svCampus'), {
      items: Object.entries(campus).map(([c, v]) => ({ label: c, value: v, color: 'var(--c3)' })).sort((a, b) => b.value - a.value),
      fmt: fmtInt,
    });
  }
}
