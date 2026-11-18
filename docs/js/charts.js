/* Gráficos SVG leves, sem dependências. */

import { fmtCompact, fmtInt, esc } from './util.js';

const tip = () => document.getElementById('tooltip');

export function showTip(html, x, y) {
  const el = tip();
  if (!el) return;
  el.innerHTML = html;
  el.hidden = false;
  const r = el.getBoundingClientRect();
  const px = Math.max(r.width / 2 + 8, Math.min(window.innerWidth - r.width / 2 - 8, x));
  const py = y < r.height + 24 ? y + r.height + 30 : y;
  el.style.left = `${px}px`;
  el.style.top = `${py}px`;
  el.style.transform = y < r.height + 24 ? 'translate(-50%, 0)' : 'translate(-50%, calc(-100% - 12px))';
}

export function hideTip() {
  const el = tip();
  if (el) el.hidden = true;
}

const observers = new WeakMap();
const allObservers = new Set();

/** Redesenha o gráfico quando a largura do contêiner muda. */
export function responsive(container, draw) {
  const prev = observers.get(container);
  if (prev) { prev.disconnect(); allObservers.delete(prev); }
  let last = 0;
  const ro = new ResizeObserver((entries) => {
    const w = Math.round(entries[0].contentRect.width);
    if (!w || Math.abs(w - last) < 4) return;
    last = w;
    draw(w);
  });
  ro.observe(container);
  observers.set(container, ro);
  allObservers.add(ro);
  const w = Math.round(container.clientWidth) || 640;
  last = w;
  draw(w);
}

export function destroyAllCharts() {
  for (const ro of allObservers) ro.disconnect();
  allObservers.clear();
}

export function destroyChart(container) {
  const o = observers.get(container);
  if (o) { o.disconnect(); allObservers.delete(o); }
  observers.delete(container);
}

/** Escala "bonita" para o eixo Y. */
export function niceScale(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.1);
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { min: lo, max: hi, ticks };
}

const fmtAxis = (v) => (Math.abs(v) >= 1000 ? fmtCompact(v) : String(Math.round(v * 10) / 10).replace('.', ','));

function xTickIdx(n, width) {
  const maxLabels = Math.max(3, Math.floor(width / 78));
  if (n <= maxLabels) return Array.from({ length: n }, (_, i) => i);
  const step = Math.ceil((n - 1) / (maxLabels - 1));
  const out = [];
  for (let i = 0; i < n; i += step) out.push(i);
  if (out[out.length - 1] !== n - 1) {
    // evita rótulos colados na ponta direita
    if (out.length > 1 && n - 1 - out[out.length - 1] < step * 0.65) out[out.length - 1] = n - 1;
    else out.push(n - 1);
  }
  return out;
}

/**
 * Gráfico de linhas / área / área empilhada.
 * cfg: { labels, series:[{name,color,values,off}], height, fmt, stacked, area,
 *        yMin, yMax, showLegend, curve, highlightIdx }
 */
export function lineChart(container, cfg) {
  const {
    labels = [],
    series = [],
    height = 260,
    fmt = fmtInt,
    stacked = false,
    area = false,
    yMin,
    yMax,
    showLegend = false,
  } = cfg;

  responsive(container, (width) => {
    container.classList.add('chart');
    const m = { t: 14, r: 16, b: 26, l: 48 };
    const w = Math.max(280, width);
    const pw = Math.max(10, w - m.l - m.r);
    const ph = Math.max(60, height - m.t - m.b);
    const n = labels.length;
    const active = series.filter((s) => !s.off);
    const dense = n > 1;

    const X = (i) => (dense ? m.l + (i / (n - 1)) * pw : m.l + pw / 2);

    // valores empilhados
    const stacks = [];
    let gMax = -Infinity, gMin = Infinity;
    if (stacked) {
      for (let i = 0; i < n; i++) {
        let acc = 0;
        const row = [];
        for (const s of active) {
          acc += s.values[i] || 0;
          row.push(acc);
        }
        stacks.push(row);
        gMax = Math.max(gMax, acc);
        gMin = Math.min(gMin, 0);
      }
    } else {
      for (const s of active) {
        for (let i = 0; i < n; i++) {
          const v = s.values[i];
          if (!Number.isFinite(v)) continue;
          if (v > gMax) gMax = v;
          if (v < gMin) gMin = v;
        }
      }
    }
    if (!Number.isFinite(gMax)) { gMax = 1; gMin = 0; }
    const scale = niceScale(yMin ?? (stacked ? 0 : Math.min(0, gMin)), yMax ?? gMax, 4);
    const Y = (v) => m.t + ph - ((v - scale.min) / (scale.max - scale.min || 1)) * ph;

    const parts = [];
    parts.push(`<svg viewBox="0 0 ${w} ${height}" width="${w}" height="${height}" role="img" aria-label="Gráfico de série temporal">`);
    // grid
    for (const t of scale.ticks) {
      const y = Y(t);
      parts.push(`<line class="grid-line${t === 0 ? ' zero' : ''}" x1="${m.l}" y1="${y.toFixed(1)}" x2="${w - m.r}" y2="${y.toFixed(1)}"/>`);
      parts.push(`<text class="axis-label" x="${m.l - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${fmtAxis(t)}</text>`);
    }
    // eixo x
    const ticks = xTickIdx(n, w - m.l - m.r);
    for (const i of ticks) {
      parts.push(`<text class="axis-label" x="${X(i).toFixed(1)}" y="${height - 8}" text-anchor="middle">${esc(labels[i] ?? '')}</text>`);
    }

    // séries
    if (stacked) {
      active.forEach((s, si) => {
        let d = '';
        for (let i = 0; i < n; i++) d += `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(stacks[i][si]).toFixed(1)}`;
        for (let i = n - 1; i >= 0; i--) {
          const base = si === 0 ? 0 : stacks[i][si - 1];
          d += `L${X(i).toFixed(1)},${Y(base).toFixed(1)}`;
        }
        d += 'Z';
        parts.push(`<path d="${d}" fill="${s.color}" fill-opacity=".82" stroke="${s.color}" stroke-width="1"/>`);
      });
    } else {
      for (const s of active) {
        let d = '';
        let started = false;
        for (let i = 0; i < n; i++) {
          const v = s.values[i];
          if (!Number.isFinite(v)) { started = false; continue; }
          d += `${started ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
          started = true;
        }
        if (area && n > 0) {
          const first = s.values.findIndex((v) => Number.isFinite(v));
          let last = -1;
          for (let i = n - 1; i >= 0; i--) if (Number.isFinite(s.values[i])) { last = i; break; }
          if (first >= 0 && last >= 0) {
            const dArea = `${d}L${X(last).toFixed(1)},${Y(scale.min)}L${X(first).toFixed(1)},${Y(scale.min)}Z`;
            parts.push(`<path d="${dArea}" fill="${s.color}" fill-opacity=".10"/>`);
          }
        }
        parts.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round"/>`);
      }
    }

    // crosshair
    parts.push(`<line id="xh" x1="0" y1="${m.t}" x2="0" y2="${m.t + ph}" stroke="var(--line-strong)" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>`);
    parts.push(`<g id="xdots"></g>`);
    parts.push(`<rect id="ov" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent" style="cursor:crosshair"/>`);
    parts.push('</svg>');
    container.innerHTML = parts.join('');

    const svg = container.querySelector('svg');
    const ov = container.querySelector('#ov');
    const xh = container.querySelector('#xh');
    const dots = container.querySelector('#xdots');

    const valueAt = (i) => {
      if (stacked) return stacks[i][active.length - 1] ?? 0;
      return active.reduce((acc, s) => acc + (s.values[i] || 0), 0);
    };

    const move = (ev) => {
      if (!n) return;
      const rect = svg.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * w;
      let i = dense ? Math.round(((x - m.l) / pw) * (n - 1)) : 0;
      i = Math.max(0, Math.min(n - 1, i));
      const px = X(i);
      xh.setAttribute('x1', px);
      xh.setAttribute('x2', px);
      xh.setAttribute('opacity', '1');
      dots.innerHTML = active
        .map((s) => {
          const v = s.values[i];
          if (!Number.isFinite(v)) return '';
          const yy = stacked ? Y(stacks[i][active.indexOf(s)]) : Y(v);
          return `<circle cx="${px}" cy="${yy}" r="3.4" fill="${s.color}" stroke="var(--panel)" stroke-width="1.6"/>`;
        })
        .join('');
      const rows = active
        .map((s) => {
          const v = s.values[i];
          if (!Number.isFinite(v)) return '';
          return `<div class="tt-row"><span class="l"><span class="swatch" style="background:${s.color}"></span>${esc(s.name)}</span><span class="v">${fmt(v)}</span></div>`;
        })
        .join('');
      const totalRow =
        stacked && active.length > 1
          ? `<div class="tt-row" style="margin-top:4px;border-top:1px solid var(--line);padding-top:4px"><span class="l">Total</span><span class="v">${fmt(valueAt(i))}</span></div>`
          : '';
      showTip(`<div class="tt-title">${esc(labels[i] ?? '')}</div>${rows}${totalRow}`, ev.clientX, ev.clientY);
    };

    ov.addEventListener('mousemove', move);
    ov.addEventListener('mouseleave', () => {
      hideTip();
      xh.setAttribute('opacity', '0');
      dots.innerHTML = '';
    });

    if (showLegend && container.parentElement) {
      // legenda é gerida pela view; nada a fazer aqui
    }
  });
}

/** Barras horizontais em HTML (rótulo + trilha + valor). */
export function hBars(container, cfg) {
  const { items = [], fmt = fmtInt, color = 'var(--brand)', max } = cfg;
  if (!items.length) {
    container.innerHTML = '<div class="empty">Sem dados.</div>';
    return;
  }
  const top = max ?? Math.max(...items.map((i) => i.value), 1);
  container.innerHTML = `<div class="hbars">${items
    .map(
      (it) => `<div class="hbar">
        <span class="hbar-label" title="${esc(it.label)}">${esc(it.label)}</span>
        <div class="hbar-track"><div class="hbar-fill" style="width:${((it.value / top) * 100).toFixed(1)}%;background:${it.color || color}"></div></div>
        <span class="hbar-val">${fmt(it.value)}</span>
      </div>`
    )
    .join('')}</div>`;
}

/** Rosca de composição. */
export function donut(container, cfg) {
  const { items = [], fmt = fmtInt, size = 168, thickness = 22, centerLabel = '' } = cfg;
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  const r = size / 2;
  const ir = r - thickness;
  let acc = -Math.PI / 2;
  const parts = [];
  for (const it of items) {
    const frac = it.value / total;
    const a0 = acc;
    const a1 = acc + frac * Math.PI * 2;
    acc = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = r + r * Math.cos(a0), y0 = r + r * Math.sin(a0);
    const x1 = r + r * Math.cos(a1), y1 = r + r * Math.sin(a1);
    const xi0 = r + ir * Math.cos(a1), yi0 = r + ir * Math.sin(a1);
    const xi1 = r + ir * Math.cos(a0), yi1 = r + ir * Math.sin(a0);
    parts.push(
      `<path d="M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} L${xi0.toFixed(2)},${yi0.toFixed(2)} A${ir},${ir} 0 ${large} 0 ${xi1.toFixed(2)},${yi1.toFixed(2)} Z" fill="${it.color}"><title>${esc(it.label)}: ${fmt(it.value)}</title></path>`
    );
  }
  container.innerHTML = `<div class="donut-wrap">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Composição">
      ${parts.join('')}
      <text x="${r}" y="${r - 2}" text-anchor="middle" style="font-size:20px;font-weight:680;fill:var(--ink)">${fmt(total)}</text>
      <text x="${r}" y="${r + 15}" text-anchor="middle" style="font-size:9.5px;fill:var(--muted);text-transform:uppercase;letter-spacing:.06em">${esc(centerLabel)}</text>
    </svg>
    <div class="donut-legend">${items
      .map(
        (it) => `<div class="dl-row"><span class="swatch" style="background:${it.color}"></span>
          <span class="dl-label">${esc(it.label)}</span>
          <span class="dl-val">${fmt(it.value)}</span>
          <span class="dl-pct">${((it.value / total) * 100).toFixed(1).replace('.', ',')}%</span></div>`
      )
      .join('')}</div>
  </div>`;
}

/** Dispersão com reta de regressão. */
export function scatterChart(container, cfg) {
  const { points = [], xLabel = '', yLabel = '', color = 'var(--brand)', height = 300, fmtX = fmtInt, fmtY = fmtInt, line } = cfg;
  responsive(container, (width) => {
    const m = { t: 14, r: 18, b: 42, l: 56 };
    const w = Math.max(300, width);
    const ph = Math.max(120, height - m.t - m.b);
    const pw = Math.max(120, w - m.l - m.r);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const sx = niceScale(Math.min(...xs), Math.max(...xs), 4);
    const sy = niceScale(Math.min(...ys), Math.max(...ys), 4);
    const X = (v) => m.l + ((v - sx.min) / (sx.max - sx.min || 1)) * pw;
    const Y = (v) => m.t + ph - ((v - sy.min) / (sy.max - sy.min || 1)) * ph;

    const parts = [`<svg viewBox="0 0 ${w} ${height}" width="${w}" height="${height}" role="img" aria-label="Dispersão">`];
    for (const t of sy.ticks) {
      parts.push(`<line class="grid-line" x1="${m.l}" y1="${Y(t).toFixed(1)}" x2="${w - m.r}" y2="${Y(t).toFixed(1)}"/>`);
      parts.push(`<text class="axis-label" x="${m.l - 8}" y="${(Y(t) + 3.5).toFixed(1)}" text-anchor="end">${fmtAxis(t)}</text>`);
    }
    for (const t of sx.ticks) {
      parts.push(`<text class="axis-label" x="${X(t).toFixed(1)}" y="${height - 22}" text-anchor="middle">${fmtAxis(t)}</text>`);
    }
    parts.push(`<text class="axis-label" x="${m.l + pw / 2}" y="${height - 4}" text-anchor="middle">${esc(xLabel)}</text>`);
    parts.push(`<text class="axis-label" x="12" y="${m.t + ph / 2}" text-anchor="middle" transform="rotate(-90 12 ${m.t + ph / 2})">${esc(yLabel)}</text>`);

    if (line && Number.isFinite(line.slope)) {
      const y1 = line.intercept + line.slope * sx.min;
      const y2 = line.intercept + line.slope * sx.max;
      parts.push(`<line x1="${X(sx.min).toFixed(1)}" y1="${Y(y1).toFixed(1)}" x2="${X(sx.max).toFixed(1)}" y2="${Y(y2).toFixed(1)}" stroke="${color}" stroke-width="1.6" stroke-dasharray="5 4" opacity=".8"/>`);
    }
    for (const p of points) {
      parts.push(`<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="4" fill="${color}" fill-opacity=".55" stroke="${color}" stroke-width="1"><title>${esc(p.label || '')}: ${fmtX(p.x)} / ${fmtY(p.y)}</title></circle>`);
    }
    parts.push('</svg>');
    container.innerHTML = parts.join('');
  });
}

/** Barras verticais com suporte a valores negativos. */
export function barsChart(container, cfg) {
  const { labels = [], values = [], height = 220, fmt = fmtInt, colorPos = 'var(--pos)', colorNeg = 'var(--neg)' } = cfg;
  responsive(container, (width) => {
    const m = { t: 12, r: 12, b: 26, l: 52 };
    const w = Math.max(280, width);
    const ph = Math.max(60, height - m.t - m.b);
    const pw = Math.max(20, w - m.l - m.r);
    const n = values.length;
    if (!n) {
      container.innerHTML = '<div class="empty">Sem dados.</div>';
      return;
    }
    const scale = niceScale(Math.min(0, ...values), Math.max(0, ...values), 4);
    const Y = (v) => m.t + ph - ((v - scale.min) / (scale.max - scale.min || 1)) * ph;
    const zero = Y(0);
    const step = pw / n;
    const bw = Math.min(40, step * 0.62);

    const parts = [`<svg viewBox="0 0 ${w} ${height}" width="${w}" height="${height}" role="img">`];
    for (const t of scale.ticks) {
      parts.push(`<line class="grid-line" x1="${m.l}" y1="${Y(t).toFixed(1)}" x2="${w - m.r}" y2="${Y(t).toFixed(1)}"/>`);
      parts.push(`<text class="axis-label" x="${m.l - 8}" y="${(Y(t) + 3.5).toFixed(1)}" text-anchor="end">${fmtAxis(t)}</text>`);
    }
    const skip = Math.ceil(n / Math.max(3, Math.floor(pw / 64)));
    values.forEach((v, i) => {
      const x = m.l + step * i + (step - bw) / 2;
      const y = Math.min(Y(v), zero);
      const h = Math.max(1, Math.abs(Y(v) - zero));
      const color = v >= 0 ? colorPos : colorNeg;
      parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${color}" fill-opacity=".85" data-i="${i}"><title>${esc(labels[i])}: ${fmt(v)}</title></rect>`);
      if (i % skip === 0 || i === n - 1) {
        parts.push(`<text class="axis-label" x="${(x + bw / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle">${esc(labels[i])}</text>`);
      }
    });
    parts.push(`<line class="grid-line zero" x1="${m.l}" y1="${zero.toFixed(1)}" x2="${w - m.r}" y2="${zero.toFixed(1)}"/>`);
    parts.push('</svg>');
    container.innerHTML = parts.join('');

    container.querySelectorAll('rect[data-i]').forEach((rect) => {
      rect.addEventListener('mousemove', (ev) => {
        const i = Number(rect.dataset.i);
        showTip(`<div class="tt-title">${esc(labels[i])}</div><div class="tt-row"><span class="l">Saldo</span><span class="v">${fmt(values[i])}</span></div>`, ev.clientX, ev.clientY);
      });
      rect.addEventListener('mouseleave', hideTip);
    });
  });
}

/** Sparkline como string SVG (para células de tabela e KPIs). */
export function sparklineSVG(values, color = 'var(--brand)', w = 80, h = 24, fill = true) {
  const vals = values.filter((v) => Number.isFinite(v));
  if (vals.length < 2) return '';
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const X = (i) => (i / (values.length - 1)) * (w - 2) + 1;
  const Y = (v) => h - 2 - ((v - min) / span) * (h - 4);
  let d = '', started = false;
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    d += `${started ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
    started = true;
  });
  const area = fill
    ? `<path d="${d}L${w - 1},${h}L1,${h}Z" fill="${color}" fill-opacity=".12" stroke="none"/>`
    : '';
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${area}<path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
