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
    path = os.path.join(ROOT, "data", "scope", f"unit-{sigla}.json")
    raw = read_json(path)
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

    # movimentos recentes (ganhos/perdas) a partir das linhas do D.O.E.
    rows = (read_json(os.path.join(DOE, "rows.json"), {}) or {}).get("linhas", [])
    mov = {}
    for r in rows:
        if r["tipo"] == "distribuicao":
            continue
        if r["tipo"] == "destinacao":
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

    linhas = []
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
        vagas_min = max(0, empregos - efetivo)
        vagas_pot = vagas_min + (apos12 or 0)
        meta = unidades_idx.get(sigla, {})
        campus = meta.get("campus") or next((u.get("campus") for u in (tec.get("units") or []) if u["sigla"] == sigla), "")
        m = mov.get(sigla, {})
        linhas.append({
            "sigla": sigla,
            "nome": meta.get("name") or next((u.get("name") for u in (tec.get("units") or []) if u["sigla"] == sigla), sigla),
            "campus": campus,
            "cidade": CIDADE.get(campus, "—"),
            "empregos": empregos,
            "efetivo": efetivo,
            "efetivoAno": int(ult),
            "aposentados": apos,
            "apos12m": apos12,
            "vagasMin": vagas_min,
            "vagasPot": vagas_pot,
            "docentesAposentados": int(sc.get("docentesAposentados") or 0),
            "movGanhos": m.get("ganhos", 0),
            "movPerdas": m.get("perdas", 0),
            "movUltimo": m.get("ultimo", ""),
        })
    linhas.sort(key=lambda l: (-l["vagasPot"], -l["vagasMin"], -l["aposentados"], l["nome"]))

    campi = {}
    for l in linhas:
        c = campi.setdefault(l["campus"], {
            "campus": l["campus"], "cidade": l["cidade"],
            "unidades": 0, "empregos": 0, "efetivo": 0, "aposentados": 0,
            "apos12m": 0, "vagasMin": 0, "vagasPot": 0, "movGanhos": 0, "movPerdas": 0,
        })
        c["unidades"] += 1
        for k in ("empregos", "efetivo", "aposentados", "vagasMin", "vagasPot", "movGanhos", "movPerdas"):
            c[k] += l[k]
        c["apos12m"] += l["apos12m"] or 0
    campi_lista = sorted(campi.values(), key=lambda c: -c["vagasPot"])

    total_empregos = sum(l["empregos"] for l in linhas)
    total_efetivo = sum(l["efetivo"] for l in linhas)
    resumo = {
        "empregosAlocados": total_empregos,
        "efetivoTecnicoAdministrativo": total_efetivo,
        "aposentados": sum(l["aposentados"] for l in linhas),
        "apos12m": sum(l["apos12m"] or 0 for l in linhas),
        "vagasMin": sum(l["vagasMin"] for l in linhas),
        "vagasPot": sum(l["vagasPot"] for l in linhas),
        "unidades": len(linhas),
        "unidadesComEmpregos": sum(1 for l in linhas if l["empregos"]),
    }

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "anoReferencia": ano,
        "metodo": (
            "empregos = estoque de empregos públicos alocados por unidade segundo o D.O.E. "
            "(distribuições e redistribuições); efetivo = técnico-administrativos ativos no "
            "Portal da Transparência; vagasMin = max(0, empregos - efetivo); apos12m = novas "
            "aposentadorias de técnico-administrativos em 12 meses; vagasPot = vagasMin + apos12m."
        ),
        "aviso": (
            "O efetivo do Anuário reúne servidores de todos os regimes (cargos e empregos). "
            "vagasMin é um limite inferior: só aparecem vagas quando os empregos alocados "
            "superam o efetivo total da unidade. Para o número exato seria necessário o quadro "
            "de lotação do DRH."
        ),
        "resumo": resumo,
        "campi": campi_lista,
        "unidades": linhas,
    }
    destino = os.path.join(OUT, "vagas-tecnicos.json")
    with open(destino, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)

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


if __name__ == "__main__":
    main()
