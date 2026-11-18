/* Vagas técnico-administrativas — estimativa a partir do D.O.E. × Transparência × Anuário.
 *
 * A aba responde duas perguntas:
 *  1) gestor: qual a defasagem da minha unidade/campus e quanto preciso contratar;
 *  2) servidor: onde há (ou pode haver) vaga, por classe e função, para pedir
 *     remoção/permuta entre unidades e campi.
 *
 * Tudo é ESTIMATIVA: o número oficial de vagas por emprego só existe no quadro
 * de lotação do DRH. O texto da tela deixa isso explícito em todos os blocos.
 */

import { pageHead, card, seg, bindSegs, notice } from '../ui.js';
import { esc, fmtInt, fmtPct, downloadFile, toCSV } from '../util.js';

const BASE = 'data/vagas-tecnicos.json';
const CLASSES = [
  { key: 'bas', nome: 'Básico' },
  { key: 'tec', nome: 'Técnico' },
  { key: 'sup', nome: 'Superior' },
];
const CAMPUS_ORDEM = [
  'São Paulo', 'São Carlos', 'Ribeirão Preto', 'Bauru', 'Piracicaba',
  'Pirassununga', 'Lorena', 'Órgãos centrais (RUSP)', 'Não identificado',
];

let CACHE = null;

async function load() {
  if (CACHE) return CACHE;
  const res = await fetch(BASE, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Falha ao carregar ${BASE} (${res.status})`);
  CACHE = await res.json();
  return CACHE;
}

const pct = (a, b) => (b ? (a / b) * 100 : null);
const n = (v) => (v == null ? '–' : fmtInt(v));

function bar(v, max, color) {
  const w = max ? Math.max(2, Math.round((v / max) * 100)) : 0;
  return `<span class="vt-bar" style="--w:${w}%;--c:${color}"></span>`;
}

function badgeEstimativa() {
  return '<span class="badge" style="background:rgba(180,120,0,.14);color:#8a5a00;border:1px solid rgba(180,120,0,.35)">estimativa</span>';
}

export async function render(el) {
  const d = await load();
  const st = {
    campus: 'todos',
    classe: 'total',
    q: '',
    aberto: null,
    origem: 'São Carlos',
    destino: 'Ribeirão Preto',
    ordem: 'vagasPot',
  };

  const unidades = d.unidades || [];
  const campi = d.campi || [];
  const r = d.resumo || {};
  const cobertura = d.cobertura || {};

  el.innerHTML = `
    ${pageHead({
      eyebrow: 'D.O.E. × Transparência × Anuário · estimativas',
      title: 'Vagas técnico-administrativas',
      lead:
        'Onde a USP <b>alocou</b> empregos públicos (D.O.E.), quanto isso representa diante do ' +
        '<b>efetivo ativo</b> e das <b>aposentadorias</b>, por campus, unidade, classe e função. ' +
        'Serve para o gestor medir a defasagem e para quem busca remoção/permuta enxergar onde há espaço.',
      actions: `<button class="btn" id="vtcsv">Baixar CSV</button>`,
    })}

    <div class="section">${notice(
      '<b>Isto é uma estimativa — não é o quadro oficial de vagas.</b> ' +
        'O D.O.E. informa quantos empregos públicos foram <b>alocados</b> a cada unidade; ' +
        'o Portal da Transparência informa quantos servidores estão <b>ativos</b>. ' +
        'Cruzando os dois, calculamos <b>vagas mínimas</b> (empregos acima do efetivo) e ' +
        '<b>vagas potenciais</b> (mínimas + aposentadorias recentes). O número exato de vagas por ' +
        'emprego depende do quadro de lotação/ocupação do DRH — pedido em aberto. ' +
        'Use como <b>sinal para investigar</b>, nunca como promessa de vaga.',
      'warn'
    )}</div>

    <div class="kpis section">
      <div class="kpi" style="--kc:var(--c1)"><span class="k-label">Empregos alocados (D.O.E.)</span>
        <span class="k-value">${n(r.empregosAlocados)}</span>
        <div class="k-foot"><span>${cobertura.percentual != null ? fmtPct(cobertura.percentual) : '–'} dos ${n(cobertura.empregosCriadosLc1074)} da LC 1.074/2008</span></div></div>
      <div class="kpi" style="--kc:var(--c3)"><span class="k-label">Efetivo TA ativo</span>
        <span class="k-value">${n(r.efetivoTecnicoAdministrativo)}</span>
        <div class="k-foot"><span>técnico-administrativos na competência mais recente</span></div></div>
      <div class="kpi" style="--kc:var(--c2)"><span class="k-label">Vagas mínimas</span>
        <span class="k-value">${n(r.vagasMin)}</span>
        <div class="k-foot"><span>empregos acima do efetivo (limite inferior)</span></div></div>
      <div class="kpi" style="--kc:var(--c4)"><span class="k-label">Vagas potenciais</span>
        <span class="k-value">${n(r.vagasPot)}</span>
        <div class="k-foot"><span>mínimas + ${n(r.apos12m)} aposentadoria(s) em 12 meses</span></div></div>
    </div>

    <div class="section split">
      <div class="card">
        <div class="card-head"><div><h3>Por campus ${badgeEstimativa()}</h3>
          <p>Empregos alocados, efetivo e vagas estimadas por cidade.</p></div></div>
        <div class="table-wrap" id="vtCampus"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Como ler</h3><p>Os quatro números que importam.</p></div></div>
        <ul class="vt-list">
          ${(d.comoLer || []).map((t) => `<li>${t}</li>`).join('')}
        </ul>
        <p class="hint">Cobertura do acervo: ${cobertura.percentual != null ? fmtPct(cobertura.percentual) : '–'} dos 8.893 empregos da LC 1.074/2008. ${esc(cobertura.lacunas || '')}</p>
      </div>
    </div>

    <div class="section card">
      <div class="card-head">
        <div><h3>Unidades ${badgeEstimativa()}</h3>
          <p>Clique numa unidade para ver classe, funções e histórico. A classe muda o cálculo: o mesmo total pode esconder folga em Técnico e falta em Superior.</p></div>
        <div class="spacer"></div>
        <select id="vtCampusSel" aria-label="Filtrar campus" style="min-width:170px"></select>
        <input type="search" id="vtq" placeholder="Filtrar unidade…" style="width:180px" aria-label="Filtrar unidade">
        ${seg('classe', [{ v: 'total', label: 'Total' }, ...CLASSES.map((c) => ({ v: c.key, label: c.nome }))], 'total')}
      </div>
      <div class="table-wrap" id="vtTable" style="max-height:66vh"></div>
      <p class="hint" id="vtLegenda" style="margin-top:8px"></p>
    </div>

    <div class="section card">
      <div class="card-head">
        <div><h3>Simulador de mudança / permuta ${badgeEstimativa()}</h3>
          <p>Escolha de onde você sai e para onde quer ir. A lista mostra as unidades de destino com folga estimada e as classes correspondentes; a permuta, na prática, exige a mesma classe e função compatível.</p></div>
        <div class="spacer"></div>
        <select id="vtOrigem" aria-label="Campus de origem" style="min-width:160px"></select>
        <select id="vtDestino" aria-label="Campus de destino" style="min-width:160px"></select>
      </div>
      <div id="vtSim"></div>
    </div>

    <div class="section card">
      <div class="card-head"><div><h3>Para gestores: quanto e quando contratar</h3>
        <p>Selecione a unidade para ver a defasagem por classe, a pressão de aposentadoria e o fluxo recente com o banco de vagas.</p></div>
        <div class="spacer"></div>
        <select id="vtUnidade" aria-label="Unidade para detalhe" style="min-width:240px"></select>
      </div>
      <div id="vtGestor"></div>
    </div>

    <div class="section">${notice(
      '<b>Limites que você deve considerar.</b> ' +
        'O efetivo do Anuário/Transparência reúne <b>todos os regimes</b> (cargos antigos e empregos públicos); ' +
        'por isso a defasagem aparece só quando os empregos alocados superam o efetivo total — é um piso, não o total de vagas. ' +
        'A aposentadoria abre reposição, mas não garante novo provimento. ' +
        'A classe/função vem do D.O.E. quando a portaria detalha a tabela; em parte dos anos o D.O.E. publica só o total. ' +
        'E o D.O.E. cobre 2009–2026 com lacunas conhecidas (página de 2013 ausente no DRH, PDFs fora do ar, anexos em imagem).',
      'info'
    )}</div>
  `;

  // ---------------------------------------------------------------- helpers
  const campusList = () => {
    const nomes = [...new Set(unidades.map((u) => u.campus).filter(Boolean))];
    return nomes.sort((a, b) => {
      const ia = CAMPUS_ORDEM.indexOf(a);
      const ib = CAMPUS_ORDEM.indexOf(b);
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.localeCompare(b, 'pt-BR');
    });
  };

  const valorClasse = (u, campo) =>
    st.classe === 'total' ? u[campo] : (u.classes && u.classes[st.classe] ? u.classes[st.classe][campo] : 0);

  const filtradas = () =>
    unidades
      .filter((u) => st.campus === 'todos' || u.campus === st.campus)
      .filter((u) => !st.q || `${u.sigla} ${u.nome} ${u.cidade}`.toLowerCase().includes(st.q))
      .sort((a, b) => {
        const va = valorClasse(a, st.ordem) ?? -1;
        const vb = valorClasse(b, st.ordem) ?? -1;
        if (vb !== va) return vb - va;
        return a.nome.localeCompare(b.nome, 'pt-BR');
      });

  // ------------------------------------------------------------- campus
  function drawCampus() {
    const rows = campi.slice().sort((a, b) => (b.vagasPot || 0) - (a.vagasPot || 0));
    const max = Math.max(...rows.map((c) => c.empregos || 0), 1);
    el.querySelector('#vtCampus').innerHTML = `<table class="data">
      <thead><tr>
        <th>Campus / cidade</th><th class="num">Empregos</th><th class="num">Efetivo</th>
        <th class="num">Vagas mín.</th><th class="num">Vagas pot.</th>
        <th class="num">Aposentados</th><th class="num">Banco (rec./dev.)</th>
      </tr></thead>
      <tbody>${rows.map((c) => `<tr data-campus="${esc(c.campus)}" style="cursor:pointer">
        <td><b>${esc(c.cidade || c.campus)}</b> ${c.campus !== c.cidade ? `<span class="hint">${esc(c.campus)}</span>` : ''}</td>
        <td class="num">${n(c.empregos)} ${bar(c.empregos, max, 'var(--c1)')}</td>
        <td class="num">${n(c.efetivo)}</td>
        <td class="num" style="font-weight:${c.vagasMin ? 650 : 400}">${n(c.vagasMin)}</td>
        <td class="num">${n(c.vagasPot)}</td>
        <td class="num dim">${n(c.aposentados)}</td>
        <td class="num dim">${n(c.recebidosBanco)} / ${n(c.devolvidosBanco)}</td>
      </tr>`).join('')}</tbody>
    </table>`;
    el.querySelectorAll('#vtCampus tr[data-campus]').forEach((tr) =>
      tr.addEventListener('click', () => {
        st.campus = tr.dataset.campus;
        el.querySelector('#vtCampusSel').value = st.campus;
        drawUnidades();
      })
    );
  }

  // ------------------------------------------------------------ unidades
  function drawUnidades() {
    const rows = filtradas();
    const maxE = Math.max(...rows.map((u) => valorClasse(u, 'empregos') || 0), 1);
    const classeTxt = st.classe === 'total' ? 'todas as classes' : `classe ${CLASSES.find((c) => c.key === st.classe).nome}`;
    el.querySelector('#vtLegenda').textContent =
      `Mostrando ${rows.length} unidade(s) · ${classeTxt} · ordenado por ${st.ordem === 'vagasPot' ? 'vagas potenciais' : st.ordem === 'vagasMin' ? 'vagas mínimas' : st.ordem === 'empregos' ? 'empregos' : 'efetivo'}.`;

    el.querySelector('#vtTable').innerHTML = `<table class="data">
      <thead><tr>
        <th>Unidade</th><th>Campus</th>
        <th class="num sortable" data-ordem="empregos">Empregos</th>
        <th class="num sortable" data-ordem="efetivo">Efetivo</th>
        <th class="num sortable" data-ordem="vagasMin">Vagas mín.</th>
        ${st.classe === 'total' ? '<th class="num sortable" data-ordem="vagasPot">Vagas pot.</th><th>Folga por classe</th>' : ''}
        <th class="num">Aposent.</th>
        <th class="num">Banco</th>
      </tr></thead>
      <tbody>${rows.map((u) => {
        const emp = valorClasse(u, 'empregos');
        const ef = valorClasse(u, 'efetivo');
        const vmin = valorClasse(u, 'vagasMin');
        const vpot = valorClasse(u, 'vagasPot');
        const semEf = u.semEfetivo ? ' <span class="badge">sem série de efetivo</span>' : '';
        const folgas = CLASSES.filter((c) => (u.classes?.[c.key]?.vagasMin || 0) > 0);
        return `<tr data-sigla="${esc(u.sigla)}" style="cursor:pointer">
          <td><b>${esc(u.sigla)}</b> <span class="hint">${esc(u.nome)}</span>${semEf}</td>
          <td class="dim">${esc(u.cidade || u.campus || '—')}</td>
          <td class="num">${n(emp)} ${bar(emp, maxE, 'var(--c1)')}</td>
          <td class="num">${n(ef)}</td>
          <td class="num" style="font-weight:${vmin ? 650 : 400}">${n(vmin)}</td>
          ${st.classe === 'total' ? `<td class="num">${n(vpot)}</td>
          <td>${folgas.length ? folgas.map((c) => `<span class="badge" style="background:rgba(20,120,80,.12);color:#11684a">${c.nome} +${fmtInt(u.classes[c.key].vagasMin)}</span>`).join(' ') : '<span class="hint">—</span>'}</td>` : ''}
          <td class="num dim">${n(u.aposentados)}</td>
          <td class="num dim">${n(u.recebidosBanco)}/${n(u.devolvidosBanco)}</td>
        </tr>
        <tr class="vt-det" data-det="${esc(u.sigla)}" hidden><td colspan="${st.classe === 'total' ? 9 : 7}">${detalhe(u)}</td></tr>`;
      }).join('')}</tbody>
    </table>`;

    el.querySelectorAll('#vtTable th[data-ordem]').forEach((th) =>
      th.addEventListener('click', () => {
        st.ordem = th.dataset.ordem;
        drawUnidades();
      })
    );
    el.querySelectorAll('#vtTable tr[data-sigla]').forEach((tr) =>
      tr.addEventListener('click', () => {
        const sigla = tr.dataset.sigla;
        const det = el.querySelector(`#vtTable tr[data-det="${CSS.escape(sigla)}"]`);
        st.aberto = st.aberto === sigla ? null : sigla;
        el.querySelectorAll('#vtTable tr.vt-det').forEach((d) => { d.hidden = true; });
        if (st.aberto && det) det.hidden = false;
        if (st.aberto) {
          el.querySelector('#vtUnidade').value = st.aberto;
          drawGestor();
        }
      })
    );
  }

  function detalhe(u) {
    const cls = CLASSES.map((c) => {
      const k = u.classes?.[c.key] || { empregos: 0, efetivo: 0, vagasMin: 0 };
      return `<tr><td>${c.nome}</td><td class="num">${fmtInt(k.empregos)}</td>
        <td class="num">${fmtInt(k.efetivo)}</td>
        <td class="num" style="font-weight:${k.vagasMin ? 650 : 400}">${k.vagasMin ? fmtInt(k.vagasMin) : '–'}</td>
        <td>${k.vagasMin ? '<span class="badge" style="background:rgba(20,120,80,.12);color:#11684a">folga mínima</span>' : '<span class="hint">sem folga aparente</span>'}</td></tr>`;
    }).join('');
    const funcoes = (u.funcoesAtivas || []).slice(0, 8);
    const funcoesDoe = (u.funcoesDoe || []).slice(0, 8);
    const hist = u.historico || {};
    const anos = Object.keys(hist).sort();
    const maxH = Math.max(...anos.map((a) => hist[a] || 0), 1);
    return `<div class="vt-detail">
      <div class="grid cols-2">
        <div>
          <h4>Por classe</h4>
          <table class="data mini"><thead><tr><th>Classe</th><th class="num">Empregos</th><th class="num">Efetivo</th><th class="num">Vagas mín.</th><th></th></tr></thead>
          <tbody>${cls}</tbody></table>
          <p class="hint">A soma das classes pode não fechar com o total: há empregos sem classe identificada no D.O.E.</p>
        </div>
        <div>
          <h4>Funções com servidores ativos</h4>
          ${funcoes.length ? `<ul class="vt-chips">${funcoes.map((f) => `<li>${esc(f.nome)} <b>${fmtInt(f.ativos)}</b></li>`).join('')}</ul>` : '<p class="hint">Sem recorte de função para esta unidade.</p>'}
          ${funcoesDoe.length ? `<h4 style="margin-top:12px">Empregos por função no D.O.E. <span class="hint">(2009, parcial)</span></h4>
            <ul class="vt-chips">${funcoesDoe.map((f) => `<li>${esc(f.nome)} <b>${fmtInt(f.empregos)}</b></li>`).join('')}</ul>` : ''}
        </div>
      </div>
      <h4 style="margin-top:14px">Empregos alocados por ano</h4>
      <div class="vt-hist">${anos.map((a) => `<span title="${a}: ${hist[a]}" style="height:${Math.max(3, Math.round((hist[a] / maxH) * 40))}px"></span>`).join('')}</div>
      <div class="hint vt-hist-x">${anos[0] || ''} → ${anos[anos.length - 1] || ''}</div>
      <p class="hint">Aposentadorias de TA: ${fmtInt(u.aposentados)} no total, ${u.apos12m == null ? '—' : fmtInt(u.apos12m)} em 12 meses.
        Fluxo com a Reitoria: ${fmtInt(u.recebidosBanco)} recebido(s), ${fmtInt(u.devolvidosBanco)} devolvido(s) em 3 anos.
        ${u.movUltimo ? `Último movimento: ${esc(u.movUltimo)}.` : ''}</p>
    </div>`;
  }

  // ------------------------------------------------------------- simulador
  function drawSim() {
    const campiNomes = campusList();
    const opcoes = (sel) =>
      campiNomes.map((c) => `<option value="${esc(c)}" ${sel === c ? 'selected' : ''}>${esc(c)}</option>`).join('');

    el.querySelector('#vtOrigem').innerHTML = `<option value="">— origem —</option>${opcoes(st.origem)}`;
    el.querySelector('#vtDestino').innerHTML = `<option value="">— destino —</option>${opcoes(st.destino)}`;
    el.querySelector('#vtOrigem').value = st.origem;
    el.querySelector('#vtDestino').value = st.destino;

    const comFolga = (u) =>
      CLASSES.map((c) => ({ c, k: u.classes?.[c.key] || {} }))
        .filter(({ k }) => (k.vagasMin || 0) > 0)
        .sort((a, b) => (b.k.vagasMin || 0) - (a.k.vagasMin || 0));

    const destino = unidades
      .filter((u) => u.campus === st.destino && !u.semEfetivo)
      .map((u) => ({ u, porClasse: comFolga(u) }))
      .filter((x) => x.porClasse.length)
      .sort((a, b) => (b.porClasse[0].k.vagasMin || 0) - (a.porClasse[0].k.vagasMin || 0));

    const origem = unidades
      .filter((u) => u.campus === st.origem)
      .map((u) => ({ u, porClasse: comFolga(u) }))
      .filter((x) => x.porClasse.length);

    // sem folga aparente: mostra os sinais alternativos (aposentadoria e devolução ao banco)
    const sinaisDestino = unidades
      .filter((u) => u.campus === st.destino)
      .slice()
      .sort((a, b) => (b.aposentados + 3 * b.devolvidosBanco) - (a.aposentados + 3 * a.devolvidosBanco))
      .slice(0, 8);
    const sinaisOrigem = unidades
      .filter((u) => u.campus === st.origem)
      .slice()
      .sort((a, b) => (b.devolvidosBanco + b.aposentados) - (a.devolvidosBanco + a.aposentados))
      .slice(0, 8);

    const tabelaFolga = (lista, vazio) => lista.length
      ? `<table class="data mini"><thead><tr><th>Unidade</th><th>Classe com folga</th><th class="num">Vagas mín.</th><th class="num">Aposent. 12m</th></tr></thead>
        <tbody>${lista.map(({ u, porClasse }) => `<tr>
          <td><b>${esc(u.sigla)}</b> <span class="hint">${esc(u.nome)}</span></td>
          <td>${porClasse.map(({ c, k }) => `${c.nome} <b>${fmtInt(k.vagasMin)}</b>`).join(' · ')}</td>
          <td class="num">${fmtInt(porClasse.reduce((s, { k }) => s + (k.vagasMin || 0), 0))}</td>
          <td class="num dim">${u.apos12m == null ? '—' : fmtInt(u.apos12m)}</td>
        </tr>`).join('')}</tbody></table>`
      : `<p class="hint">${vazio}</p>`;

    const tabelaSinais = (lista, tipo) => `<table class="data mini">
      <thead><tr><th>Unidade</th><th class="num">Empregos</th><th class="num">Efetivo</th>
        <th class="num">${tipo === 'destino' ? 'Aposentados' : 'Devolvidos ao banco'}</th>
        <th class="num">${tipo === 'destino' ? 'Devolvidos ao banco' : 'Aposentados'}</th></tr></thead>
      <tbody>${lista.map((u) => `<tr>
        <td><b>${esc(u.sigla)}</b> <span class="hint">${esc(u.nome)}</span></td>
        <td class="num">${fmtInt(u.empregos)}</td>
        <td class="num">${fmtInt(u.efetivo)}</td>
        <td class="num">${fmtInt(tipo === 'destino' ? u.aposentados : u.devolvidosBanco)}</td>
        <td class="num dim">${fmtInt(tipo === 'destino' ? u.devolvidosBanco : u.aposentados)}</td>
      </tr>`).join('')}</tbody></table>
      <p class="hint">${tipo === 'destino'
        ? 'Sem empregos acima do efetivo nesta cidade. Estes são os sinais alternativos: aposentadorias (reposição) e empregos devolvidos ao banco (unidade que liberou posição).'
        : 'Nenhuma unidade desta origem tem empregos acima do efetivo. Estes são os sinais de liberação: empregos devolvidos ao banco e aposentadorias.'}</p>`;

    el.querySelector('#vtSim').innerHTML = `
      <ol class="vt-steps">
        <li><b>Olhe a folga por classe</b> no destino: é o único caso em que o D.O.E. já provou que sobram empregos.</li>
        <li><b>Olhe as aposentadorias e as devoluções ao banco</b>: são o estoque que tende a virar vaga.</li>
        <li><b>Confira a função</b>: expanda a unidade na tabela acima e veja as funções com servidores ativos — a permuta só funciona com função compatível.</li>
      </ol>
      <div class="grid cols-2">
        <div>
          <h4>Destino: ${esc(st.destino || '—')} · onde há folga estimada</h4>          ${destino.length
            ? tabelaFolga(destino, '')
            : tabelaSinais(sinaisDestino, 'destino')}
          ${destino.length ? '<p class="hint">“Folga mínima” = o D.O.E. alocou mais empregos do que servidores existem hoje. É o sinal mais forte de vaga disponível.</p>' : ''}
        </div>
        <div>
          <h4>Origem: ${esc(st.origem || '—')} · quem pode liberar</h4>
          ${origem.length ? tabelaFolga(origem, '') : tabelaSinais(sinaisOrigem, 'origem')}
        </div>
      </div>
      <p class="hint">A leitura correta: onde a folga é zero, a vaga <b>pode</b> existir (servidor em outro regime), mas não é possível provar com dados públicos. A permuta exige, em regra, <b>mesma classe</b> e função compatível — confira as funções ativas na unidade de destino ao expandir a linha na tabela acima.</p>`;
  }

  // ---------------------------------------------------------------- gestor
  function drawGestor() {
    const sel = el.querySelector('#vtUnidade');
    const lista = unidades.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    sel.innerHTML = lista.map((u) => `<option value="${esc(u.sigla)}">${esc(u.sigla)} — ${esc(u.nome)}</option>`).join('');
    const maior = unidades.slice().sort((a, b) => (b.vagasPot || 0) - (a.vagasPot || 0))[0];
    const inicial = st.aberto && unidades.some((u) => u.sigla === st.aberto)
      ? st.aberto
      : (maior?.sigla || '');
    sel.value = inicial;
    const u = unidades.find((x) => x.sigla === sel.value);

    const desenha = () => {
      const alvo = unidades.find((x) => x.sigla === sel.value);
      if (!alvo) { el.querySelector('#vtGestor').innerHTML = '<p class="hint">Sem unidade.</p>'; return; }
      const linhas = CLASSES.map((c) => {
        const k = alvo.classes?.[c.key] || { empregos: 0, efetivo: 0, vagasMin: 0 };
        const ref = k.efetivo || 1;
        const ratio = pct(k.empregos, ref);
        return `<tr><td>${c.nome}</td>
          <td class="num">${fmtInt(k.empregos)}</td>
          <td class="num">${fmtInt(k.efetivo)}</td>
          <td class="num">${ratio == null ? '—' : fmtPct(ratio)}</td>
          <td class="num" style="font-weight:${k.vagasMin ? 650 : 400}">${k.vagasMin ? fmtInt(k.vagasMin) : '—'}</td></tr>`;
      }).join('');
      const vagas = CLASSES.map((c) => ({ c, k: alvo.classes?.[c.key] || {} })).filter(({ k }) => (k.vagasMin || 0) > 0);
      const frase = vagas.length
        ? `A defasagem estimada é de <b>${vagas.map(({ c, k }) => `${k.vagasMin} ${c.nome.toLowerCase()}`).join(' + ')}</b>. ` +
          `Com ${alvo.apos12m ?? 0} aposentadoria(s) de TA em 12 meses, a necessidade tende a crescer nesse ritmo se não houver reposição.`
        : `Não há empregos alocados acima do efetivo nesta unidade — o que <b>não</b> descarta vaga, porque o efetivo inclui servidores de outros regimes. ` +
          `A pressão de aposentadoria (${fmtInt(alvo.aposentados)} no total${alvo.apos12m != null ? `, ${alvo.apos12m} em 12 meses` : ''}) é o melhor sinal disponível.`;

      el.querySelector('#vtGestor').innerHTML = `
        <div class="grid cols-2">
          <div>
            <h4>${esc(alvo.sigla)} — ${esc(alvo.nome)} <span class="hint">${esc(alvo.campus)} · ${esc(alvo.cidade)}</span></h4>
            <table class="data mini"><thead><tr><th>Classe</th><th class="num">Empregos</th><th class="num">Efetivo</th><th class="num">Empregos/efetivo</th><th class="num">Vagas mín.</th></tr></thead>
            <tbody>${linhas}</tbody></table>
            <p class="hint">${frase}</p>
          </div>
          <div>
            <h4>Histórico de empregos alocados</h4>
            ${historicoHtml(alvo)}
            <p class="hint">Total: ${fmtInt(alvo.empregos)} empregos · ${fmtInt(alvo.efetivo)} servidores ativos · banco: ${fmtInt(alvo.recebidosBanco)} recebido(s) / ${fmtInt(alvo.devolvidosBanco)} devolvido(s) em 3 anos.</p>
          </div>
        </div>`;
    };
    desenha();
    sel.onchange = () => { st.aberto = sel.value; desenha(); };
    el.querySelector('#vtUnidade').value = u ? u.sigla : '';
  }

  function historicoHtml(u) {
    const hist = u.historico || {};
    const anos = Object.keys(hist).sort();
    if (!anos.length) return '<p class="hint">Sem série.</p>';
    const max = Math.max(...anos.map((a) => hist[a] || 0), 1);
    const primeiro = hist[anos[0]] || 0;
    const ultimo = hist[anos[anos.length - 1]] || 0;
    return `<div class="vt-hist big">${anos.map((a) => `<span title="${a}: ${hist[a]}" style="height:${Math.max(3, Math.round((hist[a] / max) * 90))}px"></span>`).join('')}</div>
      <div class="hint vt-hist-x">${anos[0]} (${fmtInt(primeiro)}) → ${anos[anos.length - 1]} (${fmtInt(ultimo)}) · Δ ${ultimo - primeiro >= 0 ? '+' : ''}${fmtInt(ultimo - primeiro)}</div>`;
  }

  // ----------------------------------------------------------------- csv
  el.querySelector('#vtcsv').addEventListener('click', () => {
    const cab = ['sigla', 'nome', 'campus', 'cidade', 'empregos', 'efetivo', 'vagasMin', 'vagasPot',
      'aposentados', 'apos12m', 'recebidosBanco', 'devolvidosBanco', 'empregos_bas', 'efetivo_bas',
      'empregos_tec', 'efetivo_tec', 'empregos_sup', 'efetivo_sup'];
    const linhas = unidades.map((u) => [
      u.sigla, u.nome, u.campus, u.cidade, u.empregos, u.efetivo, u.vagasMin ?? '', u.vagasPot ?? '',
      u.aposentados, u.apos12m ?? '', u.recebidosBanco, u.devolvidosBanco,
      u.classes?.bas?.empregos ?? '', u.classes?.bas?.efetivo ?? '',
      u.classes?.tec?.empregos ?? '', u.classes?.tec?.efetivo ?? '',
      u.classes?.sup?.empregos ?? '', u.classes?.sup?.efetivo ?? '',
    ]);
    downloadFile(`vagas-ta-estimativa-${d.anoReferencia}.csv`, '\ufeff' + toCSV([cab, ...linhas]));
  });

  // ------------------------------------------------------------- wiring
  const campusSel = el.querySelector('#vtCampusSel');
  campusSel.innerHTML = `<option value="todos">Todos os campi</option>${campusList().map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}`;
  campusSel.addEventListener('change', () => { st.campus = campusSel.value; drawUnidades(); });

  el.querySelector('#vtq').addEventListener('input', (ev) => {
    st.q = ev.target.value.trim().toLowerCase();
    drawUnidades();
  });

  bindSegs(el, (name, v) => {
    if (name === 'classe') { st.classe = v; drawUnidades(); }
  });

  el.querySelector('#vtOrigem').addEventListener('change', (ev) => { st.origem = ev.target.value; drawSim(); });
  el.querySelector('#vtDestino').addEventListener('change', (ev) => { st.destino = ev.target.value; drawSim(); });

  drawCampus();
  drawUnidades();
  drawSim();
  drawGestor();
}
