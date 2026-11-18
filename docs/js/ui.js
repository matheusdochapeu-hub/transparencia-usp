/* Componentes de UI reutilizáveis (HTML puro). */

import { esc, fmtInt, fmtPct, fmtSigned } from './util.js';

export function pageHead({ eyebrow = '', title = '', lead = '', actions = '' }) {
  return `<div class="page-head">
    <div>
      ${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}
      <h1>${title}</h1>
      ${lead ? `<p class="lead">${lead}</p>` : ''}
    </div>
    ${actions ? `<div class="actions">${actions}</div>` : ''}
  </div>`;
}

export function card({ title = '', sub = '', actions = '', body = '', cls = '', id = '' }) {
  return `<section class="card ${cls}" ${id ? `id="${id}"` : ''}>
    ${title || actions ? `<div class="card-head"><div>${title ? `<h3>${title}</h3>` : ''}${sub ? `<p>${sub}</p>` : ''}</div><div class="spacer"></div>${actions}</div>` : ''}
    ${body}
  </section>`;
}

export function seg(name, options, current) {
  return `<div class="seg" data-seg="${esc(name)}" role="group">${options
    .map((o) => `<button type="button" data-v="${esc(o.v)}" aria-pressed="${String(o.v) === String(current)}">${esc(o.label)}</button>`)
    .join('')}</div>`;
}

export function deltaSpan(delta, pct, { signed = true, suffix = '' } = {}) {
  if (delta == null || !Number.isFinite(delta)) return '<span class="delta flat">–</span>';
  const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '·';
  const txt = signed ? fmtSigned(delta) : fmtInt(Math.abs(delta));
  const p = pct != null && Number.isFinite(pct) ? ` <small>(${pct > 0 ? '+' : ''}${fmtPct(pct).replace('%', '')}%)</small>` : '';
  return `<span class="delta ${dir}">${arrow} ${txt}${suffix}${p}</span>`;
}

const HEAT_MAX = 0.42;

export function bindSegs(root, cb) {
  root.querySelectorAll('[data-seg]').forEach((group) => {
    group.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-v]');
      if (!btn || !group.contains(btn)) return;
      group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      cb(group.dataset.seg, btn.dataset.v, group);
    });
  });
}

/** Fundo proporcional ao valor (mapa de calor). */
export function heatStyle(v, max, { invert = false } = {}) {
  if (!Number.isFinite(v) || !max) return '';
  const t = Math.max(0, Math.min(1, v / max));
  const a = (invert ? 1 - t : t) * HEAT_MAX + 0.02;
  return `background:rgba(var(--heat-rgb),${a.toFixed(3)})`;
}

/** Cor divergente para correlações (-1 vermelho, 0 neutro, +1 azul). */
export function corrColor(r) {
  if (!Number.isFinite(r)) return 'transparent';
  const t = Math.max(-1, Math.min(1, r));
  const a = Math.min(0.95, Math.abs(t) * 0.95 + 0.04);
  return t >= 0 ? `rgba(14,116,144,${a.toFixed(3)})` : `rgba(185,28,28,${a.toFixed(3)})`;
}

export function legend(items, { interactive = true } = {}) {
  return `<div class="legend">${items
    .map(
      (it) =>
        `<span class="item${it.off ? ' off' : ''}" ${interactive ? `data-legend="${esc(it.key ?? it.name)}" role="button" tabindex="0"` : ''}>
          <span class="swatch" style="background:${it.color}"></span>${esc(it.name)}${it.value != null ? ` <b style="font-variant-numeric:tabular-nums">${fmtInt(it.value)}</b>` : ''}
        </span>`
    )
    .join('')}</div>`;
}

export function notice(text, icon = 'info') {
  const icons = {
    info: '<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>',
    warn: '<path d="M12 2L1 21h22L12 2zm1 14h-2v-2h2v2zm0-4h-2V8h2v4z"/>',
  };
  return `<div class="notice"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[icon] || icons.info}</svg><div>${text}</div></div>`;
}

export function emptyState(text) {
  return `<div class="empty">${esc(text)}</div>`;
}

/** Célula numérica com formatação e calor. */
export function numCell(v, { max = 0, pct = false, bold = false } = {}) {
  if (!Number.isFinite(v)) return '<td class="dim">–</td>';
  const styles = [];
  if (v > 0) styles.push(heatStyle(v, max));
  if (bold) styles.push('font-weight:650');
  return `<td class="num"${styles.length ? ` style="${styles.join(';')}"` : ''}>${pct ? fmtPct(v) : fmtInt(v)}</td>`;
}
