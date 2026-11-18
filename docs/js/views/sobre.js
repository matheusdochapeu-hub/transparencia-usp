/* Metodologia, fonte e limitações. */

import { store } from '../data.js';
import { pageHead, card, notice } from '../ui.js';
import { esc, fmtInt } from '../util.js';

export async function render(el) {
  const { index } = store;
  const refs = index.refs;
  const n = refs.length;
  const nRows = index.categories.reduce((a, c) => a + c.nRows, 0);

  const faq = [
    {
      q: 'De onde vêm os dados?',
      a: `Diretamente do <a href="https://uspdigital.usp.br/portaltransparencia/" target="_blank" rel="noopener">Portal da Transparência da USP</a>, seção “Busca de Servidores”. O portal publica contagens agregadas por categoria — não há nomes, CPFs ou qualquer dado individual.`,
    },
    {
      q: 'Como a extração funciona?',
      a: `O portal carrega as tabelas por DWR (Direct Web Remoting), um protocolo de chamadas remotas em JavaScript. Nosso extrator conversa com esse mesmo endpoint, o que garante exatamente os números exibidos no site, sem erros de parsing de HTML. Cada competência é consultada nas 11 categorias e gravada como um snapshot mensal.`,
    },
    {
      q: 'Com que frequência atualiza?',
      a: `Uma rotina automatizada (GitHub Actions) roda todo dia 1º do mês, verifica se há competência nova, baixa apenas o que falta e regenera este painel. O histórico nunca é descartado: cada mês extraído fica versionado no repositório.`,
    },
    {
      q: 'Posso ver os dados de uma unidade ou campus específico?',
      a: `Sim. O seletor no topo (<b>USP (geral) → Campus → Unidades</b>) filtra o painel inteiro: panorama, categorias, comparador de períodos e ranking de mudanças passam a refletir só aquele recorte. Os <b>campi</b> têm histórico completo (2015–2026); as <b>unidades</b> têm os últimos 24 meses. O recorte também fica no link: <code>?scope=campus-10</code> ou <code>?scope=unit-EACH</code>.`,
    },
    {
      q: 'Dá para saber quantos cargos estão vagos (em vacância) por campus?',
      a: `Para <b>docentes</b>, sim: o Anuário Estatístico da USP publica, por unidade, quantos cargos de professor estão <b>vagos</b> e <b>providos</b> (Tabela 2.08). A aba <a href="#/vacancia">Vacância</a> traz a série de 2014 a 2025, com totais por campus. Para <b>técnicos administrativos</b> a USP não publica essa informação — ela existe apenas no Banco de Cargos interno. O que existe é o <b>quadro efetivo</b> por carreira (Básico, Técnico e Superior), na aba <a href="#/tecnicos">Servidores</a>. Vale lembrar que <b>cargo vago não é concurso aberto</b>: a decisão de abrir edital é da Reitoria/CAA.`,
    },
    {
      q: 'Por que alguns totais não batem entre categorias?',
      a: `Categorias diferentes podem ter populações ligeiramente distintas. “Função Estrutura”, por exemplo, conta apenas servidores ativos em funções de chefia/coordenação — por isso o total é menor. Nas demais categorias a soma equivale ao total do mês.`,
    },
    {
      q: 'O que significam “aposentados”?',
      a: `São vínculos de aposentados registrados pelo portal, apresentados em colunas separadas dos ativos. Eles não entram no “efetivo ativo”.`,
    },
    {
      q: 'Os números podem mudar depois de publicados?',
      a: `Sim. O próprio portal pode revisar competências passadas. Nossa rotina reaplica os dois meses mais recentes a cada execução para captar correções; meses antigos permanecem como foram extraídos.`,
    },
  ];

  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Sobre',
      title: 'Metodologia e transparência',
      lead: 'Como os dados foram obtidos, o que significam e quais são os limites de interpretação.',
    })}

    <div class="grid cols-3" style="margin-bottom:16px">
      ${card({ title: 'Cobertura', body: `<div class="stat"><span class="s-label">Competências</span><span class="s-value">${fmtInt(n)}</span></div><div class="stat" style="margin-top:10px"><span class="s-label">De</span><span class="s-value">${esc(refs[0].label)}</span></div><div class="stat" style="margin-top:10px"><span class="s-label">Até</span><span class="s-value">${esc(refs[n - 1].label)}</span></div>` })}
      ${card({ title: 'Volume', body: `<div class="stat"><span class="s-label">Registros de categoria</span><span class="s-value">${fmtInt(nRows)}</span></div><div class="stat" style="margin-top:10px"><span class="s-label">Categorias</span><span class="s-value">${index.categories.length}</span></div><div class="stat" style="margin-top:10px"><span class="s-label">Campi</span><span class="s-value">${Object.keys(index.campus?.names || {}).length || '–'}</span></div>` })}
      ${card({ title: 'Privacidade', body: `<p style="font-size:.84rem;color:var(--ink-2)">Nenhum dado pessoal é tratado. O painel trabalha somente com contagens agregadas já publicadas pela USP — não é possível identificar um servidor a partir daqui.</p>` })}
    </div>

    <div class="section card">
      <div class="card-head"><div><h3>Perguntas frequentes</h3></div></div>
      <div style="display:flex;flex-direction:column;gap:14px">
        ${faq
          .map(
            (f) => `<details style="border-bottom:1px solid var(--line);padding-bottom:12px">
              <summary style="cursor:pointer;font-weight:600;font-size:.9rem">${esc(f.q)}</summary>
              <p style="margin-top:8px;font-size:.85rem;color:var(--ink-2);line-height:1.6">${f.a}</p>
            </details>`
          )
          .join('')}
      </div>
    </div>

    <div class="section grid cols-2">
      ${card({
        title: 'Definições',
        body: `<dl style="margin:0;display:grid;grid-template-columns:auto 1fr;gap:8px 14px;font-size:.84rem">
          <dt style="font-weight:600">Docente</dt><dd style="margin:0;color:var(--ink-2)">Servidor do quadro docente ativo.</dd>
          <dt style="font-weight:600">Técnico administrativo</dt><dd style="margin:0;color:var(--ink-2)">Servidor do quadro técnico e administrativo ativo.</dd>
          <dt style="font-weight:600">Aposentado</dt><dd style="margin:0;color:var(--ink-2)">Vínculo de aposentadoria registrado, exibido separadamente.</dd>
          <dt style="font-weight:600">Competência</dt><dd style="margin:0;color:var(--ink-2)">Mês de referência da publicação (ex.: Out/2026).</dd>
          <dt style="font-weight:600">Participação %</dt><dd style="margin:0;color:var(--ink-2)">Fatia do valor dentro do total da categoria naquele mês.</dd>
        </dl>`,
      })}
      ${card({
        title: 'Limitações',
        body: `<ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:7px;font-size:.84rem;color:var(--ink-2)">
          <li>Cobertura começa em ${esc(refs[0].label)} — limite do próprio portal no momento da extração.</li>
          <li>Mudanças de metodologia interna da USP podem gerar descontinuidades na série.</li>
          <li>Quando o portal não publica uma competência (há lacunas, como jul/2026), o mês é omitido da série em vez de aparecer como zero.</li>
          <li>Alguns recortes (por exemplo, <b>Tempo USP</b>) apresentam oscilações fortes no próprio portal; reproduzimos os números como publicados, sem suavização.</li>
          <li>Correlações são exploratórias: não estabelecem causalidade.</li>
          <li>O painel reflete o portal; divergências devem ser reportadas à fonte.</li>
        </ul>`,
      })}
    </div>

    <div class="section">${notice(
      `Projeto independente, sem vínculo oficial com a Universidade de São Paulo. Dados sob responsabilidade da fonte. Código aberto para auditoria e reuso. Última extração: <b>${esc((index.generatedAt || '').slice(0, 10).split('-').reverse().join('/'))}</b>.`,
      'info'
    )}</div>

    <div class="section card">
      <div class="card-head"><div><h3>Como citar</h3></div></div>
      <p style="font-size:.84rem;color:var(--ink-2);line-height:1.6">
        “Transparência USP — Servidores (série histórica ${esc(refs[0].label)}–${esc(refs[n - 1].label)}).”
        Dados originais: Portal da Transparência da Universidade de São Paulo.
        Compilação e visualização: este projeto, disponível em
        <a href="https://github.com/matheusdochapeu-hub/transparencia-usp" target="_blank" rel="noopener">github.com/matheusdochapeu-hub/transparencia-usp</a>.
      </p>
    </div>
  `;
}
