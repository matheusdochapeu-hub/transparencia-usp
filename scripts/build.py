#!/usr/bin/env python3
"""
Constrói os arquivos consumidos pela PWA a partir dos dados brutos do extrator.

Entrada : data/raw/<AAAA-MM>.json, data/raw/_refs.json, data/raw/campus-*.json
Saída   : docs/data/*.json e docs/data/csv/*.csv

Formato compacto: cada categoria vira um arquivo com
  refs   -> ids das competências (ordem cronológica)
  labels -> valores distintos da categoria
  rows   -> [refIdx, labelIdx, doc, tecAdm, docApos, tecAdmApos] (só não-zeros)
"""

from __future__ import annotations

import csv
import json
import os
import re
import statistics
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
DOCS = os.path.join(ROOT, "docs")
OUT = os.path.join(DOCS, "data")

ORDER = [
    "categoria",
    "classe",
    "faixa-etaria",
    "formacao",
    "funcao",
    "funcao-estrutura",
    "jornada",
    "nacionalidade",
    "raca-cor",
    "sexo",
    "tempo-usp",
]
TITLES = {
    "categoria": "Categoria",
    "classe": "Classe",
    "faixa-etaria": "Faixa Etária",
    "formacao": "Formação Acadêmica",
    "funcao": "Função",
    "funcao-estrutura": "Função Estrutura",
    "jornada": "Jornada",
    "nacionalidade": "Nacionalidade",
    "raca-cor": "Raça/Cor",
    "sexo": "Sexo",
    "tempo-usp": "Tempo USP",
}
DESCRIPTIONS = {
    "categoria": "Composição do efetivo por vínculo (docentes, técnicos e aposentados).",
    "classe": "Carreira/classe do servidor: professor doutor, técnico 2, básico 2, superior 2 etc.",
    "faixa-etaria": "Distribuição etária do efetivo em faixas de idade.",
    "formacao": "Maior titulação/grau de instrução declarado.",
    "funcao": "Cargo ou função exercida (professor doutor, técnico de laboratório, auxiliar etc.).",
    "funcao-estrutura": "Funções de estrutura organizacional (chefias, coordenações). Conta apenas servidores ativos.",
    "jornada": "Regime de trabalho: RDIDP, RTC, 40 horas, 30 horas etc.",
    "nacionalidade": "Nacionalidade declarada do servidor.",
    "raca-cor": "Autodeclaração de raça/cor (padrão IBGE).",
    "sexo": "Distribuição por sexo.",
    "tempo-usp": "Tempo de casa na USP, em faixas.",
}
VINCULOS = ["doc", "tecAdm", "docApos", "tecAdmApos"]


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return default


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def write_csv(path, header, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)


def _strip_volatile(obj):
    if isinstance(obj, dict):
        return {k: _strip_volatile(v) for k, v in obj.items() if k != "generatedAt"}
    if isinstance(obj, list):
        return [_strip_volatile(v) for v in obj]
    return obj


def write_if_changed(path: str, obj) -> bool:
    """Grava só se o conteúdo relevante mudou (ignora generatedAt)."""
    prev = read_json(path)
    if prev is not None and _strip_volatile(prev) == _strip_volatile(obj):
        return False
    write_json(path, obj)
    return True


def norm_label(text: str) -> str:
    text = (text or "").strip()
    text = re.sub(r"\s+", " ", text)
    return text or "Total"


def detect_breaks(payload, min_change=10, min_jaccard=0.8):
    """Detecta meses em que o conjunto de rótulos mudou bruscamente (reformulação)."""
    refs = payload["refs"]
    n = len(refs)
    sets = [set() for _ in range(n)]
    for r in payload["rows"]:
        if r[2] + r[3] + r[4] + r[5] > 0:
            sets[r[0]].add(r[1])
    out = []
    for i in range(1, n):
        a, b = sets[i - 1], sets[i]
        if not a or not b:
            continue
        jac = len(a & b) / len(a | b)
        added, removed = len(b - a), len(a - b)
        if jac < min_jaccard and added + removed >= min_change:
            out.append({"ref": refs[i], "jaccard": round(jac, 3), "added": added, "removed": removed})
    return out


def build_vacancia() -> dict | None:
    """Agrega os cargos em vacância de docentes (Anuário, Tabela 2.08)."""
    vdir = os.path.join(ROOT, "data", "vagas")
    if not os.path.isdir(vdir):
        return None
    files = sorted(
        (f for f in os.listdir(vdir) if re.fullmatch(r"T2\.08-\d{4}\.json", f)),
        key=lambda f: int(f[6:10]),
    )
    if not files:
        return None
    mapping = (read_json(os.path.join(vdir, "unit-campus.json")) or {}).get("mapping", {})

    years: list[int] = []
    data: dict[str, dict[str, dict[str, int]]] = {}
    unit_tipo: dict[str, str] = {}
    totals: dict[str, dict[str, int]] = {}
    for name in files:
        snap = read_json(os.path.join(vdir, name))
        if not snap:
            continue
        year = int(snap["year"])
        years.append(year)
        key = str(year)
        for tipo, unidade, cargo, situacao, total in snap["rows"]:
            unidade = re.sub(r"\s+", "", unidade)  # "M A E" -> "MAE"
            bucket = data.setdefault(unidade, {}).setdefault(key, {"iv": 0, "ip": 0, "fv": 0, "fp": 0})
            if cargo == "Cargo Inicial":
                bucket["iv" if situacao == "Vago" else "ip"] += total
            else:
                bucket["fv" if situacao == "Vago" else "fp"] += total
            unit_tipo.setdefault(unidade, tipo)
            tot = totals.setdefault(key, {"iv": 0, "ip": 0, "fv": 0, "fp": 0})
            tot["iv" if (cargo == "Cargo Inicial" and situacao == "Vago") else
                "ip" if (cargo == "Cargo Inicial") else
                "fv" if situacao == "Vago" else "fp"] += total

    campus_agg: dict[str, dict[str, dict[str, int]]] = {}
    units_meta = []
    for sigla in sorted(data):
        info = mapping.get(sigla, {})
        # RUSP é o banco de cargos dos órgãos centrais, não um campus
        campus = "Órgãos centrais (RUSP)" if sigla == "RUSP" else (info.get("campus") or "Não identificado")
        units_meta.append(
            {"sigla": sigla, "name": info.get("name") or "", "campus": campus, "tipo": unit_tipo.get(sigla, "")}
        )
        for ykey, vals in data[sigla].items():
            agg = campus_agg.setdefault(campus, {}).setdefault(ykey, {"iv": 0, "ip": 0, "fv": 0, "fp": 0})
            for k, v in vals.items():
                agg[k] += v

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "Anuário Estatístico da USP — Tabela 2.08 (Quadro de Docentes efetivos)",
        "sourceUrl": "https://uspdigital.usp.br/anuario/",
        "note": "Cargos de docente (inicial e final) por unidade. A USP não publica cargos em vacância de técnicos administrativos.",
        "years": years,
        "units": units_meta,
        "data": data,
        "campus": campus_agg,
        "totals": totals,
    }
    changed = write_if_changed(os.path.join(OUT, "vacancia.json"), payload)
    last = str(years[-1])
    t = totals[last]
    print(
        f"  vacância: {len(years)} anos ({years[0]}–{years[-1]}), {len(units_meta)} unidades | "
        f"{last}: {t['iv'] + t['ip'] + t['fv'] + t['fp']} cargos, {t['iv'] + t['fv']} vagos"
        + ("" if changed else " (sem mudanças)")
    )
    return payload


CAT_MAP = {"Básico": "bas", "Técnico": "tec", "Superior": "sup", "não enquadrado": "out"}
# variantes de sigla entre edições e unidades fora do cadastro do portal
UNIT_ALIAS = {"SIBi": "SIBI", "PUSPQSD": "PUSP-QSD"}
EXTRA_CAMPUS = {"PUSP-QSD": "São Paulo"}


def build_tecnicos() -> dict | None:
    """Quadro efetivo técnico-administrativo por carreira e unidade (Anuário, T2.14)."""
    vdir = os.path.join(ROOT, "data", "vagas")
    if not os.path.isdir(vdir):
        return None
    files = sorted(
        (f for f in os.listdir(vdir) if re.fullmatch(r"T2\.14-\d{4}\.json", f)),
        key=lambda f: int(f[6:10]),
    )
    if not files:
        return None
    mapping = (read_json(os.path.join(vdir, "unit-campus.json")) or {}).get("mapping", {})

    years: list[int] = []
    data: dict[str, dict[str, dict[str, int]]] = {}
    unit_tipo: dict[str, str] = {}
    totals: dict[str, dict[str, int]] = {}
    for name in files:
        snap = read_json(os.path.join(vdir, name))
        if not snap:
            continue
        year = int(snap["year"])
        years.append(year)
        key = str(year)
        for tipo, unidade, categoria, total in snap["rows"]:
            unidade = re.sub(r"\s+", "", unidade)
            unidade = UNIT_ALIAS.get(unidade, unidade)
            cat = CAT_MAP.get(categoria)
            if not cat:
                continue
            bucket = data.setdefault(unidade, {}).setdefault(key, {"bas": 0, "tec": 0, "sup": 0, "out": 0})
            bucket[cat] += total
            unit_tipo.setdefault(unidade, tipo)
            tot = totals.setdefault(key, {"bas": 0, "tec": 0, "sup": 0, "out": 0})
            tot[cat] += total

    campus_agg: dict[str, dict[str, dict[str, int]]] = {}
    units_meta = []
    for sigla in sorted(data):
        info = mapping.get(sigla, {})
        tipo = unit_tipo.get(sigla, "")
        campus = (
            "Órgãos centrais (RUSP)"
            if sigla == "RUSP"
            else EXTRA_CAMPUS.get(sigla) or info.get("campus") or "Não identificado"
        )
        if campus == "Não identificado" and tipo.startswith("E"):
            campus = "Órgãos centrais (RUSP)"
        units_meta.append({"sigla": sigla, "name": info.get("name") or "", "campus": campus, "tipo": tipo})
        for ykey, vals in data[sigla].items():
            agg = campus_agg.setdefault(campus, {}).setdefault(ykey, {"bas": 0, "tec": 0, "sup": 0, "out": 0})
            for k, v in vals.items():
                agg[k] += v

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "Anuário Estatístico da USP — Tabela 2.14 (Servidores Técnicos e Administrativos)",
        "sourceUrl": "https://uspdigital.usp.br/anuario/",
        "note": "Quadro EFETIVO (servidores providos). A USP não publica cargos em vacância para esta carreira.",
        "years": years,
        "units": units_meta,
        "data": data,
        "campus": campus_agg,
        "totals": totals,
    }
    write_if_changed(os.path.join(OUT, "tecnicos.json"), payload)
    last = str(years[-1])
    t = totals[last]
    print(
        f"  técnicos: {len(years)} anos ({years[0]}–{years[-1]}), {len(units_meta)} unidades | "
        f"{last}: {sum(t.values())} servidores (Básico {t['bas']}, Técnico {t['tec']}, Superior {t['sup']})"
    )
    return payload


def main():
    refs_meta = read_json(os.path.join(RAW, "_refs.json"))
    if not refs_meta:
        raise SystemExit("data/raw/_refs.json ausente — rode scripts/extract.py")

    all_refs = refs_meta["refs"]
    months = []
    for r in all_refs:
        snap = read_json(os.path.join(RAW, r["id"] + ".json"))
        if not snap or not snap.get("categories"):
            continue
        total = sum(
            (row.get("doc") or 0) + (row.get("tecAdm") or 0) + (row.get("docApos") or 0) + (row.get("tecAdmApos") or 0)
            for row in (snap["categories"].get("categoria") or [])
        )
        if total == 0:
            print(f"  (ignorando {r['id']}: competência sem total oficial)")
            continue
        months.append(snap)

    if not months:
        raise SystemExit("nenhum snapshot mensal encontrado em data/raw")

    months.sort(key=lambda m: m["ref"])
    ref_ids = [m["ref"] for m in months]
    ref_labels = {m["ref"]: m.get("label") or m["ref"] for m in months}
    n_refs = len(ref_ids)
    print(f"{n_refs} competências: {ref_ids[0]} .. {ref_ids[-1]}")

    # ---- totais por competência (Categoria "Total") -------------------------
    totals = []
    for m in months:
        row = (m["categories"].get("categoria") or [{}])[0]
        totals.append(
            [int(row.get("doc") or 0), int(row.get("tecAdm") or 0), int(row.get("docApos") or 0), int(row.get("tecAdmApos") or 0)]
        )

    # ---- por categoria ------------------------------------------------------
    categories_meta = []
    category_payload = {}
    for slug in ORDER:
        # 1) consolida linhas duplicadas (o portal separa alguns rótulos por vínculo)
        per_ref = []
        union = set()
        for mi, m in enumerate(months):
            rows = m["categories"].get(slug) or []
            if slug == "categoria":
                # "Categoria" traz uma única linha "Total": vira 4 linhas de vínculo
                t = totals[mi]
                agg = {
                    "Docente": [t[0], 0, 0, 0],
                    "Técnico Administrativo": [0, t[1], 0, 0],
                    "Docente Aposentado": [0, 0, t[2], 0],
                    "Técnico Administrativo Aposentado": [0, 0, 0, t[3]],
                }
            else:
                agg = defaultdict(lambda: [0, 0, 0, 0])
                for row in rows:
                    key = norm_label(row.get("label"))
                    vals = agg[key]
                    vals[0] += int(row.get("doc") or 0)
                    vals[1] += int(row.get("tecAdm") or 0)
                    vals[2] += int(row.get("docApos") or 0)
                    vals[3] += int(row.get("tecAdmApos") or 0)
            per_ref.append(agg)
            union.update(agg.keys())

        # 2) ordena rótulos por volume total (maior primeiro)
        totals_by_label = defaultdict(int)
        for agg in per_ref:
            for label, vals in agg.items():
                totals_by_label[label] += sum(vals)
        labels = sorted(union, key=lambda l: (-totals_by_label[l], l))
        if slug == "categoria":
            # ordem fixa para casar as cores com o restante do painel
            fixed = ["Docente", "Técnico Administrativo", "Docente Aposentado", "Técnico Administrativo Aposentado"]
            labels = [l for l in fixed if l in union] + [l for l in labels if l not in fixed]
        index = {l: i for i, l in enumerate(labels)}

        rows = []
        for ri, agg in enumerate(per_ref):
            for label, vals in agg.items():
                if not any(vals):
                    continue
                rows.append([ri, index[label], vals[0], vals[1], vals[2], vals[3]])

        payload = {
            "slug": slug,
            "title": TITLES[slug],
            "kind": "vinculo" if slug == "categoria" else ("structure" if slug == "funcao-estrutura" else "breakdown"),
            "refs": ref_ids,
            "labels": labels,
            "rows": rows,
        }
        category_payload[slug] = payload
        write_json(os.path.join(OUT, slug + ".json"), payload)

        # 3) CSV largo: rótulo x competência (total de servidores)
        header = ["valor"] + [ref_labels[r] for r in ref_ids]
        csv_rows = []
        for li, label in enumerate(labels):
            cells = [0] * n_refs
            for row in rows:
                if row[1] == li:
                    cells[row[0]] = row[2] + row[3] + row[4] + row[5]
            csv_rows.append([label] + cells)
        write_csv(os.path.join(OUT, "csv", slug + ".csv"), header, csv_rows)

        categories_meta.append(
            {
                "slug": slug,
                "title": TITLES[slug],
                "description": DESCRIPTIONS[slug],
                "kind": payload["kind"],
                "file": f"data/{slug}.json",
                "nValues": len(labels),
                "nRows": len(rows),
                "breaks": detect_breaks(payload),
            }
        )
        print(f"  {slug:16} {len(labels):4d} valores  {len(rows):6d} registros  {os.path.getsize(os.path.join(OUT, slug + '.json'))/1024:8.1f} KB")

    # ---- CSV de totais ------------------------------------------------------
    write_csv(
        os.path.join(OUT, "csv", "totais.csv"),
        ["competencia", "docente", "tecnico_administrativo", "docente_aposentado", "tecnico_administrativo_aposentado", "total"],
        [
            [ref_labels[r], *t, sum(t)]
            for r, t in zip(ref_ids, totals)
        ],
    )

    # ---- campi --------------------------------------------------------------
    campus_out = None
    campus_series = read_json(os.path.join(ROOT, "data", "raw-campus-series.json")) or read_json(
        os.path.join(RAW, "campus-series.json")
    )
    campus_meta = read_json(os.path.join(ROOT, "data", "raw-campus-meta.json")) or read_json(
        os.path.join(RAW, "..", "raw-campus-meta.json")
    )
    if campus_series:
        camps = campus_series.get("campuses") or (campus_meta or {}).get("campuses") or []
        names = {str(c["code"]): c["name"] for c in camps}
        by_ref = defaultdict(dict)
        for row in campus_series.get("rows", []):
            by_ref[row["ref"]][str(row["campus"])] = [
                row["doc"],
                row["tecAdm"],
                row["docApos"],
                row["tecAdmApos"],
            ]
        series = []
        for c in camps:
            code = str(c["code"])
            series.append(
                {
                    "code": code,
                    "name": names.get(code, code),
                    "series": [by_ref[r].get(code, [0, 0, 0, 0]) for r in ref_ids],
                }
            )
        campus_out = {"refs": ref_ids, "campuses": series}
        write_json(os.path.join(OUT, "campus.json"), campus_out)
        print(f"  campus: {len(camps)} campi x {n_refs} competências")

    # ---- campus x categorias (último mês) ----------------------------------
    campus_cats = read_json(os.path.join(RAW, "campus-categories.json"))
    if campus_cats:
        latest = campus_cats.get("ref")
        cleaned = {}
        for code, cats in (campus_cats.get("data") or {}).items():
            cleaned[str(code)] = {}
            for slug in ORDER:
                rows = cats.get(slug) or []
                if slug == "categoria":
                    tot = rows[0] if rows else {}
                    cleaned[str(code)][slug] = [
                        ["Docente", int(tot.get("doc") or 0), 0, 0, 0],
                        ["Técnico Administrativo", 0, int(tot.get("tecAdm") or 0), 0, 0],
                        ["Docente Aposentado", 0, 0, int(tot.get("docApos") or 0), 0],
                        ["Técnico Administrativo Aposentado", 0, 0, 0, int(tot.get("tecAdmApos") or 0)],
                    ]
                    continue
                agg = defaultdict(lambda: [0, 0, 0, 0])
                for row in rows:
                    key = norm_label(row.get("label"))
                    v = agg[key]
                    v[0] += int(row.get("doc") or 0)
                    v[1] += int(row.get("tecAdm") or 0)
                    v[2] += int(row.get("docApos") or 0)
                    v[3] += int(row.get("tecAdmApos") or 0)
                cleaned[str(code)][slug] = [
                    [label, *vals] for label, vals in sorted(agg.items(), key=lambda kv: -sum(kv[1]))
                ]
        write_json(
            os.path.join(OUT, "campus-latest.json"),
            {"ref": latest, "label": campus_cats.get("label"), "campuses": campus_cats.get("campuses"), "data": cleaned},
        )
        print(f"  campus x categorias: {latest}")

    # ---- cartões-resumo por categoria --------------------------------------
    cards = []
    last_i = n_refs - 1
    for slug in ORDER:
        payload = category_payload[slug]
        labels, rows = payload["labels"], payload["rows"]
        cur = defaultdict(int)
        for r in rows:
            if r[0] == last_i:
                cur[r[1]] += r[2] + r[3] + r[4] + r[5]
        total = sum(cur.values()) or 1
        if not cur:
            cards.append({"slug": slug, "title": TITLES[slug], "nValues": len(labels), "top": None, "spark": [], "total": 0})
            continue
        top_li = max(cur, key=cur.get)
        series = [0] * n_refs
        for r in rows:
            if r[1] == top_li:
                series[r[0]] += r[2] + r[3] + r[4] + r[5]
        prev_i = max(0, n_refs - 13)
        prev = series[prev_i]
        delta = cur[top_li] - prev
        cards.append(
            {
                "slug": slug,
                "title": TITLES[slug],
                "nValues": len(labels),
                "total": int(total),
                "top": {
                    "label": labels[top_li],
                    "value": int(cur[top_li]),
                    "share": round(cur[top_li] / total * 100, 2),
                    "delta": int(delta),
                    "pct": round(delta / prev * 100, 2) if prev else None,
                },
                "spark": [int(v) for v in series[-24:]],
            }
        )

    # ---- movers (maiores variações) ----------------------------------------
    def build_movers(window_refs: int | None, top: int = 14):
        out = []
        for slug, payload in category_payload.items():
            if slug == "categoria":
                continue
            labels = payload["labels"]
            rows = payload["rows"]
            by_label = defaultdict(dict)
            for r in rows:
                by_label[r[1]][r[0]] = r[2] + r[3] + r[4] + r[5]
            last = n_refs - 1
            base = 0 if window_refs is None else max(0, last - window_refs)
            for li, series in by_label.items():
                a = series.get(base, 0)
                b = series.get(last, 0)
                delta = b - a
                if abs(delta) < 3:
                    continue
                out.append(
                    {
                        "slug": slug,
                        "label": labels[li],
                        "from": a,
                        "to": b,
                        "delta": delta,
                        "pct": (delta / a * 100) if a else None,
                    }
                )
        out.sort(key=lambda x: -abs(x["delta"]))
        return out[:top]

    movers = {"last12m": build_movers(12), "all": build_movers(None)}
    if n_refs >= 2:
        # variação do último mês: recalcula com janela de 1
        last_month = []
        for slug, payload in category_payload.items():
            if slug == "categoria":
                continue
            rows = payload["rows"]
            labels = payload["labels"]
            by_label = defaultdict(dict)
            for r in rows:
                by_label[r[1]][r[0]] = r[2] + r[3] + r[4] + r[5]
            for li, series in by_label.items():
                a = series.get(n_refs - 2, 0)
                b = series.get(n_refs - 1, 0)
                if abs(b - a) < 3:
                    continue
                last_month.append(
                    {
                        "slug": slug,
                        "label": labels[li],
                        "from": a,
                        "to": b,
                        "delta": b - a,
                        "pct": ((b - a) / a * 100) if a else None,
                    }
                )
        last_month.sort(key=lambda x: -abs(x["delta"]))
        movers["lastMonth"] = last_month[:14]
    else:
        movers["lastMonth"] = []

    # ---- ranking de mudanças ------------------------------------------------
    windows = [
        ("1m", "Último mês", 1),
        ("12m", "12 meses", 12),
        ("60m", "5 anos", 60),
        ("all", f"Desde {ref_labels[ref_ids[0]]}", None),
    ]
    win_meta = []
    change_rows = []
    slug_order = [s for s in ORDER if s != "categoria"]
    labels_by_slug = {}
    for wi, (key, label, span) in enumerate(windows):
        base = 0 if span is None else max(0, n_refs - 1 - span)
        win_meta.append({"key": key, "label": label, "fromRef": base, "toRef": n_refs - 1})
        for slug in slug_order:
            payload = category_payload[slug]
            labels, rows = payload["labels"], payload["rows"]
            labels_by_slug[slug] = labels
            by_label = defaultdict(lambda: [0] * n_refs)
            for r in rows:
                by_label[r[1]][r[0]] += r[2] + r[3] + r[4] + r[5]
            for li, series in by_label.items():
                a, b = series[base], series[n_refs - 1]
                delta = b - a
                if abs(delta) < 3 and max(a, b) < 5:
                    continue
                k = min(14, n_refs - base)
                if k <= 1:
                    spark = [a, b]
                else:
                    step = (n_refs - 1 - base) / (k - 1)
                    spark = [series[base + round(i * step)] for i in range(k)]
                change_rows.append(
                    [
                        wi,
                        slug_order.index(slug),
                        int(li),
                        int(a),
                        int(b),
                        int(delta),
                        round(delta / a * 100, 2) if a else None,
                        [int(v) for v in spark],
                    ]
                )
    write_json(
        os.path.join(OUT, "changes.json"),
        {"windows": win_meta, "slugs": slug_order, "labels": labels_by_slug, "rows": change_rows},
    )
    print(f"  mudanças: {len(change_rows)} registros em {len(windows)} janelas")

    # ---- vacância de docentes (Anuário) -------------------------------------
    vacancia = build_vacancia()
    tecnicos = build_tecnicos()

    # ---- índice -------------------------------------------------------------
    index = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "https://uspdigital.usp.br/portaltransparencia/",
        "sourceName": "Portal da Transparência da USP",
        "refs": [{"id": r, "label": ref_labels[r]} for r in ref_ids],
        "categories": categories_meta,
        "cards": cards,
        "totals": totals,
        "movers": movers,
        "campus": {
            "available": campus_out is not None,
            "names": {c["code"]: c["name"] for c in (campus_out or {}).get("campuses", [])},
        },
        "vacancia": {
            "available": vacancia is not None,
            "file": "data/vacancia.json",
            "year": vacancia["years"][-1] if vacancia else None,
            "firstYear": vacancia["years"][0] if vacancia else None,
            "units": len(vacancia["units"]) if vacancia else 0,
            "totals": vacancia["totals"][str(vacancia["years"][-1])] if vacancia else None,
        },
        "tecnicos": {
            "available": tecnicos is not None,
            "file": "data/tecnicos.json",
            "year": tecnicos["years"][-1] if tecnicos else None,
            "firstYear": tecnicos["years"][0] if tecnicos else None,
            "units": len(tecnicos["units"]) if tecnicos else 0,
            "totals": tecnicos["totals"][str(tecnicos["years"][-1])] if tecnicos else None,
        },
        "stats": {
            "nRefs": n_refs,
            "first": ref_ids[0],
            "last": ref_ids[-1],
            "totalActive": totals[-1][0] + totals[-1][1],
            "totalAll": sum(totals[-1]),
        },
    }
    changed = write_if_changed(os.path.join(OUT, "index.json"), index)
    print(f"  index.json {'atualizado' if changed else 'sem mudanças'}")

    # ---- diagnóstico de consistência ---------------------------------------
    print("\nConsistência (soma por categoria vs total do mês):")
    last_tot = totals[-1]
    for slug in ORDER:
        if slug in ("categoria", "funcao-estrutura"):
            continue
        payload = category_payload[slug]
        sums = [0, 0, 0, 0]
        for r in payload["rows"]:
            if r[0] == n_refs - 1:
                for k in range(4):
                    sums[k] += r[2 + k]
        flag = "OK" if sums == last_tot else "DIVERGE"
        print(f"  {slug:16} {sums} {flag}")

    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.endswith(".json"))
    print(f"\nTotal JSON: {size/1024/1024:.1f} MB em {OUT}")


if __name__ == "__main__":
    main()
