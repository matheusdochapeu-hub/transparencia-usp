/* Ranking de mudanças entre períodos. */

import { store } from '../data.js';
import { hBars, sparklineSVG } from '../charts.js';
import { pageHead, card, seg, bindSegs, notice } from '../ui.js';
import { esc, fmtInt, fmtPct, fmtSigned, debounce, nf1 } from '../util.js';

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export async function render(el) {
  const ch = await store.changes();
  const { index } = store;
  if (!ch) {
    el.innerHTML = pageHead({ title: 'Mudanças', lead: 'Ranking indisponível.' });
    return;
  }

  const st = { win: ch.windows.find((w) => w.key === '12m') ? '12m' : ch.windows[0].key, slug: '', q: '', showAll: false };

  const brokenCats = index.categories.filter((c) => (c.breaks || []).length);

  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Comparar',
      title: 'O que mudou',
      lead: 'Ranking de todas as categorias pela variação de efetivo entre duas competências. Use as janelas para olhar o último mês, o ano, cinco anos ou toda a série.',
    })}
    ${
      brokenCats.length
        ? `<div style="margin-bottom:16px">${notice(
            `Atenção: o portal reformulou a nomenclatura de <b>${brokenCats
              .map((c) => esc(c.title))
              .join(', ')}</b> em algum momento da série. Rótulos marcados como <b>novo</b> ou <b>extinto</b> podem ser apenas renomeações.`,
            'warn'
          )}</div>`
        : ''
    }
    <div class="card" style="margin-bottom:16px">
      <div class="toolbar">
        ${seg('win', ch.windows.map((w) => ({ v: w.key, label: w.label })), st.win)}
        <select id="catSel" aria-label="Filtrar categoria">
          <option value="">Todas as categorias</option>
          ${ch.slugs.map((s) => `<option value="${s}">${esc(index.categories.find((c) => c.slug === s)?.title || s)}</option>`).join('')}
        </select>
        <input type="search" id="q" placeholder="Buscar valor…" style="width:220px" aria-label="Buscar valor">
        <div class="spacer" style="flex:1"></div>
        <span class="hint" id="winLabel"></span>
      </div>
    </div>

    <div class="grid cols-2 section" style="margin-top:0">
      <div class="card"><div class="card-head"><div><h3>Maiores altas</h3><p>Variação absoluta no período selecionado.</p></div></div><div id="ups"></div></div>
      <div class="card"><div class="card-head"><div><h3>Maiores quedas</h3><p>Variação absoluta no período selecionado.</p></div></div><div id="downs"></div></div>
    </div>

    <div class="section card">
      <div class="card-head"><div><h3>Tabela completa</h3><p id="tblSub"></p></div><div class="spacer"></div><span class="hint" id="count"></span></div>
      <div class="table-wrap" id="wrap"></div>
      <div id="moreWrap" style="display:flex;justify-content:center;padding:10px"></div>
    </div>
  `;

  const winMeta = () => ch.windows.find((w) => w.key === st.win);

  function filtered() {
    const wi = ch.windows.findIndex((w) => w.key === st.win);
    const slugIdx = st.slug ? ch.slugs.indexOf(st.slug) : -1;
    const q = st.q ? norm(st.q) : '';
    const out = [];
    for (const row of ch.rows) {
      const [w, si, li, from, to, delta, pct, spark] = row;
      if (w !== wi) continue;
      if (slugIdx >= 0 && si !== slugIdx) continue;
      const label = ch.labels[ch.slugs[si]][li];
      if (q && !norm(label).includes(q)) continue;
      out.push({ si, li, label, from, to, delta, pct, spark, slug: ch.slugs[si] });
    }
    out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return out;
  }

  function drawBars() {
    const rows = filtered();
    const ups = rows.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 8);
    const downs = rows.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 8);
    hBars(el.querySelector('#ups'), {
      items: ups.map((r) => ({ label: `${r.label} · ${shortCat(r.slug)}`, value: r.delta, color: 'var(--pos)' })),
      fmt: (v) => `+${fmtInt(v)}`,
    });
    hBars(el.querySelector('#downs'), {
      items: downs.map((r) => ({ label: `${r.label} · ${shortCat(r.slug)}`, value: -r.delta, color: 'var(--neg)' })),
      fmt: (v) => `−${fmtInt(v)}`,
    });
  }

  const shortCat = (slug) => index.categories.find((c) => c.slug === slug)?.title || slug;

  function drawTable() {
    const rows = filtered();
    const limit = st.showAll ? rows.length : Math.min(rows.length, 80);
    const shown = rows.slice(0, limit);
    const maxAbs = Math.max(...shown.map((r) => Math.max(r.from, r.to)), 1);

    el.querySelector('#count').textContent = `${rows.length} valores`;
    el.querySelector('#tblSub').textContent = `${winMeta().label}: compara ${esc(index.refs[winMeta().fromRef].label)} com ${esc(index.refs[winMeta().toRef].label)}.`;
    el.querySelector('#wrap').innerHTML = `<table class="data">
      <thead><tr><th>Valor</th><th>Categoria</th><th>Antes</th><th>Depois</th><th>Δ</th><th>Δ%</th><th>Tendência</th></tr></thead>
      <tbody>${shown
        .map(
          (r) => `<tr>
            <td title="${esc(r.label)}">${esc(r.label)}${
              r.from === 0
                ? ' <span class="badge" style="margin-left:6px">novo</span>'
                : r.to === 0
                ? ' <span class="badge" style="margin-left:6px;background:var(--panel-2);color:var(--muted);border-color:var(--line)">extinto</span>'
                : ''
            }</td>
            <td class="dim"><a href="#/categoria/${r.slug}" style="color:inherit">${esc(shortCat(r.slug))}</a></td>
            <td class="num" style="background:rgba(var(--heat-rgb),${(0.02 + (r.from / maxAbs) * 0.28).toFixed(3)})">${fmtInt(r.from)}</td>
            <td class="num" style="background:rgba(var(--heat-rgb),${(0.02 + (r.to / maxAbs) * 0.28).toFixed(3)})">${fmtInt(r.to)}</td>
            <td class="num">${r.delta > 0 ? `<span class="delta up">▲ ${fmtSigned(r.delta)}</span>` : `<span class="delta down">▼ ${fmtSigned(r.delta)}</span>`}</td>
            <td class="num" style="color:${r.pct > 0 ? 'var(--pos)' : r.pct < 0 ? 'var(--neg)' : 'inherit'}">${r.pct == null ? '–' : `${r.pct > 0 ? '+' : ''}${nf1.format(r.pct)}%`}</td>
            <td>${sparklineSVG(r.spark, r.delta >= 0 ? 'var(--pos)' : 'var(--neg)', 90, 24, false)}</td>
          </tr>`
        )
        .join('')}</tbody>
    </table>`;

    const more = el.querySelector('#moreWrap');
    if (rows.length > 80 && !st.showAll) {
      more.innerHTML = `<button class="btn" id="more">Mostrar todos os ${rows.length} valores</button>`;
      more.querySelector('#more').addEventListener('click', () => { st.showAll = true; drawTable(); });
    } else more.innerHTML = '';
  }

  function redraw() {
    const wm = winMeta();
    el.querySelector('#winLabel').textContent = `${index.refs[wm.fromRef].label} → ${index.refs[wm.toRef].label}`;
    drawBars();
    drawTable();
  }

  bindSegs(el, (k, v) => { if (k === 'win') { st.win = v; st.showAll = false; redraw(); } });
  el.querySelector('#catSel').addEventListener('change', (e) => { st.slug = e.target.value; st.showAll = false; redraw(); });
  el.querySelector('#q').addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); st.showAll = false; redraw(); }, 160));

  redraw();
}
