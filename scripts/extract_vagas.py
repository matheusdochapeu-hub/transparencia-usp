#!/usr/bin/env python3
"""
Cargos em vacância de docentes da USP, por unidade.

Fonte: Anuário Estatístico da USP — Tabela 2.08 "Quadro de Docentes efetivos"
(https://uspdigital.usp.br/anuario/), disponível em XLS por ano de referência.

A tabela é long-format: Tipo de Unidade | Unidade | Tipo de Cargo | Situação | Total
  Tipo de Cargo: Cargo Inicial | Cargo Final
  Situação:      Vago | Provido

O mapa unidade -> campus é descoberto consultando o Portal da Transparência
(filtro por unidade e campus) e fica versionado em data/vagas/unit-campus.json.

Uso:
  python scripts/extract_vagas.py            # baixa/atualiza 2014..ano atual
  python scripts/extract_vagas.py --map      # refaz o mapa unidade -> campus
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "vagas")
XLS_URL = "https://uspdigital.usp.br/anuario/br/tabelas/XLS/{year}/T2.08.xls"
XLS_T214 = "https://uspdigital.usp.br/anuario/br/tabelas/XLS/{year}/T2.14.xls"
XLS_T216 = "https://uspdigital.usp.br/anuario/br/tabelas/XLS/{year}/T2.16.xls"
XLS_T220 = "https://uspdigital.usp.br/anuario/br/tabelas/XLS/{year}/T2.20.xls"
CAMPUS_NAMES = {
    "10": "São Paulo",
    "20": "Bauru",
    "30": "Piracicaba",
    "40": "Pirassununga",
    "50": "São Carlos",
    "60": "Ribeirão Preto",
    "70": "Lorena",
}


def xlrd_module():
    try:
        import xlrd  # noqa: PLC0415

        return xlrd
    except ImportError:
        sys.path.insert(0, os.path.join(os.environ.get("TEMP", "/tmp"), "pdflib"))
        import xlrd  # noqa: PLC0415

        return xlrd


def write_json(path: str, obj) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def read_json(path: str, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return default


def fetch_year(year: int):
    xlrd = xlrd_module()
    req = urllib.request.Request(XLS_URL.format(year=year), headers=UA)
    data = urllib.request.urlopen(req, timeout=90).read()
    sh = xlrd.open_workbook(file_contents=data).sheet_by_index(0)

    header_row = None
    for r in range(min(20, sh.nrows)):
        if str(sh.cell_value(r, 0)).strip().lower().startswith("tipo de unidade"):
            header_row = r
            break
    if header_row is None:
        raise RuntimeError(f"cabeçalho não encontrado em {year}")

    rows = []
    for r in range(header_row + 1, sh.nrows):
        tipo = str(sh.cell_value(r, 0)).strip()
        unidade = str(sh.cell_value(r, 1)).strip()
        cargo = str(sh.cell_value(r, 2)).strip()
        sit = str(sh.cell_value(r, 3)).strip()
        total = sh.cell_value(r, 4)
        if not unidade or sit not in ("Vago", "Provido") or cargo not in ("Cargo Inicial", "Cargo Final"):
            continue
        try:
            total = int(round(float(total)))
        except (TypeError, ValueError):
            continue
        rows.append([tipo, unidade, cargo, sit, total])
    return {"year": year, "rows": rows, "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def build_campus_map(force: bool = False):
    """Descobre o campus de cada unidade consultando o portal (cached)."""
    dest = os.path.join(OUT, "unit-campus.json")
    cached = read_json(dest)
    if cached and not force:
        return cached

    sys.path.insert(0, os.path.join(ROOT, "scripts"))
    from extract import Session, call_with_retry  # noqa: PLC0415

    sess = Session().warm()
    refs = call_with_retry(sess, "listarReferencia")
    dated = sorted(
        (r for r in refs if r.get("dtainictc")),
        key=lambda r: (r["dtainictc"][6:], r["dtainictc"][:2]),
    )
    server_date = dated[-1]["dtainictc"].replace("\\/", "/")

    units = call_with_retry(sess, "listarUnidade")
    mapping = {}
    for u in units:
        sigla = str(u.get("sglund") or "").strip()
        if not sigla:
            continue
        nome = str(u.get("nomabvund") or "").strip()
        for code, cname in CAMPUS_NAMES.items():
            out = call_with_retry(sess, "listarInfoServidor", "SPlistarInfoServidorCategoria", server_date, sigla, code)
            total = sum(
                int(r.get("doc") or 0) + int(r.get("tecAdm") or 0) + int(r.get("docApos") or 0) + int(r.get("tecAdmApos") or 0)
                for r in out
            )
            if total > 0:
                mapping[sigla] = {"campus": cname, "code": code, "name": nome}
                break
        print(f"  {sigla:10} -> {mapping.get(sigla, {}).get('campus', '?')}")

    write_json(dest, {"mapping": mapping, "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    return {"mapping": mapping}


def fetch_t214(year: int):
    """Tabela 2.14 — Servidores técnico-administrativos por unidade e categoria.

    Long-format: Tipo de Unidade | Unidade | Categoria | [sexpes] | Total
    (edições antigas não têm a coluna de sexo).
    """
    xlrd = xlrd_module()
    req = urllib.request.Request(XLS_T214.format(year=year), headers=UA)
    data = urllib.request.urlopen(req, timeout=90).read()
    sh = xlrd.open_workbook(file_contents=data).sheet_by_index(0)

    header_row = None
    for r in range(min(20, sh.nrows)):
        if str(sh.cell_value(r, 0)).strip().lower().startswith("tipo de unidade"):
            header_row = r
            break
    if header_row is None:
        raise RuntimeError(f"cabeçalho 2.14 não encontrado em {year}")

    cols = {}
    for c in range(sh.ncols):
        label = str(sh.cell_value(header_row, c)).strip().lower()
        if label in ("tipo de unidade", "unidade", "categoria", "sexpes", "total"):
            cols[label] = c
    if "unidade" not in cols or "categoria" not in cols or "total" not in cols:
        raise RuntimeError(f"colunas inesperadas em 2.14/{year}")

    rows = []
    for r in range(header_row + 1, sh.nrows):
        tipo = str(sh.cell_value(r, cols["tipo de unidade"])).strip() if "tipo de unidade" in cols else ""
        unidade = str(sh.cell_value(r, cols["unidade"])).strip()
        cat = str(sh.cell_value(r, cols["categoria"])).strip()
        try:
            total = int(round(float(sh.cell_value(r, cols["total"]))))
        except (TypeError, ValueError):
            continue
        if not unidade or not cat:
            continue
        sexo = str(sh.cell_value(r, cols["sexpes"])).strip() if "sexpes" in cols else ""
        rows.append([tipo, unidade, cat, total, sexo])
    return {"year": year, "rows": rows, "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def _long_sheet(url: str, year: int):
    """Abre a planilha e devolve (sheet, índice do cabeçalho, mapa de colunas)."""
    xlrd = xlrd_module()
    data = urllib.request.urlopen(urllib.request.Request(url.format(year=year), headers=UA), timeout=90).read()
    sh = xlrd.open_workbook(file_contents=data).sheet_by_index(0)
    header_row = None
    for r in range(min(20, sh.nrows)):
        if str(sh.cell_value(r, 0)).strip().lower().startswith("tipo de unidade"):
            header_row = r
            break
    if header_row is None:
        raise RuntimeError(f"cabeçalho não encontrado em {url.format(year=year)}")
    cols = {}
    for c in range(sh.ncols):
        cols[str(sh.cell_value(header_row, c)).strip().lower()] = c
    return sh, header_row, cols


def fetch_t216(year: int):
    """Sexo dos servidores técnico-administrativos por unidade (T2.16)."""
    sh, header_row, cols = _long_sheet(XLS_T216, year)
    need = ["unidade", "sexo", "categoria", "subcategoria", "total"]
    if any(k not in cols for k in need):
        raise RuntimeError(f"colunas inesperadas em 2.16/{year}")
    rows = []
    for r in range(header_row + 1, sh.nrows):
        if str(sh.cell_value(r, cols["categoria"])).strip() != "Servidor":
            continue
        # edições antigas usam "Não-Docente" em vez de "Tec/Adm"
        if str(sh.cell_value(r, cols["subcategoria"])).strip() not in ("Tec/Adm", "Não-Docente"):
            continue
        unidade = str(sh.cell_value(r, cols["unidade"])).strip()
        sexo = str(sh.cell_value(r, cols["sexo"])).strip()
        try:
            total = int(round(float(sh.cell_value(r, cols["total"]))))
        except (TypeError, ValueError):
            continue
        if not unidade or not sexo:
            continue
        rows.append([unidade, sexo, total])
    return {"year": year, "rows": rows, "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def fetch_t220(year: int):
    """Raça/cor dos servidores técnico-administrativos por unidade e categoria (T2.20)."""
    sh, header_row, cols = _long_sheet(XLS_T220, year)
    need = ["unidade", "categoria", "racacor", "total"]
    if any(k not in cols for k in need):
        raise RuntimeError(f"colunas inesperadas em 2.20/{year}")
    rows = []
    for r in range(header_row + 1, sh.nrows):
        unidade = str(sh.cell_value(r, cols["unidade"])).strip()
        cat = str(sh.cell_value(r, cols["categoria"])).strip()
        raca = str(sh.cell_value(r, cols["racacor"])).strip()
        try:
            total = int(round(float(sh.cell_value(r, cols["total"]))))
        except (TypeError, ValueError):
            continue
        if not unidade or not raca:
            continue
        rows.append([unidade, cat, raca, total])
    return {"year": year, "rows": rows, "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", action="store_true", help="refaz o mapa unidade -> campus")
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    if args.map or not os.path.exists(os.path.join(OUT, "unit-campus.json")):
        print("Mapeando unidades -> campus pelo portal…")
        build_campus_map(force=args.map)

    current = datetime.now().year
    ok = 0
    for year in range(2014, current + 1):
        try:
            payload = fetch_year(year)
        except Exception as exc:  # noqa: BLE001
            print(f"{year}: indisponível ({exc})")
        else:
            path = os.path.join(OUT, f"T2.08-{year}.json")
            prev = read_json(path)
            if prev and prev.get("rows") == payload["rows"]:
                print(f"{year}: sem mudanças ({len(payload['rows'])} linhas)")
            else:
                write_json(path, payload)
                print(f"{year}: {len(payload['rows'])} linhas")
            ok += 1

        # quadro técnico-administrativo por carreira
        try:
            t214 = fetch_t214(year)
        except Exception as exc:  # noqa: BLE001
            print(f"{year}: T2.14 indisponível ({exc})")
        else:
            path = os.path.join(OUT, f"T2.14-{year}.json")
            prev = read_json(path)
            if prev and prev.get("rows") == t214["rows"]:
                pass
            else:
                write_json(path, t214)

        # sexo por unidade (técnicos)
        try:
            t216 = fetch_t216(year)
        except Exception as exc:  # noqa: BLE001
            print(f"{year}: T2.16 indisponível ({exc})")
        else:
            path = os.path.join(OUT, f"T2.16-{year}.json")
            prev = read_json(path)
            if not (prev and prev.get("rows") == t216["rows"]):
                write_json(path, t216)

        # raça/cor por unidade e categoria (a partir de 2020)
        try:
            t220 = fetch_t220(year)
        except Exception:  # noqa: BLE001
            continue
        path = os.path.join(OUT, f"T2.20-{year}.json")
        prev = read_json(path)
        if not (prev and prev.get("rows") == t220["rows"]):
            write_json(path, t220)

    print(f"{ok} anos processados em {OUT}")


if __name__ == "__main__":
    main()
