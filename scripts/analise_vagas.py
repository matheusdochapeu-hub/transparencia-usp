#!/usr/bin/env python3
"""
Cruza três fontes para apontar unidades/campi com vagas potenciais na carreira
técnico-administrativa da USP:

  1. data/doe/ledger.json     — empregos públicos ALOÇADOS por unidade (D.O.E.:
                                distribuições criam estoque, redistribuições movem);
  2. data/scope/unit-*.json   — efetivo e aposentados por unidade (Portal da
                                Transparência; categoria "Total" = docentes,
                                técnico-administrativos e aposentados);
  3. docs/data/tecnicos.json  — série do efetivo técnico-administrativo por
                                carreira (Anuário Estatístico, T2.14/2.16/2.20).

Método (documentado no próprio JSON):
  - empregos ....... estoque de empregos públicos alocado à unidade no fim do
                     período coberto pelo D.O.E.;
  - efetivo ........ técnico-administrativos ativos na última competência;
  - vagasMin ....... max(0, empregos - efetivo): se há mais empregos alocados do
                     que servidores na unidade, esse excedente está
                     necessariamente vago (limite inferior seguro);
  - apos12m ........ variação de "Servidores aposentados" em 12 meses — pressão
                     de aposentadoria, que tende a abrir vagas;
  - vagasPot ...... vagasMin + apos12m (posições vagas hoje + recém-vagas).

Uso:
  python scripts/analise_vagas.py
  python scripts/analise_vagas.py --ano 2026
"""

from __future__ import annotations

import argparse
import glob
import json
import os
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOE = os.path.join(ROOT, "data", "doe")
OUT = os.path.join(ROOT, "docs", "data")
CIDADE = {
    "São Paulo": "São Paulo",
    "Ribeirão Preto": "Ribeirão Preto",
    "São Carlos": "São Carlos",
    "Bauru": "Bauru",
    "Piracicaba": "Piracicaba",
    "Lorena": "Lorena",
    "Pirassununga": "Pirassununga",
    "Órgãos centrais (RUSP)": "São Paulo",
    "Não identificado": "—",
}


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return default


def scope_unit(sigla: str):
    """Última competência do recorte da unidade: doc, tecAdm, docApos, tecApos."""
    raw = read_json(os.path.join(ROOT, "data", "scope", f"unit-{sigla}.json"))
    if not raw or not raw.get("refs"):
        return None
    refs = sorted(raw["refs"])
    ultimo = None
    for ref in refs:
        rows = (raw["refs"].get(ref) or {}).get("categoria") or []
        if not rows:
            continue
        total = rows[0]
        if isinstance(total, dict):
            total = [total.get("label", "Total"), total.get("doc", 0), total.get("tecAdm", 0),
                     total.get("docApos", 0), total.get("tecAdmApos", 0)]
        if sum(int(x or 0) for x in total[1:]) > 0:
            ultimo = (ref, [int(x or 0) for x in total[1:5]])
    if not ultimo:
        return None
    ref, (doc, tec, doc_apos, tec_apos) = ultimo
    # 12 meses antes (mesma competência do ano anterior), se existir
    ano, mes = ref.split("-")
    alvo = f"{int(ano) - 1}-{mes}"
    apos12 = None
    if alvo in raw["refs"]:
        rows = (raw["refs"].get(alvo) or {}).get("categoria") or []
        if rows:
            total = rows[0]
            base = int(total[4] if not isinstance(total, dict) else total.get("tecAdmApos", 0) or 0)
            apos12 = max(0, tec_apos - base)
    return {
        "ref": ref, "docentes": doc, "efetivo": tec,
        "docentesAposentados": doc_apos, "aposentados": tec_apos, "apos12m": apos12,
    }


def scope_funcoes(sigla: str, limite: int = 12):
    """Servidores ativos por função na última competência do recorte da unidade."""
    raw = read_json(os.path.join(ROOT, "data", "scope", f"unit-{sigla}.json"))
    if not raw or not raw.get("refs"):
        return []
    refs = sorted(raw["refs"])
    for ref in reversed(refs):
        rows = (raw["refs"].get(ref) or {}).get("funcao") or []
        if not rows:
            continue
        itens = []
        for row in rows:
            if isinstance(row, dict):
                nome = row.get("label") or row.get("nome")
                valor = row.get("tecAdm", row.get("tec", 0))
            else:
                # [label, doc, tecAdm, docApos, tecAdmApos]
                nome = row[0]
                valor = row[2] if len(row) > 2 else 0
            try:
                valor = int(valor or 0)
            except (TypeError, ValueError):
                valor = 0
            if nome and valor:
                itens.append((str(nome), valor))
        if itens:
            itens.sort(key=lambda x: -x[1])
            return [{"nome": n, "ativos": v} for n, v in itens[:limite]]
    return []


def write_markdown(payload: dict, destino: str) -> None:
    r = payload["resumo"]
    linhas = payload["unidades"]
    campi = payload["campi"]
    L = []
    L.append("# Vagas técnico-administrativas por unidade — D.O.E. × Transparência × Anuário")
    L.append("")
    L.append(f"Gerado em {payload['generatedAt'][:10]} · estoque do D.O.E. em {payload['anoReferencia']} · "
             f"efetivo de {payload['anoReferencia']} (Transparência/Anuário).")
    L.append("")
    L.append("## Método")
    L.append("")
    L.append(payload["metodo"])
    L.append("")
    L.append(f"Cobertura do acervo: os empregos identificados equivalem a "
             f"{r.get('coberturaLc1074', '—')}% dos 8.893 criados pela LC 1.074/2008. "
             "Lacunas conhecidas: página de 2013 ausente na biblioteca do DRH (suprida pela "
             "Normas USP), alguns PDFs de 2015–2021 fora do ar e anexos em imagem não lidos.")
    L.append("")
    L.append("## Resumo")
    L.append("")
    L.append(f"- **{r['empregosAlocados']:,}** empregos públicos alocados (D.O.E.)".replace(",", "."))
    L.append(f"- **{r['efetivoTecnicoAdministrativo']:,}** técnico-administrativos ativos".replace(",", "."))
    L.append(f"- **{r['vagasMin']:,}** vagas mínimas (empregos acima do efetivo)".replace(",", "."))
    L.append(f"- **{r['apos12m']:,}** aposentadorias de TA nos últimos 12 meses".replace(",", "."))
    L.append(f"- **{r['vagasPot']:,}** vagas potenciais (mínimas + aposentadorias)".replace(",", "."))
    L.append(f"- {r['unidadesComEmpregos']} de {r['unidades']} unidades com empregos identificados")
    L.append("")
    L.append("## Unidades com mais vagas potenciais")
    L.append("")
    L.append("| Unidade | Campus | Cidade | Empregos | Efetivo | Aposent. | Apos. 12m | Vagas mín. | Vagas pot. |")
    L.append("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |")
    for l in linhas[:30]:
        apos12 = "—" if l["apos12m"] is None else l["apos12m"]
        vmin = "—" if l["vagasMin"] is None else l["vagasMin"]
        vpot = "—" if l["vagasPot"] is None else l["vagasPot"]
        marca = " *(sem série de efetivo)*" if l["semEfetivo"] else ""
        L.append(f"| {l['sigla']} — {l['nome']}{marca} | {l['campus']} | {l['cidade']} | {l['empregos']} | "
                 f"{l['efetivo']} | {l['aposentados']} | {apos12} | {vmin} | {vpot} |")
    L.append("")
    L.append("## Por campus / cidade")
    L.append("")
    L.append("| Campus | Cidade | Unidades | Empregos | Efetivo | Aposent. | Vagas mín. | Vagas pot. |")
    L.append("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |")
    for c in campi:
        L.append(f"| {c['campus']} | {c['cidade']} | {c['unidades']} | {c['empregos']} | "
                 f"{c['efetivo']} | {c['aposentados']} | {c['vagasMin']} | {c['vagasPot']} |")
    L.append("")
    ganhos = [l for l in linhas if l["movGanhos"]]
    ganhos.sort(key=lambda l: (-l["movGanhos"], l["nome"]))
    if ganhos:
        L.append("## Unidades que receberam empregos por redistribuição (últimos 3 anos)")
        L.append("")
        L.append("| Unidade | Cidade | Ganhos | Perdas | Último movimento |")
        L.append("| --- | --- | ---: | ---: | --- |")
        for l in ganhos[:20]:
            L.append(f"| {l['sigla']} — {l['nome']} | {l['cidade']} | {l['movGanhos']} | {l['movPerdas']} | {l['movUltimo'] or '—'} |")
        L.append("")
    L.append("")
    banco = [l for l in linhas if l["recebidosBanco"] or l["devolvidosBanco"]]
    if banco:
        L.append("## Fluxo com a Reitoria / Banco de Reservas de Vagas (últimos 3 anos)")
        L.append("")
        L.append("Empregos que saíram da Reitoria/banco central para a unidade (recebidos) ou voltaram da unidade para lá (devolvidos).")
        L.append("")
        L.append("| Unidade | Cidade | Recebidos | Devolvidos |")
        L.append("| --- | --- | ---: | ---: |")
        for l in sorted(banco, key=lambda x: (-x["recebidosBanco"], -x["devolvidosBanco"]))[:25]:
            L.append(f"| {l['sigla']} — {l['nome']} | {l['cidade']} | {l['recebidosBanco']} | {l['devolvidosBanco']} |")
        L.append("")
    L.append("## Ressalvas")
    L.append("")
    L.append(payload["aviso"])
    L.append("")
    with open(destino, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ano", type=int, default=0, help="ano de referência do estoque do D.O.E.")
    args = ap.parse_args()

    ledger = read_json(os.path.join(DOE, "ledger.json"))
    if not ledger:
        raise SystemExit("data/doe/ledger.json ausente — rode scripts/extract_doe.py antes.")
    tec = read_json(os.path.join(OUT, "tecnicos.json"), {}) or {}
    scopes = (read_json(os.path.join(OUT, "scopes.json"), {}) or {}).get("scopes", [])
    unidades_idx = {s["unidade"]: s for s in scopes if s.get("type") == "unit" and s.get("unidade")}

    anos = sorted(int(y) for y in ledger.get("series", {}))
    ano = args.ano or (anos[-1] if anos else 0)
    serie = ledger.get("series", {}).get(str(ano), {})
    por_ano = ledger.get("porAno", {})

    # movimentos recentes (ganhos/perdas) e fluxo do Banco de Reservas de Vagas
    rows = (read_json(os.path.join(DOE, "rows.json"), {}) or {}).get("linhas", [])
    mov, banco = {}, {}
    for r in rows:
        if r["tipo"] not in ("redistribuicao", "transferencia"):
            continue
        ano_mov = int(r.get("ano") or 0)
        if ano_mov < ano - 3:
            continue
        for lado in ("deKey", "paraKey"):
            key = r.get(lado)
            if not key:
                continue
            m = mov.setdefault(key, {"ganhos": 0, "perdas": 0, "ultimo": ""})
            m["ganhos" if lado == "paraKey" else "perdas"] += 1
            if r.get("data") and r["data"] > m["ultimo"]:
                m["ultimo"] = r["data"]
        vindo_banco = "banco de" in (r.get("de") or "").lower() or r.get("deKey") == "RUSP"
        indo_banco = "banco de" in (r.get("para") or "").lower() or r.get("paraKey") == "RUSP"
        if vindo_banco and r.get("paraKey") and r["paraKey"] != "RUSP":
            banco.setdefault(r["paraKey"], {"recebidos": 0, "devolvidos": 0})["recebidos"] += 1
        if indo_banco and r.get("deKey") and r["deKey"] != "RUSP":
            banco.setdefault(r["deKey"], {"recebidos": 0, "devolvidos": 0})["devolvidos"] += 1

    linhas = []
    series_ledger = ledger.get("series", {})
    unidades_ledger = {u["key"]: u.get("classes", {}) for u in ledger.get("unidadesDetalhe", [])}
    doe_func = {}
    for r in rows:
        if r["tipo"] == "distribuicao" and r.get("categoria") and r.get("paraKey"):
            doe_func.setdefault(r["paraKey"], {})
            doe_func[r["paraKey"]][r["categoria"]] = doe_func[r["paraKey"]].get(r["categoria"], 0) + r["qtd"]
    for sigla, dados in (tec.get("data") or {}).items():
        anos_tec = sorted(int(y) for y in dados)
        if not anos_tec:
            continue
        ult = str(min(anos_tec[-1], ano)) if str(min(anos_tec[-1], ano)) in dados else str(anos_tec[-1])
        serie_tec = dados[ult]
        efetivo = sum(int(serie_tec.get(k, 0)) for k in ("bas", "tec", "sup", "out"))
        empregos = int(serie.get(sigla, 0))
        sc = scope_unit(sigla) or {}
        apos = int(sc.get("aposentados") or 0)
        apos12 = sc.get("apos12m")
        # efetivo zero = unidade sem série no recorte (ex.: SAS, IMT); não é vaga
        sem_efetivo = efetivo == 0
        vagas_min = None if sem_efetivo else max(0, empregos - efetivo)
        vagas_pot = None if vagas_min is None else vagas_min + (apos12 or 0)
        meta = unidades_idx.get(sigla, {})
        campus = meta.get("campus") or next((u.get("campus") for u in (tec.get("units") or []) if u["sigla"] == sigla), "")
        m = mov.get(sigla, {})
        b = banco.get(sigla, {})
        classes_ledger = unidades_ledger.get(sigla, {})
        classes = {}
        for k in ("bas", "tec", "sup"):
            e = int(classes_ledger.get(k, 0))
            f = int(serie_tec.get(k, 0))
            classes[k] = {
                "empregos": e, "efetivo": f,
                "vagasMin": None if sem_efetivo else max(0, e - f),
            }
        funcoes_doe = sorted(
            ({"nome": n, "empregos": v} for n, v in (doe_func.get(sigla) or {}).items()),
            key=lambda x: -x["empregos"],
        )[:10]
        # variação do efetivo em 5 anos (ou desde o primeiro ano com série)
        anos_passado = [str(y) for y in anos_tec if y <= int(ult) - 5]
        ano5 = anos_passado[-1] if anos_passado else str(anos_tec[0])
        serie5 = dados.get(ano5) or {}
        efetivo5a = sum(int(serie5.get(k, 0)) for k in ("bas", "tec", "sup", "out"))
        linhas.append({
            "sigla": sigla,
            "nome": meta.get("name") or next((u.get("name") for u in (tec.get("units") or []) if u["sigla"] == sigla), sigla),
            "campus": campus,
            "cidade": CIDADE.get(campus, "—"),
            "empregos": empregos,
            "efetivo": efetivo,
            "efetivoAno": int(ult),
            "efetivo5a": efetivo5a,
            "deltaEfetivo5a": efetivo - efetivo5a,
            "razaoEmpregosEfetivo": round(empregos / efetivo, 2) if efetivo else None,
            "semEfetivo": sem_efetivo,
            "aposentados": apos,
            "apos12m": apos12,
            "vagasMin": vagas_min,
            "vagasPot": vagas_pot,
            "docentesAposentados": int(sc.get("docentesAposentados") or 0),
            "movGanhos": m.get("ganhos", 0),
            "movPerdas": m.get("perdas", 0),
            "movUltimo": m.get("ultimo", ""),
            "recebidosBanco": b.get("recebidos", 0),
            "devolvidosBanco": b.get("devolvidos", 0),
            "classes": classes,
            "funcoesAtivas": scope_funcoes(sigla),
            "funcoesDoe": funcoes_doe,
            "historico": {y: int((series_ledger.get(y) or {}).get(sigla, 0)) for y in sorted(series_ledger)},
        })
    linhas.sort(key=lambda l: (-(l["vagasPot"] if l["vagasPot"] is not None else -1),
                               -(l["vagasMin"] if l["vagasMin"] is not None else -1),
                               -l["aposentados"], l["nome"]))

    campi = {}
    for l in linhas:
        c = campi.setdefault(l["campus"], {
            "campus": l["campus"], "cidade": l["cidade"],
            "unidades": 0, "empregos": 0, "efetivo": 0, "aposentados": 0,
            "apos12m": 0, "vagasMin": 0, "vagasPot": 0, "movGanhos": 0, "movPerdas": 0,
            "recebidosBanco": 0, "devolvidosBanco": 0, "semEfetivo": 0, "historico": {},
            "classes": {k: {"empregos": 0, "efetivo": 0, "vagasMin": 0} for k in ("bas", "tec", "sup")},
        })
        c["unidades"] += 1
        for k in ("empregos", "efetivo", "aposentados", "movGanhos", "movPerdas",
                  "recebidosBanco", "devolvidosBanco"):
            c[k] += l[k]
        c["apos12m"] += l["apos12m"] or 0
        c["vagasMin"] += l["vagasMin"] or 0
        c["vagasPot"] += l["vagasPot"] or 0
        c["semEfetivo"] += 1 if l["semEfetivo"] else 0
        for k in ("bas", "tec", "sup"):
            cls = l["classes"][k]
            c["classes"][k]["empregos"] += cls["empregos"]
            c["classes"][k]["efetivo"] += cls["efetivo"]
            c["classes"][k]["vagasMin"] += cls["vagasMin"] or 0
        for y, v in (l.get("historico") or {}).items():
            c["historico"][y] = c["historico"].get(y, 0) + int(v or 0)
    campi_lista = sorted(campi.values(), key=lambda c: -c["vagasPot"])

    total_empregos = sum(l["empregos"] for l in linhas)
    total_efetivo = sum(l["efetivo"] for l in linhas)
    resumo = {
        "empregosAlocados": total_empregos,
        "efetivoTecnicoAdministrativo": total_efetivo,
        "aposentados": sum(l["aposentados"] for l in linhas),
        "apos12m": sum(l["apos12m"] or 0 for l in linhas),
        "vagasMin": sum(l["vagasMin"] or 0 for l in linhas),
        "vagasPot": sum(l["vagasPot"] or 0 for l in linhas),
        "unidades": len(linhas),
        "unidadesComEmpregos": sum(1 for l in linhas if l["empregos"]),
        "unidadesSemEfetivo": sum(1 for l in linhas if l["semEfetivo"]),
        "recebidosBanco": sum(l["recebidosBanco"] for l in linhas),
        "devolvidosBanco": sum(l["devolvidosBanco"] for l in linhas),
        "coberturaLc1074": round(total_empregos / 8893 * 100, 1) if total_empregos else None,
    }

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "natureza": "estimativa",
        "anoReferencia": ano,
        "metodo": (
            "empregos = estoque de empregos públicos alocados por unidade segundo o D.O.E. "
            "(distribuições e redistribuições); efetivo = técnico-administrativos ativos no "
            "Portal da Transparência; vagasMin = max(0, empregos - efetivo); apos12m = novas "
            "aposentadorias de técnico-administrativos em 12 meses; vagasPot = vagasMin + apos12m."
        ),
        "aviso": (
            "Estimativas, não um quadro oficial de vagas. O efetivo do Anuário reúne servidores "
            "de todos os regimes (cargos e empregos); o D.O.E. informa quanto foi alocado a cada "
            "unidade, mas não quantos desses empregos estão ocupados. vagasMin é um limite "
            "inferior: só aparece vaga quando os empregos alocados superam o efetivo total da "
            "unidade. O número exato exige o quadro de lotação do DRH — pedido em aberto."
        ),
        "comoLer": [
            "Empregos: total de empregos públicos que o D.O.E. alocou à unidade ao longo da série "
            "(distribuições menos redistribuições).",
            "Efetivo: técnico-administrativos ativos na competência mais recente.",
            "Vagas mínimas: empregos acima do efetivo — é o mínimo que está necessariamente vago.",
            "Vagas potenciais: vagas mínimas + aposentadorias de TA nos últimos 12 meses.",
            "Classe: Básico, Técnico ou Superior — o mesmo recorte usado nos concursos e nas "
            "permutas; a soma das classes pode não fechar com o total porque há empregos sem "
            "classe identificada no D.O.E.",
            "Fluxo com a Reitoria: empregos que saíram do banco central para a unidade (recebidos) "
            "ou voltaram da unidade para lá (devolvidos) nos últimos 3 anos.",
        ],
        "cobertura": {
            "empregosIdentificados": total_empregos,
            "empregosCriadosLc1074": 8893,
            "percentual": resumo.get("coberturaLc1074"),
            "lacunas": "2013 suprido pela Normas USP; PDFs de 2015–2021 fora do ar; anexos em imagem não lidos.",
        },
        "resumo": resumo,
        "campi": campi_lista,
        "unidades": linhas,
    }
    destino = os.path.join(OUT, "vagas-tecnicos.json")
    with open(destino, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
    md = os.path.join(ROOT, "RELATORIO-VAGAS-TECNICOS.md")
    write_markdown(payload, md)

    print(f"ano de referência: {ano}")
    print(f"empregos alocados: {total_empregos} | efetivo TA: {total_efetivo} | "
          f"vagasMin: {resumo['vagasMin']} | vagasPot: {resumo['vagasPot']}")
    print("\nTop 15 unidades (vagasPot):")
    for l in linhas[:15]:
        print(f"  {l['sigla']:<9} {l['cidade']:<16} empregos={l['empregos']:>4} "
              f"efetivo={l['efetivo']:>4} apos={l['aposentados']:>3} "
              f"apos12m={l['apos12m'] if l['apos12m'] is not None else '?':>2} "
              f"vagasMin={l['vagasMin']:>3} pot={l['vagasPot']:>3}")
    print(f"\ngravado em {destino}")
    print(f"relatório em {md}")


if __name__ == "__main__":
    main()
