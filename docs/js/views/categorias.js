/* Índice de categorias. */

import { store } from '../data.js';
import { sparklineSVG } from '../charts.js';
import { pageHead } from '../ui.js';
import { esc, fmtInt, fmtPct, fmtSigned } from '../util.js';

export async function render(el) {
  const { index } = store;
  const cards = store.cards();
  const refs = store.refs;
  const n = store.totals.length;

  el.innerHTML = `
    ${pageHead({
      eyebrow: store.isGlobal ? 'Explorar' : `Recorte · ${store.scopeInfo.name}`,
      title: 'Categorias',
      lead: `Onze recortes do efetivo — de classe e jornada a raça/cor e nacionalidade. Cada categoria tem série mensal desde ${esc(refs[0].label)} e tabelas comparativas entre períodos.`,
      actions: `<a class="btn" href="#/mudancas">Ranking de mudanças</a>`,
    })}
    <div class="grid auto">
      ${cards
        .map((c) => {
          const meta = index.categories.find((x) => x.slug === c.slug);
          const top = c.top;
          const spark = c.spark && c.spark.length > 2 ? sparklineSVG(c.spark, 'var(--brand)', 190, 34) : '';
          const dir = top ? (top.delta > 0 ? 'up' : top.delta < 0 ? 'down' : 'flat') : 'flat';
          return `<a class="cat-card" href="#/categoria/${c.slug}">
            <div class="cc-top">
              <h3>${esc(c.title)}</h3>
              <span class="badge" style="margin-left:auto">${fmtInt(c.nValues)} valores</span>
            </div>
            <p class="cc-desc">${esc(meta?.description || '')}</p>
            <div class="cc-spark">${spark}</div>
            <div class="cc-foot">
              ${
                top
                  ? `<span><b class="cc-big">${esc(top.label)}</b><br><span class="hint">${fmtPct(top.share)} do total · ${fmtInt(top.value)}</span></span>
                     <span class="delta ${dir}" title="Variação em 12 meses">${top.delta > 0 ? '▲' : top.delta < 0 ? '▼' : '·'} ${fmtSigned(top.delta)}</span>`
                  : '<span class="hint">sem dados</span>'
              }
            </div>
          </a>`;
        })
        .join('')}
    </div>
    <p class="hint" style="margin-top:16px">Competência mais recente: <b>${esc(refs[n - 1].label)}</b>. Clique em um cartão para ver a série completa e comparar períodos.</p>
  `;
}
