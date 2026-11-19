/* Roteador, tema e inicialização da PWA. */

import { store } from './data.js';
import { destroyAllCharts } from './charts.js';
import { esc } from './util.js';

import * as Panorama from './views/panorama.js';
import * as Categorias from './views/categorias.js';
import * as Categoria from './views/categoria.js';
import * as Mudancas from './views/mudancas.js';
import * as Vacancia from './views/vacancia.js';
import * as Tecnicos from './views/tecnicos.js';
import * as Vencimentos from './views/vencimentos.js';
import * as Movimento from './views/movimento.js';
import * as Correlacoes from './views/correlacoes.js';
import * as Dados from './views/dados.js';
import * as Sobre from './views/sobre.js';

const view = document.getElementById('view');
const crumbs = document.getElementById('crumbs');
const nav = document.getElementById('nav');
const sidebar = document.getElementById('sidebar');
const scrim = document.getElementById('scrim');

/* ------------------------------------------------------------------ tema */
const THEME_KEY = 'usp-transparencia-theme';

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0d0f13' : '#8a1538');
  const icon = document.getElementById('themeIcon');
  if (icon) {
    icon.innerHTML =
      t === 'dark'
        ? '<path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66l1.42-1.42M4.92 19.08l1.42-1.42m0-11.32L4.92 4.92m14.16 14.16l-1.42-1.42M12 7a5 5 0 100 10 5 5 0 000-10z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
        : '<path d="M12 3a9 9 0 109 9 7 7 0 01-9-9z"/>';
  }
}

function initTheme() {
  const qs = new URLSearchParams(location.search).get('theme');
  if (qs === 'dark' || qs === 'light') {
    localStorage.setItem(THEME_KEY, qs);
    applyTheme(qs);
    return;
  }
  const saved = localStorage.getItem(THEME_KEY);
  const t = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(t);
}

document.getElementById('themeBtn')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

/* ------------------------------------------------------------------ menu mobile */
function closeMenu() {
  sidebar.classList.remove('open');
  scrim.hidden = true;
  document.getElementById('menuBtn')?.setAttribute('aria-expanded', 'false');
}

document.getElementById('menuBtn')?.addEventListener('click', () => {
  const open = !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', open);
  scrim.hidden = !open;
  document.getElementById('menuBtn')?.setAttribute('aria-expanded', String(open));
});
scrim?.addEventListener('click', closeMenu);
nav?.addEventListener('click', (e) => { if (e.target.closest('a')) closeMenu(); });

/* ------------------------------------------------------------------ recorte (escopo) */
function fillScopeSelect() {
  const sel = document.getElementById('scopeSel');
  if (!sel) return;
  const campi = store.scopes
    .filter((s) => s.type === 'campus')
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const units = store.scopes.filter((s) => s.type === 'unit');

  // agrupa as unidades pelo campus (São Carlos, São Paulo, ...)
  const byCampus = new Map();
  for (const u of units) {
    const c = u.campus || '';
    if (!byCampus.has(c)) byCampus.set(c, []);
    byCampus.get(c).push(u);
  }
  const label = (u) => u.name || u.unidade;
  const opts = (list) =>
    list
      .slice()
      .sort((a, b) => label(a).localeCompare(label(b), 'pt-BR'))
      .map((u) => `<option value="${esc(u.key)}">${esc(label(u))}</option>`)
      .join('');

  const groups = campi
    .map((c) => {
      const list = byCampus.get(c.name) || [];
      byCampus.delete(c.name);
      return `<optgroup label="${esc(c.name)}">
        <option value="${esc(c.key)}">${esc(c.name)} · Campus</option>
        ${opts(list)}
      </optgroup>`;
    })
    .join('');

  const rest = [...byCampus.entries()]
    .map(([c, list]) => `<optgroup label="${esc(c || 'Outros')}">${opts(list)}</optgroup>`)
    .join('');

  sel.innerHTML = `<option value="usp">USP</option>${groups}${rest}`;
  sel.value = store.scopeKey;
  sel.addEventListener('change', async () => {
    sel.disabled = true;
    try {
      await store.setScope(sel.value);
      updatePeriodBadge();
      await route();
    } catch (e) {
      console.error(e);
      sel.value = store.scopeKey;
    } finally {
      sel.disabled = false;
    }
  });
}

function updatePeriodBadge() {
  const refs = store.refs;
  const el = document.getElementById('periodBadge');
  if (el && refs.length) el.textContent = refs[refs.length - 1].label;
  const upd = document.getElementById('updLabel');
  if (upd && !store.isGlobal && store.scopeInfo) {
    upd.textContent = `${store.scopeInfo.name} · até ${refs[refs.length - 1].label}`;
  }
}

/* ------------------------------------------------------------------ população (ativos / aposentados / todos) */
function fillPopulationSelect() {
  const sel = document.getElementById('popSel');
  if (!sel) return;
  sel.value = store.population;
  sel.addEventListener('change', async () => {
    store.setPopulation(sel.value);
    const url = new URL(location.href);
    if (sel.value === 'ativo') url.searchParams.delete('pop');
    else url.searchParams.set('pop', sel.value);
    history.replaceState(null, '', url);
    await route();
  });
}

/* ------------------------------------------------------------------ rotas */
const ROUTES = [
  { key: 'panorama', re: /^\/?$|^\/panorama$/, label: 'Panorama', mod: Panorama },
  { key: 'categorias', re: /^\/categorias$/, label: 'Categorias', mod: Categorias },
  { key: 'categoria', re: /^\/categoria\/([a-z0-9-]+)$/, label: 'Categoria', mod: Categoria },
  { key: 'mudancas', re: /^\/mudancas$/, label: 'Mudanças', mod: Mudancas },
  { key: 'vacancia', re: /^\/vacancia$/, label: 'Vacância docente', mod: Vacancia },
  { key: 'tecnicos', re: /^\/tecnicos$/, label: 'Servidores', mod: Tecnicos },
  { key: 'vencimentos', re: /^\/vencimentos$/, label: 'Vencimentos', mod: Vencimentos },
  { key: 'movimento', re: /^\/movimento$/, label: 'Movimento', mod: Movimento },
  { key: 'correlacoes', re: /^\/correlacoes$/, label: 'Correlações', mod: Correlacoes },
  { key: 'dados', re: /^\/dados$/, label: 'Dados', mod: Dados },
  { key: 'sobre', re: /^\/sobre$/, label: 'Sobre', mod: Sobre },
];

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/panorama';
  for (const r of ROUTES) {
    const m = raw.match(r.re);
    if (m) return { ...r, params: m.slice(1) };
  }
  return null;
}

function setActiveNav(key) {
  nav?.querySelectorAll('a[data-route]').forEach((a) => {
    const on = a.dataset.route === key || (key === 'categoria' && a.dataset.route === 'categorias');
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function setCrumbs(parts) {
  crumbs.innerHTML = parts
    .map((p, i) =>
      p.href && i < parts.length - 1
        ? `<a href="${esc(p.href)}" style="color:inherit;text-decoration:none">${esc(p.label)}</a>`
        : `<b>${esc(p.label)}</b>`
    )
    .join('<span class="sep">/</span>');
}

function showError(err) {
  view.innerHTML = `<div class="card" style="margin-top:8vh;max-width:640px;margin-inline:auto;text-align:center">
    <h2 style="margin-bottom:8px">Não foi possível carregar</h2>
    <p style="color:var(--muted);font-size:.88rem">${esc(err?.message || String(err))}</p>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:center">
      <button class="btn primary" onclick="location.reload()">Tentar novamente</button>
      <a class="btn" href="#/panorama">Ir ao início</a>
    </div>
  </div>`;
}

let renderToken = 0;

async function route() {
  const r = parseHash();
  if (!r) { location.hash = '#/panorama'; return; }
  const token = ++renderToken;

  destroyAllCharts();
  setActiveNav(r.key);
  view.setAttribute('aria-busy', 'true');

  try {
    if (!store.index) await store.init();
  } catch (e) {
    showError(e);
    return;
  }

  if (r.key === 'categoria') {
    const slug = r.params[0];
    const meta = store.meta(slug);
    if (!meta) {
      setCrumbs([{ label: 'Categorias', href: '#/categorias' }, { label: 'Não encontrada' }]);
      showError(new Error(`Categoria "${slug}" não existe.`));
      return;
    }
    document.title = `${meta.title} · Transparência USP`;
    setCrumbs([{ label: 'Categorias', href: '#/categorias' }, { label: meta.title }]);
  } else {
    document.title = `${r.label} · Transparência USP`;
    setCrumbs([{ label: r.label }]);
  }

  try {
    await r.mod.render(view, ...r.params);
    if (token !== renderToken) return;
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  } catch (e) {
    console.error(e);
    if (token === renderToken) showError(e);
  } finally {
    view.removeAttribute('aria-busy');
  }
}

/* ------------------------------------------------------------------ boot */
function fmtDate(iso) {
  if (!iso) return '';
  const d = iso.slice(0, 10).split('-');
  return `${d[2]}/${d[1]}/${d[0]}`;
}

async function boot() {
  initTheme();
  window.addEventListener('hashchange', route);

  try {
    const index = await store.init();
    fillScopeSelect();
    fillPopulationSelect();
    updatePeriodBadge();
    document.getElementById('updLabel').textContent = store.isGlobal
      ? `Atualizado em ${fmtDate(index.generatedAt)}`
      : `${store.scopeInfo.name} · até ${store.refs[store.refs.length - 1].label}`;
    document.title = 'Panorama · Transparência USP';
  } catch (e) {
    showError(e);
    return;
  }

  route();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('sw.js', { updateViaCache: 'none' })
        .then((reg) => reg.update().catch(() => {}))
        .catch(() => {});
    });
  }
}

boot();
