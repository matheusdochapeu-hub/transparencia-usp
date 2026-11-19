/* Tabela de dados e exportações. */

import { store } from '../data.js';
import { pageHead, card } from '../ui.js';
import { esc, fmtInt, fmtSigned, toCSV, downloadFile, nf0 } from '../util.js';

export async function render(el) {
  const { index } = store;
  const refs = store.refs;
  const T = store.totals;
  const n = T.length;
  const pop = store.population;
  const popLong = store.popLong;
  const csvDir = pop === 'todos' ? 'data/csv' : pop === 'ativo' ? 'data/csv/ativos' : 'data/csv/aposentados';
  const popVal = (t) => (pop === 'ativo' ? t[0] + t[1] : pop === 'apos' ? t[2] + t[3] : t[0] + t[1] + t[2] + t[3]);

  const rowsDesc = refs.map((r, i) => i).reverse();
  const body = rowsDesc
    .map((i) => {
      const [doc, tec, da, ta] = T[i];
      const ativo = doc + tec;
      const apos = da + ta;
      const total = ativo + apos;
      const d = i > 0 ? popVal(T[i]) - popVal(T[i - 1]) : null;
      return `<tr>
        <td>${esc(refs[i].label)}</td>
        <td class="num">${fmtInt(doc)}</td>
        <td class="num">${fmtInt(tec)}</td>
        <td class="num" style="font-weight:650">${fmtInt(ativo)}</td>
        <td class="num">${fmtInt(da)}</td>
        <td class="num">${fmtInt(ta)}</td>
        <td class="num" style="font-weight:650">${fmtInt(apos)}</td>
        <td class="num">${fmtInt(total)}</td>
        <td class="num">${d == null ? '–' : d > 0 ? `<span class="delta up">+${fmtInt(d)}</span>` : d < 0 ? `<span class="delta down">${fmtInt(d)}</span>` : '<span class="dim">0</span>'}</td>
      </tr>`;
    })
    .join('');

  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Dados abertos',
      title: 'Dados e exportações',
      lead: store.isGlobal
        ? `Série completa extraída do Portal da Transparência da USP: ${n} competências, 11 categorias, sem identificação individual. Baixe os arquivos brutos ou use os links abaixo. <b>Os CSVs por categoria trazem ${esc(popLong)}</b> — troque a população no topo para baixar os demais recortes.`
        : `Recorte atual: <b>${esc(store.scopeInfo.name)}</b> (${n} competências). A tabela abaixo reflete este recorte; os arquivos para download continuam sendo os consolidados da USP.`,
      actions: `<button class="btn primary" id="dlAll">Baixar totais (CSV)</button>`,
    })}

    <div class="grid cols-3">
      ${card({
        title: 'Cobertura',
        body: `<div class="stat-row" style="flex-direction:column;gap:12px">
          <div class="stat"><span class="s-label">Primeira competência</span><span class="s-value">${esc(refs[0].label)}</span></div>
          <div class="stat"><span class="s-label">Última competência</span><span class="s-value">${esc(refs[n - 1].label)}</span></div>
          <div class="stat"><span class="s-label">Meses</span><span class="s-value">${n}</span></div>
          <div class="stat"><span class="s-label">Atualizado em</span><span class="s-value" style="font-size:.86rem">${esc((index.generatedAt || '').slice(0, 10).split('-').reverse().join('/'))}</span></div>
        </div>`,
      })}
      ${card({
        title: 'CSV por categoria',
        sub: `Uma coluna por competência, uma linha por valor · ${popLong}.`,
        body: `<div style="display:flex;flex-wrap:wrap;gap:6px">
          ${index.categories
            .map((c) => `<a class="btn" href="${csvDir}/${c.slug}.csv" download>${esc(c.title)}</a>`)
            .join('')}
          <a class="btn" href="data/csv/totais.csv" download>Totais</a>
        </div>
        <p class="hint" style="margin-top:10px">Para outros recortes: <a href="data/csv/ativos/categoria.csv" download>CSVs de ativos</a> · <a href="data/csv/aposentados/categoria.csv" download>CSVs de aposentados</a> · <a href="data/csv/categoria.csv" download>CSVs de todos os vínculos</a>.</p>`,
      })}
      ${card({
        title: 'JSON estruturado',
        sub: 'Formato compacto usado pelo painel.',
        body: `<div style="display:flex;flex-wrap:wrap;gap:6px">
          <a class="btn" href="data/index.json" download>index.json</a>
          ${index.categories.map((c) => `<a class="btn" href="${c.file}" download>${esc(c.title)}</a>`).join('')}
        </div>
        <p class="hint" style="margin-top:10px">As linhas usam <code>[refIdx, labelIdx, doc, tecAdm, docApos, tecAdmApos]</code> e só incluem valores não-zero.</p>`,
      })}
    </div>

    <div class="section card">
      <div class="card-head"><div><h3>Totais por competência</h3><p>Ativos e aposentados aparecem em colunas próprias e em subtotais; a última coluna mostra a variação mensal da população selecionada (<b>${esc(popLong)}</b>).</p></div></div>
      <div class="table-wrap" style="max-height:60vh">
        <table class="data">
          <thead><tr><th>Competência</th><th>Doc. ativos</th><th>Serv. ativos</th><th>Ativos</th><th>Doc. aposentados</th><th>Serv. aposentados</th><th>Aposentados</th><th>Total</th><th>Δ mês</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>

    <div class="section card">
      <div class="card-head"><div><h3>Dicionário de dados</h3></div></div>
      <div class="table-wrap" style="max-height:none">
        <table class="data dict" style="font-size:.8rem">
          <thead><tr><th style="text-align:left">Campo</th><th style="text-align:left">Significado</th></tr></thead>
          <tbody style="text-align:left">
            <tr><td><code>competencia</code></td><td>Mês de referência publicado pelo portal (ex.: Out/2026).</td></tr>
            <tr><td><code>doc</code></td><td>Servidores docentes ativos.</td></tr>
            <tr><td><code>tecAdm</code></td><td>Servidores técnicos e administrativos ativos.</td></tr>
            <tr><td><code>ativo</code></td><td>Soma de <code>doc</code> + <code>tecAdm</code> (efetivo ativo).</td></tr>
            <tr><td><code>docApos</code></td><td>Docentes aposentados.</td></tr>
            <tr><td><code>tecAdmApos</code></td><td>Servidores aposentados.</td></tr>
            <tr><td><code>apos</code></td><td>Soma de <code>docApos</code> + <code>tecAdmApos</code>.</td></tr>
            <tr><td><code>descricao</code></td><td>Valor da categoria (ex.: "Prof Doutor", "Feminino", "RDIDP").</td></tr>
            <tr><td><code>funcao-estrutura</code></td><td>Categoria especial: conta servidores ativos em funções de estrutura; a coluna <code>doc</code> representa o total de servidores.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  el.querySelector('#dlAll').addEventListener('click', () => {
    const header = ['competencia', 'docentes_ativos', 'servidores_ativos', 'ativos', 'docentes_aposentados', 'servidores_aposentados', 'aposentados', 'total'];
    const rows = refs.map((r, i) => {
      const [doc, tec, da, ta] = T[i];
      return [r.label, doc, tec, doc + tec, da, ta, da + ta, doc + tec + da + ta];
    });
    downloadFile('usp-totais-servidores.csv', toCSV(header, rows));
  });
}
