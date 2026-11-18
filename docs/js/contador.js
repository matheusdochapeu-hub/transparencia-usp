/* Contador de acessos (Abacus) — painel visível apenas para o desenvolvedor.
 * Ative com ?dev=67086719 ou digitando a sequência "dev".
 * Aviso: a "senha" fica no JS público; serve só para esconder o painel. */
(function () {
  'use strict';
  const CFG = {
    base: 'https://abacus.jasoncameron.dev',
    namespace: 'transparencia-usp-mrr',
    key: 'acessos',
    paramDev: 'dev',
    senha: '67086719',
    sequencia: 'dev',
    umaPorDia: true,
  };

  const url = (acao) => `${CFG.base}/${acao}/${encodeURIComponent(CFG.namespace)}/${encodeURIComponent(CFG.key)}`;

  function deveContar() {
    try {
      const host = location.hostname;
      if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    } catch (_) {}
    if (!CFG.umaPorDia) return true;
    try {
      const hoje = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem('tu_ultimo_hit') === hoje) return false;
      localStorage.setItem('tu_ultimo_hit', hoje);
      return true;
    } catch (_) {
      return true;
    }
  }

  function pedir(acao) {
    return fetch(url(acao), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d && typeof d.value === 'number' ? d.value : null))
      .catch(() => null);
  }

  let total = null;

  function modoDev() {
    try {
      const p = new URLSearchParams(location.search);
      return p.get(CFG.paramDev) === CFG.senha || p.has(CFG.paramDev);
    } catch (_) {
      return false;
    }
  }

  function painel(n) {
    let el = document.getElementById('dev-contador');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dev-contador';
      document.body.appendChild(el);
    }
    el.innerHTML =
      `<span class="dev-contador-rotulo">👁️ acessos (dev)</span>` +
      `<strong class="dev-contador-num">${n == null ? '—' : n.toLocaleString('pt-BR')}</strong>` +
      `<button type="button" class="dev-contador-fechar" aria-label="Fechar">✕</button>`;
    el.style.display = 'flex';
    el.querySelector('.dev-contador-fechar').addEventListener('click', () => { el.style.display = 'none'; });
  }

  function abrir() {
    if (total !== null) painel(total);
    else pedir('get').then((t) => { total = t; painel(t); });
  }

  function atalho() {
    let buf = '';
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
      if (e.key && e.key.length === 1) {
        buf = (buf + e.key.toLowerCase()).slice(-CFG.sequencia.length);
        if (buf === CFG.sequencia) { buf = ''; abrir(); }
      }
    });
  }

  function iniciar() {
    pedir(deveContar() ? 'hit' : 'get').then((t) => {
      total = t;
      if (modoDev()) abrir();
    });
    atalho();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
