/* Movimento do quadro técnico-administrativo (saldo anual por recorte). */

import { store } from '../data.js';
import { barsChart, hBars } from '../charts.js';
import { pageHead, card, notice } from '../ui.js';
import { esc, fmtInt, fmtPct, fmtSigned, nf1, downloadFile, toCSV, debounce } from '../util.js';

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const sum = (o) => (o ? o.bas + o.tec + o.sup + o.out : 0);

export async function render(el) {
  const tec = await store.tecnicos();
  if (!tec) {
    el.innerHTML = pageHead({ title: 'Movimento', lead: 'Dados indisponíveis.' });
    return;
  }

  const scoped = !store.isGlobal;
  const scopeName = scoped ? store.scopeInfo.name : '';
  const units = scoped
    ? tec.units.filter((u) =>
        store.scopeKey.startsWith('unit-') ? u.sigla === store.scopeKey.slice(5) : u.campus === scopeName
      )
    : tec.units;
  const years = tec.years;
  const st = { q: '', unit: '', sort: 'd1', dir: 'desc' };

  const unitTotal = (u, y) => sum((tec.data[u.sigla] || {})[y]);
  const totalYear = (y) => units.reduce((a, u) => a + unitTotal(u, String(y)), 0);
  const saldoYear = (i) => (i <= 0 ? null : totalYear(years[i]) - totalYear(years[i - 1]));

  const last = years[years.length - 1];
  const lastSaldo = saldoYear(years.length - 1);
  const fiveAgo = Math.max(0, years.length - 6);
  const saldo5 = totalYear(last) - totalYear(years[fiveAgo]);
  const saldoTotal = totalYear(last) - totalYear(years[0]);

  const unitSaldo = (u, i) => (i <= 0 ? 0 : unitTotal(u, String(years[i])) - unitTotal(u, String(years[i - 1])));

  const perdas = units.filter((u) => unitSaldo(u, years.length - 1) < 0).length;
  const ganhos = units.filter((u) => unitSaldo(u, years.length - 1) > 0).length;

  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Anuário Estatístico · Tabela 2.14',
      title: scoped ? `Movimento · ${esc(scopeName)}` : 'Movimento do quadro',
      lead: 'Saldo líquido anual do quadro técnico-administrativo: quem ganhou e quem perdeu servidores, e em que ano. <b>Não é vacância</b> — é a variação do efetivo entre anos.',
      actions: `<a class="btn" href="#/tecnicos">Ver quadro atual</a><a class="btn" href="#/vacancia">Vacância (docentes)</a>`,
    })}

    <div class="grid cols-4" style="margin-bottom:16px">
      <div class="kpi" style="--kc:${lastSaldo >= 0 ? 'var(--pos)' : 'var(--neg)'}"><span class="k-label">Saldo em ${last}</span><span class="k-value">${fmtSigned(lastSaldo)}</span><div class="k-foot"><span>vs. ${years[years.length - 2]}</span></div></div>
      <div class="kpi" style="--kc:${saldo5 >= 0 ? 'var(--pos)' : 'var(--neg)'}"><span class="k-label">Saldo em 5 anos</span><span class="k-value">${fmtSigned(saldo5)}</span><div class="k-foot"><span>${years[fiveAgo]} → ${last}</span></div></div>
      <div class="kpi" style="--kc:${saldoTotal >= 0 ? 'var(--pos)' : 'var(--neg)'}"><span class="k-label">Saldo desde ${years[0]}</span><span class="k-value">${fmtSigned(saldoTotal)}</span><div class="k-foot"><span>${fmtPct((saldoTotal / (totalYear(years[0]) || 1)) * 100)} do quadro inicial</span></div></div>
      <div class="kpi" style="--kc:var(--c3)"><span class="k-label">Unidades no último ano</span><span class="k-value">${ganhos} ↑ · ${perdas} ↓</span><div class="k-foot"><span>de ${units.filter((u) => unitTotal(u, String(last)) > 0).length} com efetivo</span></div></div>
    </div>

    <div class="section card">
      <div class="card-head"><div><h3>Saldo anual</h3><p>Variação do efetivo em relação ao ano anterior${scoped ? ` · ${esc(scopeName)}` : ''}.</p></div></div>
      <div id="mChart"></div>
    </div>

    <div class="section grid cols-2">
      <div class="card"><div class="card-head"><div><h3>Maiores ganhos em ${last}</h3><p>Unidades que mais cresceram no último ano.</p></div></div><div id="ups"></div></div>
      <div class="card"><div class="card-head"><div><h3>Maiores perdas em ${last}</h3><p>Unidades que mais encolheram no último ano.</p></div></div><div id="downs"></div></div>
    </div>

    <div class="section card">
      <div class="card-head">
        <div><h3>Por unidade</h3><p>Efetivo e saldo acumulado em cada janela.</p></div>
        <div class="spacer"></div>
        ${store.scopeKey.startsWith('unit-') ? '' : '<select id="unitSel" aria-label="Filtrar unidade"><option value="">Todas as unidades</option></select>'}
        <input type="search" id="mq" placeholder="Filtrar unidade…" style="width:180px" aria-label="Filtrar unidade">
        <button class="btn ghost" id="mcsv">CSV</button>
      </div>
      <div class="table-wrap" id="mTable" style="max-height:460px"></div>
    </div>

    <div class="section">${notice(
      'O saldo é a diferença de efetivo entre anos consecutivos do Anuário (Tabela 2.14). Ele <b>não</b> mede vagas: um ano com 10 admissões e 10 saídas tem saldo zero. Para cargos em vacância de servidores a USP não publica dados — veja a aba Vacância (docentes).',
      'info'
    )}</div>
  `;

  // gráfico de saldo anual
  const labels = years.slice(1).map(String);
  const vals = years.map((_, i) => saldoYear(i)).slice(1);
  barsChart(el.querySelector('#mChart'), { labels, values: vals, height: 240, fmt: (v) => fmtSigned(v) });

  // ranking
  const ranked = units
    .map((u) => ({ u, d: unitSaldo(u, years.length - 1) }))
    .filter((x) => x.d !== 0);
  const ups = ranked.filter((x) => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 8);
  const downs = ranked.filter((x) => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 8);
  hBars(el.querySelector('#ups'), {
    items: ups.map((x) => ({ label: x.u.sigla, value: x.d, color: 'var(--pos)' })),
    fmt: (v) => `+${fmtInt(v)}`,
  });
  hBars(el.querySelector('#downs'), {
    items: downs.map((x) => ({ label: x.u.sigla, value: -x.d, color: 'var(--neg)' })),
    fmt: (v) => `−${fmtInt(v)}`,
  });

  // tabela
  function rows() {
    let list = units
      .map((u) => {
        const total = unitTotal(u, String(last));
        const prev = unitTotal(u, String(years[years.length - 2]));
        const five = unitTotal(u, String(years[fiveAgo]));
        const start = unitTotal(u, String(years[0]));
        return {
          ...u,
          total,
          base1: prev,
          base5: five,
          baseAll: start,
          d1: total - prev,
          d5: total - five,
          dAll: total - start,
        };
      })
      .filter((r) => r.total > 0 || r.dAll !== 0);
    if (st.unit) list = list.filter((r) => r.sigla === st.unit);
    if (st.q) {
      const q = norm(st.q);
      list = list.filter((r) => norm(r.sigla + ' ' + r.name + ' ' + r.campus).includes(q));
    }
    const k = st.sort;
    list.sort((a, b) => (k === 'sigla' ? a.sigla.localeCompare(b.sigla) : Math.abs(b[k]) - Math.abs(a[k])));
    if (st.dir === 'asc') list.reverse();
    return list;
  }

  const deltaCell = (v, base) => {
    if (!v) return '<span class="dim">0</span>';
    const pct = base ? (v / base) * 100 : null;
    const cls = v > 0 ? 'up' : 'down';
    const arrow = v > 0 ? '▲' : '▼';
    const pctTxt = pct == null ? '' : ` <span class="dim" style="font-weight:400">(${pct > 0 ? '+' : ''}${nf1.format(pct)}%)</span>`;
    return `<span class="delta ${cls}">${arrow} ${fmtSigned(v)}${pctTxt}</span>`;
  };

  function drawTable() {
    const list = rows();
    const maxV = Math.max(...list.map((r) => Math.abs(r.dAll)), 1);
    el.querySelector('#mTable').innerHTML = `<table class="data">
      <thead><tr>
        <th class="sortable ${st.sort === 'sigla' ? 'sorted' : ''}" data-sort="sigla">Unidade</th>
        ${scoped ? '' : '<th>Campus</th>'}
        <th class="sortable ${st.sort === 'total' ? 'sorted' : ''}" data-sort="total">Efetivo ${last}</th>
        <th class="sortable ${st.sort === 'd1' ? 'sorted' : ''}" data-sort="d1">Saldo 1 ano</th>
        <th class="sortable ${st.sort === 'd5' ? 'sorted' : ''}" data-sort="d5">Saldo 5 anos</th>
        <th class="sortable ${st.sort === 'dAll' ? 'sorted' : ''}" data-sort="dAll">Saldo desde ${years[0]}</th>
      </tr></thead>
      <tbody>${list
        .map(
          (r) => `<tr>
            <td title="${esc(r.name)}"><b>${esc(r.sigla)}</b>${r.name ? ` <span class="hint">${esc(r.name)}</span>` : ''}</td>
            ${scoped ? '' : `<td class="dim">${esc(r.campus)}</td>`}
            <td class="num">${fmtInt(r.total)}</td>
            <td class="num">${deltaCell(r.d1, r.base1)}</td>
            <td class="num">${deltaCell(r.d5, r.base5)}</td>
            <td class="num" style="background:rgba(var(--heat-rgb),${(0.03 + (Math.abs(r.dAll) / maxV) * 0.25).toFixed(3)})">${deltaCell(r.dAll, r.baseAll)}</td>
          </tr>`
        )
        .join('')}</tbody>
    </table>`;

    el.querySelectorAll('#mTable th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (st.sort === k) st.dir = st.dir === 'desc' ? 'asc' : 'desc';
        else { st.sort = k; st.dir = k === 'sigla' ? 'asc' : 'desc'; }
        drawTable();
      });
    });
  }

  const unitSel = el.querySelector('#unitSel');
  if (unitSel) {
    unitSel.innerHTML =
      '<option value="">Todas as unidades</option>' +
      units
        .slice()
        .sort((a, b) => a.sigla.localeCompare(b.sigla, 'pt-BR'))
        .map((u) => `<option value="${esc(u.sigla)}">${esc(u.sigla)}${u.name ? ` · ${esc(u.name)}` : ''}</option>`)
        .join('');
    unitSel.addEventListener('change', (e) => { st.unit = e.target.value; drawTable(); });
  }
  el.querySelector('#mq').addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); drawTable(); }, 140));
  el.querySelector('#mcsv').addEventListener('click', () => {
    const list = rows();
    const header = ['unidade', 'nome', 'campus', 'efetivo_' + last, 'saldo_1ano', 'saldo_5anos', 'saldo_total'];
    downloadFile(
      'usp-movimento.csv',
      toCSV(header, list.map((r) => [r.sigla, r.name, r.campus, r.total, r.d1, r.d5, r.dAll]))
    );
  });

  drawTable();
}
