/* Vencimentos dos funcionários (DRH) e evolução real vs. inflação. */

import { store } from '../data.js';
import { lineChart } from '../charts.js';
import { pageHead, card, seg, bindSegs, notice } from '../ui.js';
import { esc, fmtInt, fmtPct, downloadFile, toCSV } from '../util.js';

const LETTERS = ['A', 'B', 'C', 'D'];
const IDX = { ipca: 'IPCA', igpm: 'IGP-M', inpc: 'INPC' };
const money = (v) =>
  v == null ? '–' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });

/** Fator acumulado da inflação entre duas competências (exclusivo no início). */
function factor(series, baseRef, ref) {
  let f = 1;
  for (const [m, v] of series) {
    if (m > baseRef && m <= ref) f *= 1 + v / 100;
  }
  return f;
}

export async function render(el) {
  const venc = await store.vencimentos();
  if (!venc || !venc.editions.length) {
    el.innerHTML = pageHead({ title: 'Vencimentos', lead: 'Dados indisponíveis.' });
    return;
  }

  const eds = venc.editions;
  const base = eds[0].ref;
  const last = eds[eds.length - 1].ref;
  const st = { classe: 'S1', letra: 'A', idx: 'ipca' };

  const valueAt = (ed, classe, letra) => {
    const grau = venc.classes[classe];
    const row = ed.rows.find((r) => r[0] === grau);
    return row ? row[1 + LETTERS.indexOf(letra)] : null;
  };
  const grauDe = (classe) => venc.classes[classe];
  const classesNoGrau = (g) =>
    Object.entries(venc.classes)
      .filter(([, v]) => v === g)
      .map(([k]) => k)
      .join(' · ');

  const series = venc.inflacao[st.idx] || [];
  const fBase = 1;
  const fLast = factor(series, base, last);

  el.innerHTML = `
    ${pageHead({
      eyebrow: 'DRH/USP · Tabelas salariais + Banco Central',
      title: 'Vencimentos',
      lead: 'Evolução nominal e <b>real</b> (deflacionada) dos vencimentos por classe e letra, comparada com <b>IPCA</b>, <b>IGP-M</b> e <b>INPC</b>. Valores de vencimento básico, sem adicionais ou gratificações.',
      actions: `<a class="btn" href="${venc.sourceUrl}" target="_blank" rel="noopener">Fonte: DRH/USP ↗</a>`,
    })}

    <div class="card" style="margin-bottom:16px">
      <div class="toolbar">
        <div class="field" style="gap:3px">
          <label for="classeSel">Classe</label>
          <select id="classeSel">
            ${['Básico', 'Técnico', 'Superior (analista)']
              .map((grupo) => {
                const prefix = grupo[0];
                const opts = Object.keys(venc.classes).filter((k) => k[0] === prefix);
                return `<optgroup label="${grupo}">${opts.map((k) => `<option value="${k}">${k}</option>`).join('')}</optgroup>`;
              })
              .join('')}
          </select>
        </div>
        <div class="field" style="gap:3px">
          <label for="letraSel">Letra</label>
          <select id="letraSel">${LETTERS.map((l) => `<option value="${l}">${l}</option>`).join('')}</select>
        </div>
        <div class="field" style="gap:3px">
          <label>Índice de correção</label>
          ${seg('idx', [{ v: 'ipca', label: 'IPCA' }, { v: 'igpm', label: 'IGP-M' }, { v: 'inpc', label: 'INPC' }], 'ipca')}
        </div>
        <div class="spacer" style="flex:1"></div>
        <span class="hint" id="rangeInfo"></span>
      </div>
    </div>

    <div class="grid cols-4" style="margin-bottom:16px" id="kpis"></div>

    <div class="section card">
      <div class="card-head">
        <div><h3>Evolução do vencimento</h3><p id="chartSub"></p></div>
      </div>
      <div id="vChart"></div>
      <div class="legend" id="vLegend"></div>
    </div>

    <div class="section card">
      <div class="card-head"><div><h3>Edições da tabela</h3><p>Valor nominal, valor real (a preços de ${esc(base)}) e variações.</p></div><div class="spacer"></div><button class="btn ghost" id="vcsv">CSV</button></div>
      <div class="table-wrap" id="vTable" style="max-height:440px"></div>
    </div>

    <div class="section card">
      <div class="card-head"><div><h3>Tabela vigente · ${esc(last)}</h3><p>Grau/faixa × letra, com as classes que ocupam cada grau. Fonte: DRH/USP.</p></div></div>
      <div class="table-wrap" id="grid" style="max-height:none"></div>
    </div>

    <div class="section card">
      <div class="card-head">
        <div><h3>Se o índice tivesse sido aplicado</h3><p id="corrSub"></p></div>
      </div>
      <div class="table-wrap" id="corrTable" style="max-height:560px"></div>
    </div>

    <div class="section">${notice(
      'Os valores são o <b>vencimento básico</b> da tabela do DRH (grau/faixa × letra), sem adicionais, gratificações, quinquênios ou vantagens pessoais. A comparação real usa o índice acumulado entre a competência-base e cada edição — <b>não</b> é ganho de poder de compra individual, pois a progressão na carreira (mudança de grau/letra) não está incluída.',
      'info'
    )}</div>
  `;

  const classeSel = el.querySelector('#classeSel');
  const letraSel = el.querySelector('#letraSel');
  classeSel.value = st.classe;
  letraSel.value = st.letra;

  function currentIdx() {
    return venc.inflacao[st.idx] || [];
  }

  function draw() {
    const classe = st.classe;
    const letra = st.letra;
    const grau = grauDe(classe);
    const seriesIdx = currentIdx();
    const first = valueAt(eds[0], classe, letra);
    const lastV = valueAt(eds[eds.length - 1], classe, letra);
    const fIpca = factor(venc.inflacao.ipca || [], base, last);
    const fIgpm = factor(venc.inflacao.igpm || [], base, last);
    const fInpc = factor(venc.inflacao.inpc || [], base, last);
    const fSel = factor(seriesIdx, base, last);

    const nomVar = first ? ((lastV / first) - 1) * 100 : null;
    const realVar = first && fSel ? ((lastV / fSel) / first - 1) * 100 : null;

    el.querySelector('#rangeInfo').textContent = `${base} → ${last} · ${eds.length} edições`;

    el.querySelector('#kpis').innerHTML = `
      <div class="kpi" style="--kc:var(--brand)"><span class="k-label">Vencimento em ${esc(last)}</span><span class="k-value" style="font-size:1.4rem">${money(lastV)}</span><div class="k-foot"><span>${esc(classe)} · letra ${esc(letra)} · grau ${grau}</span></div></div>
      <div class="kpi" style="--kc:var(--c3)"><span class="k-label">Variação nominal</span><span class="k-value">${nomVar == null ? '–' : fmtPct(nomVar)}</span><div class="k-foot"><span>${money(first)} → ${money(lastV)}</span></div></div>
      <div class="kpi" style="--kc:var(--c2)"><span class="k-label">Variação real · ${IDX[st.idx]}</span><span class="k-value">${realVar == null ? '–' : fmtPct(realVar)}</span><div class="k-foot"><span>deflacionado pelo ${IDX[st.idx]} (${fmtPct((fSel - 1) * 100)} no período)</span></div></div>
      <div class="kpi" style="--kc:var(--c4)"><span class="k-label">Inflação acumulada</span><span class="k-value">${fmtPct((fIpca - 1) * 100)}</span><div class="k-foot"><span>IPCA · IGP-M ${fmtPct((fIgpm - 1) * 100)} · INPC ${fmtPct((fInpc - 1) * 100)}</span></div></div>
    `;

    const labels = eds.map((e) => e.ref);
    const nominal = eds.map((e) => valueAt(e, classe, letra));
    const real = eds.map((e) => {
      const v = valueAt(e, classe, letra);
      const f = factor(seriesIdx, base, e.ref);
      return f ? v / f : v;
    });

    lineChart(el.querySelector('#vChart'), {
      labels,
      series: [
        { name: 'Nominal', color: 'var(--brand)', values: nominal },
        { name: `Real (${IDX[st.idx]})`, color: 'var(--c2)', values: real },
      ],
      height: 300,
      fmt: money,
    });
    el.querySelector('#vLegend').innerHTML = `
      <span class="item"><span class="swatch" style="background:var(--brand)"></span>Nominal <b>${money(lastV)}</b></span>
      <span class="item"><span class="swatch" style="background:var(--c2)"></span>Real (${IDX[st.idx]}, a preços de ${esc(base)}) <b>${money(lastV / (fSel || 1))}</b></span>`;

    el.querySelector('#chartSub').textContent = `${classe} · letra ${letra} — valores em R$; linha real deflacionada pelo ${IDX[st.idx]}.`;

    el.querySelector('#vTable').innerHTML = `<table class="data">
      <thead><tr><th>Edição</th><th>Nominal</th><th>Real (${IDX[st.idx]})</th><th>Δ nominal</th><th>Δ real</th></tr></thead>
      <tbody>${eds
        .map((e, i) => {
          const v = valueAt(e, classe, letra);
          const f = factor(seriesIdx, base, e.ref);
          const realV = f ? v / f : v;
          const prev = i > 0 ? valueAt(eds[i - 1], classe, letra) : null;
          const prevF = i > 0 ? factor(seriesIdx, base, eds[i - 1].ref) : 1;
          const dNom = prev ? ((v / prev) - 1) * 100 : null;
          const dReal = prev ? ((v / f) / (prev / prevF) - 1) * 100 : null;
          return `<tr>
            <td>${esc(e.ref)}</td>
            <td class="num">${money(v)}</td>
            <td class="num">${money(realV)}</td>
            <td class="num" style="color:${dNom > 0 ? 'var(--pos)' : dNom < 0 ? 'var(--neg)' : 'inherit'}">${dNom == null ? '–' : `${dNom > 0 ? '+' : ''}${fmtPct(dNom)}`}</td>
            <td class="num" style="color:${dReal > 0 ? 'var(--pos)' : dReal < 0 ? 'var(--neg)' : 'inherit'}">${dReal == null ? '–' : `${dReal > 0 ? '+' : ''}${fmtPct(dReal)}`}</td>
          </tr>`;
        })
        .join('')}</tbody>
    </table>`;

    const grid = eds[eds.length - 1];
    el.querySelector('#grid').innerHTML = `<table class="data">
      <thead><tr><th>Grau / faixa</th><th>A</th><th>B</th><th>C</th><th>D</th><th>Classes neste grau</th></tr></thead>
      <tbody>${grid.rows
        .map(
          (r) => `<tr>
            <td><b>${r[0]}</b></td>
            ${r.slice(1).map((v) => `<td class="num" ${r[0] === grau ? 'style="font-weight:650;background:rgba(var(--heat-rgb),.12)"' : ''}>${money(v)}</td>`).join('')}
            <td class="dim">${esc(classesNoGrau(r[0]))}</td>
          </tr>`
        )
        .join('')}</tbody>
    </table>`;

    // ---- salário se o índice tivesse sido aplicado ----------------------
    const fIdx = factor(currentIdx(), base, last);
    const combos = [];
    for (const classe of Object.keys(venc.classes)) {
      for (const letra of LETTERS) {
        const b0 = valueAt(eds[0], classe, letra);
        const cur = valueAt(eds[eds.length - 1], classe, letra);
        const corr = b0 * fIdx;
        combos.push({
          classe, letra, b0, cur, corr,
          nom: (cur / b0 - 1) * 100,
          real: (cur / corr - 1) * 100,
        });
      }
    }
    const abaixo = combos.filter((c) => c.real < 0).length;
    const media = combos.reduce((a, c) => a + c.real, 0) / combos.length;
    el.querySelector('#corrSub').innerHTML =
      `Salário de ${esc(base)} corrigido apenas pelo <b>${IDX[st.idx]}</b> (${fmtPct((fIdx - 1) * 100)} no período) ` +
      `comparado com o salário atual. <b>${abaixo} de ${combos.length}</b> combinações classe/letra perderam poder de compra; ` +
      `perda média de <b>${fmtPct(Math.abs(media))}</b>.`;
    el.querySelector('#corrTable').innerHTML = `<table class="data">
      <thead><tr>
        <th>Classe</th><th>Letra</th><th>${esc(base)}</th><th>Atual (${esc(last)})</th><th>Se só o ${IDX[st.idx]}</th><th>Δ nominal</th><th>Δ real (ganho/perda)</th>
      </tr></thead>
      <tbody>${combos
        .map(
          (c) => `<tr>
            <td><b>${esc(c.classe)}</b></td>
            <td>${esc(c.letra)}</td>
            <td class="num">${money(c.b0)}</td>
            <td class="num">${money(c.cur)}</td>
            <td class="num">${money(c.corr)}</td>
            <td class="num">${c.nom > 0 ? '+' : ''}${fmtPct(c.nom)}</td>
            <td class="num" style="color:${c.real >= 0 ? 'var(--pos)' : 'var(--neg)'};font-weight:600">${c.real > 0 ? '+' : ''}${fmtPct(c.real)}</td>
          </tr>`
        )
        .join('')}</tbody>
    </table>`;
  }

  bindSegs(el, (k, v) => {
    if (k === 'idx') {
      st.idx = v;
      draw();
    }
  });
  classeSel.addEventListener('change', () => {
    st.classe = classeSel.value;
    draw();
  });
  letraSel.addEventListener('change', () => {
    st.letra = letraSel.value;
    draw();
  });

  el.querySelector('#vcsv').addEventListener('click', () => {
    const header = ['edicao', 'classe', 'letra', 'grau', 'nominal', 'real_' + st.idx];
    const rows = eds.map((e) => {
      const v = valueAt(e, st.classe, st.letra);
      const f = factor(currentIdx(), base, e.ref);
      return [e.ref, st.classe, st.letra, grauDe(st.classe), v.toFixed(2), (v / f).toFixed(2)];
    });
    downloadFile(`usp-vencimentos-${st.classe}-${st.letra}.csv`, toCSV(header, rows));
  });

  draw();
}
