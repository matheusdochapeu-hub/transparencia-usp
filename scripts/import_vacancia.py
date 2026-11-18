#!/usr/bin/env python3
"""
Importador do extrato de cargos/empregos do DRH (uso pontual, quando houver o arquivo).

Formato esperado (CSV com ';' ou XLSX), uma linha por combinação:
  competencia;unidade;campus;carreira;classe;letra;situacao;quantidade

  competencia  AAAA-MM (ex.: 2026-10)
  unidade      sigla (EACH, FFLCH, HU...) ou nome
  campus       opcional (preenchido pelo mapa unidade->campus quando vazio)
  carreira     Basico | Tecnico | Superior  (aceita acentos e maiúsculas)
  classe       opcional (B1..B5, T1..T5, S1..S5)
  letra        opcional (A..D)
  situacao     provido | vago  (aceita "não provido")
  quantidade   inteiro >= 0

Saída: data/vacancia-servidores.json (consumido pelo build -> docs/data/)

Uso:
  python scripts/import_vacancia.py --input samples/vacancia-servidores-exemplo.csv
  python scripts/import_vacancia.py --input extrato_drh.xlsx --source "DRH - resposta LAI 123/2026"
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "vacancia-servidores.json")
REQUIRED = ["competencia", "unidade", "carreira", "situacao", "quantidade"]
CAREER = {
    "basico": "bas", "básico": "bas", "bas": "bas",
    "tecnico": "tec", "técnico": "tec", "tec": "tec",
    "superior": "sup", "sup": "sup", "analista": "sup",
    "nao enquadrado": "out", "não enquadrado": "out",
}
SIT = {"provido": "provido", "ocupado": "provido", "vago": "vago", "nao provido": "vago", "não provido": "vago"}


def norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip().lower())


def read_rows(path: str):
    ext = os.path.splitext(path)[1].lower()
    if ext in (".xlsx", ".xlsm"):
        from openpyxl import load_workbook  # noqa: PLC0415

        wb = load_workbook(path, data_only=True, read_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        header = [norm(c) for c in rows[0]]
        for r in rows[1:]:
            yield dict(zip(header, r))
        return
    with open(path, encoding="utf-8-sig", newline="") as fh:
        sample = fh.read(4096)
        fh.seek(0)
        delim = ";" if sample.count(";") >= sample.count(",") else ","
        reader = csv.DictReader(fh, delimiter=delim)
        for r in reader:
            yield {norm(k): v for k, v in r.items()}


def load_campus_map():
    path = os.path.join(ROOT, "data", "vagas", "unit-campus.json")
    try:
        with open(path, encoding="utf-8") as fh:
            return {k: v.get("campus", "") for k, v in (json.load(fh).get("mapping") or {}).items()}
    except FileNotFoundError:
        return {}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--source", default="")
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(args.input):
        raise SystemExit(f"arquivo não encontrado: {args.input}")

    campus_map = load_campus_map()
    rows = list(read_rows(args.input))
    if not rows:
        raise SystemExit("arquivo vazio")

    missing = [c for c in REQUIRED if c not in rows[0]]
    if missing:
        raise SystemExit(f"colunas obrigatórias ausentes: {missing}")

    refs = set()
    units = {}
    data = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: {"provido": 0, "vago": 0})))
    detail = []
    errors = []

    for i, r in enumerate(rows, 2):
        ref = str(r.get("competencia") or "").strip()
        if not re.fullmatch(r"\d{4}-\d{2}", ref):
            errors.append(f"linha {i}: competência inválida {ref!r}")
            continue
        unidade = str(r.get("unidade") or "").strip()
        if not unidade:
            errors.append(f"linha {i}: unidade vazia")
            continue
        carreira = CAREER.get(norm(r.get("carreira")))
        situacao = SIT.get(norm(r.get("situacao")))
        try:
            qtd = int(float(str(r.get("quantidade") or 0).replace(".", "").replace(",", ".")))
        except ValueError:
            errors.append(f"linha {i}: quantidade inválida")
            continue
        if not carreira:
            errors.append(f"linha {i}: carreira desconhecida {r.get('carreira')!r}")
            continue
        if not situacao:
            errors.append(f"linha {i}: situação desconhecida {r.get('situacao')!r}")
            continue
        campus = str(r.get("campus") or "").strip() or campus_map.get(unidade, "")
        refs.add(ref)
        units.setdefault(unidade, {"sigla": unidade, "name": "", "campus": campus})
        if campus and not units[unidade]["campus"]:
            units[unidade]["campus"] = campus
        data[ref][unidade][carreira][situacao] += qtd
        detail.append(
            {
                "competencia": ref,
                "unidade": unidade,
                "classe": str(r.get("classe") or ""),
                "letra": str(r.get("letra") or ""),
                "carreira": carreira,
                "situacao": situacao,
                "quantidade": qtd,
            }
        )

    refs = sorted(refs)
    totals = {}
    for ref in refs:
        t = {"provido": 0, "vago": 0}
        for u in data[ref].values():
            for v in u.values():
                t["provido"] += v["provido"]
                t["vago"] += v["vago"]
        totals[ref] = t

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": args.source or os.path.basename(args.input),
        "refs": refs,
        "units": sorted(units.values(), key=lambda u: u["sigla"]),
        "data": {ref: {u: {c: dict(v) for c, v in cc.items()} for u, cc in uu.items()} for ref, uu in data.items()},
        "totals": totals,
        "rows": detail,
    }

    if errors:
        print(f"{len(errors)} problemas encontrados:")
        for e in errors[:12]:
            print("  -", e)
    last = refs[-1] if refs else "—"
    t = totals.get(last, {"provido": 0, "vago": 0})
    print(f"{len(rows)} linhas | {len(refs)} competências ({refs[0] if refs else '—'}..{last}) | {len(units)} unidades")
    print(f"última competência: providos {t['provido']}, vagos {t['vago']}, ocupação {t['provido']/((t['provido']+t['vago']) or 1)*100:.1f}%")

    if args.dry_run:
        print("dry-run: nada gravado")
        return
    if errors and len(errors) >= len(rows):
        raise SystemExit("arquivo inválido: nada gravado")

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    print("gravado em", args.out)
    print("rode 'python scripts/build.py' para publicar no painel")


if __name__ == "__main__":
    main()
