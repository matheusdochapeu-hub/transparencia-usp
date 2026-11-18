# Plano — Vagas de servidores (estimativas D.O.E. × Transparência × Anuário)

> **Status:** aba fora do menu desde 18/11/2026. A publicação fica suspensa até o
> retorno do DRH ao pedido de dados (seção 4) e até a revisão de UX/critérios.
> Este documento guarda o diagnóstico, o plano e o texto do pedido.

## 1. Contexto

A aba tentava responder duas perguntas:

1. **Gestor:** qual a defasagem da minha unidade/campus e quanto preciso contratar?
2. **Servidor:** onde há (ou pode haver) vaga, por classe e função, para pedir
   remoção/permuta entre unidades e campi?

Ela foi tirada do ar porque o indicador atual (“vagas mínimas = empregos alocados −
efetivo”) é **frágil e potencialmente enganoso**: o efetivo do Anuário/Transparência
mistura regimes (empregos públicos CLT e cargos antigos), então só aparece vaga quando
os empregos superam o efetivo total. Isso produz um caso isolado (EEL/Lorena) que pode
ser posição não provida, não necessidade real.

## 2. Estado atual dos dados (snapshot 18/11/2026)

| Métrica | Valor |
|---|---|
| Páginas do D.O.E. processadas | 3.933 de 3.994 (98,5%) |
| Portarias | 3.380 |
| Linhas extraídas | 4.740 (2.745 distribuições, 1.995 redistribuições) |
| Empregos alocados (estoque) | **6.056** de 8.893 da LC 1.074/2008 = **68,1%** |
| — Superior | 2.069 / 2.593 = 79,8% |
| — Técnico | 2.724 / 3.729 = 73,0% |
| — Básico | **1.263 / 2.571 = 49,1%** (maior lacuna) |
| Efetivo TA ativo (Transparência) | 13.175 |
| Aposentados TA | 1.795 |
| Faixa 71–80 anos (TA) | **438** → ~44 completam 75 anos/ano (estimativa uniforme) |
| Faixa 71–80 anos (docentes) | 298 → ~30/ano |
| Lacunas conhecidas | 57 PDFs fora do ar; 80 distribuições “sem padrão”; 54 páginas sem cabeçalho; 2013 suprido pela Normas USP |

Caso atípico: **EEL (Lorena)** — 60 empregos alocados × 29–34 servidores ativos. A
portaria GR 5924/2012 distribuiu 39 empregos de uma vez à EEL; a razão empregos/efetivo
é 2,07 (mediana da USP: 0,47). Precisa de confirmação do DRH antes de virar manchete.

## 3. O que o D.O.E. resolve — e o que não resolve

| Pergunta | D.O.E. | Precisa de outra fonte |
|---|---|---|
| Empregos alocados por unidade/classe | Sim | — |
| Movimentos entre unidades / banco de vagas | Sim | — |
| Cargos **ocupados** × **vagos** | Não | DRH (quadro de lotação) |
| Quem completa **75 anos** em 12 meses | Não | DRH (nascimento) ou estimativa pela faixa 71–80 |

## 4. Pedido ao DRH (LAI / transparência ativa) — texto pronto

Assunto: **Quadro de empregos públicos e dados agregados de idade dos servidores
técnico-administrativos**

> Prezados, com base na Lei de Acesso à Informação, solicito:
>
> 1. **Quadro de empregos públicos** da USP, por unidade e campus, com:
>    a) empregos **autorizados** (por classe: Básico, Técnico, Superior; e por função,
>       quando houver);
>    b) empregos **ocupados**;
>    c) empregos **vagos**;
>    d) data de referência do levantamento.
> 2. **Distribuição agregada dos servidores técnico-administrativos ativos por unidade
>    e idade** (ou ano de nascimento), em faixas de 1 ano ou, no mínimo, 71–75 e 76–80.
>    Não são necessários nomes, matrículas ou qualquer dado individual identificável.
> 3. **Extrato do Banco de Empregos Públicos** (saldo atual e movimentações dos últimos
>    24 meses: empregos devolvidos e redistribuídos, por unidade).
>
> Justificativa: os dados públicos (D.O.E., Portal da Transparência e Anuário) permitem
> estimar a alocação de empregos, mas não distinguem empregos ocupados de vagos nem a
> idade dos servidores; com esses três conjuntos seria possível produzir um painel de
> vagas com precisão, útil à gestão e à mobilidade dos servidores.

**Se o DRH responder apenas parcialmente**, priorizar o item 1 (ocupados × vagos): é o
que transforma a estimativa em número oficial.

## 5. Onde cavar no D.O.E. (busca profunda)

1. **Anexos em tabela (maior ganho).** Portarias “distribui os empregos conforme anexo”,
   com colunas unidade × classe × quantidade. O parser atual lê só a unidade da prosa;
   implementar o leitor de anexo deve fechar boa parte do Básico (49% → 80%+).
2. **PDFs mortos (57 páginas).** Reconstruir o link na Imprensa Oficial
   (`GatewayPDF.aspx?pagina=…&data=…&caderno=…`) usando data + página que já vêm do DRH.
3. **2013.** A biblioteca do DRH não tem a página; já suprimos pela Normas USP, mas vale
   varrer o índice anual completo (não só ementas com “emprego”).
4. **Termos além de “emprego público”:** “empregos públicos”, “distribuição de empregos”,
   “Banco de Empregos Públicos”, “LC 1074”, “redistribuição”.
5. **Reconciliação por classe** contra os totais da lei (2.593 / 3.729 / 2.571) para medir
   o que falta a cada rodada — sem isso, a busca vira garimpo.

## 6. Modelo proposto (a implementar depois do DRH)

- **Posições autorizadas** = empregos do D.O.E. (reconciliados com 8.893).
- **Ocupadas (est.)** = `min(empregos, efetivo TA)` — hipótese explícita.
- **Vagas (est.)** = `max(0, empregos − efetivo TA)` — limite inferior.
- **Aposentadoria obrigatória em 12m (est.)** = `faixa_71_80 / 10` por unidade e carreira,
  com banda de incerteza (0,5× a 1,5×).
- **Pressão** = `(vagas est. + aposentadorias 12m) / efetivo` — publicar em **banda**, não
  em número único.
- **Permuta** = classe + função; a função só é conhecida quando o D.O.E. detalha a tabela.

Com os dados do DRH (itens 1 e 2), substituir “est.” por valores oficiais e manter o
D.O.E. apenas para a série histórica e o fluxo.

## 7. Checklist antes de publicar

- [ ] Rodada de auditoria do D.O.E. (anexos + PDFs mortos + reconciliação por classe)
- [ ] Modelo escrito, com hipóteses e bandas de incerteza visíveis na tela
- [ ] Validar 3–5 unidades contra o quadro do DRH
- [ ] UX revisada: duas personas, uma tabela, três sinais, sem jargão
- [ ] Nome/posição da aba definidos (provável “Vagas”, dentro do universo de “Servidores”)
- [ ] Página de metodologia com limites e o pedido ao DRH registrado

## 8. Roadmap sugerido

| Etapa | Esforço | Entrega |
|---|---|---|
| Auditoria do D.O.E. + parser de anexos | 2 dias | lista de portarias sem linha, cobertura por classe |
| Recuperar PDFs mortos + reconciliação | 2 dias | cobertura ~90% |
| Pedido ao DRH + modelagem | 1 semana | quadro oficial ou plano B documentado |
| UX + publicação | 1 semana | aba “Vagas” no ar |

## 9. Riscos e armadilhas

- **Efêmero × estrutural:** EEL pode ser posição não provida; não usar como “mais
  necessitada” sem confirmação.
- **Regimes misturados:** o efetivo inclui cargos antigos; qualquer conta de vagas sem o
  DRH é limite inferior.
- **Faixa 71–80:** a estimativa uniforme pode subestimar (concentração etária) ou
  superestimar; sempre mostrar a banda.
- **Cobertura:** 32% dos empregos ainda não estão no livro-razão; unidades com
  distribuição faltante aparecem com estoque menor do que o real.
