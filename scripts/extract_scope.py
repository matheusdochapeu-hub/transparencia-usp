#!/usr/bin/env python3
"""
Extração por recorte (campus e unidade) — todas as 11 categorias.

O portal aceita filtro de campus e de unidade em listarInfoServidor. Cada
combinação (recorte, competência, categoria) é uma chamada; aqui elas são
distribuídas em N threads com sessões independentes.

  campus  -> histórico completo (todas as competências)
  unidade -> últimos N meses (padrão 24)

Saída: data/scope/<tipo>-<id>.json  (resumível)

Uso:
  python scripts/extract_scope.py                 # campi completos + unidades 24m
  python scripts/extract_scope.py --type campus
  python scripts/extract_scope.py --type unit --months 12 --workers 4
"""

from __future__ import annotations

import argparse
import json
import os
import threading
import time
from datetime import datetime, timezone

import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import CATEGORIES, Session, call_with_retry  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "scope")
PROCS = {
    "categoria": "SPlistarInfoServidorCategoria",
    "classe": "SPlistarInfoServidorClasse",
    "faixa-etaria": "SPlistarInfoServidorFaixaEtar",
    "formacao": "SPlistarInfoServidorFormacaoAc",
    "funcao": "SPlistarInfoServidorFuncao",
    "funcao-estrutura": "SPlistarInfoServidorEstrut",
    "jornada": "SPlistarInfoServidorJornada",
    "nacionalidade": "SPlistarInfoServidorNacion",
    "raca-cor": "SPlistarInfoServidorRacaCor",
    "sexo": "SPlistarInfoServidorSexo",
    "tempo-usp": "SPlistarInfoServidorTempoUSP",
}

lock = threading.Lock()
done = 0
t0 = time.time()


def log(*a):
    print(*a, flush=True)


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


def scope_path(key: str) -> str:
    return os.path.join(OUT, key + ".json")


def fetch_ref(sess, ref: str, unidade: str, campus: str) -> dict:
    out = {}
    for slug, _, _ in CATEGORIES:
        rows = call_with_retry(sess, "listarInfoServidor", PROCS[slug], ref, unidade, campus)
        clean = []
        for r in rows:
            label = (r.get("descricao") or "").strip()
            if slug == "categoria" or not label:
                label = "Total"
            clean.append(
                [
                    label,
                    int(r.get("doc") or 0),
                    int(r.get("tecAdm") or 0),
                    int(r.get("docApos") or 0),
                    int(r.get("tecAdmApos") or 0),
                ]
            )
        clean.sort(key=lambda x: -(x[1] + x[2] + x[3] + x[4]))
        out[slug] = clean
        time.sleep(0.02)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["campus", "unit", "all"], default="all")
    ap.add_argument("--months", type=int, default=24, help="meses de histórico por unidade")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    refs_meta = read_json(os.path.join(ROOT, "data", "raw", "_refs.json"))
    if not refs_meta:
        raise SystemExit("data/raw/_refs.json ausente — rode extract.py antes")
    all_refs = refs_meta["refs"]

    boot = Session().warm()
    campuses = call_with_retry(boot, "listarCampus")
    units = call_with_retry(boot, "listarUnidade")
    campus_names = {str(c["codcam"]): c["nomcam"] for c in campuses}

    unit_campus = {}
    mapping = read_json(os.path.join(ROOT, "data", "vagas", "unit-campus.json"), {}) or {}
    for sigla, info in (mapping.get("mapping") or {}).items():
        unit_campus[sigla] = info.get("campus", "")

    scopes = []
    if args.type in ("campus", "all"):
        for code, name in campus_names.items():
            scopes.append(
                {
                    "key": f"campus-{code}",
                    "type": "campus",
                    "name": name,
                    "campus": name,
                    "unidade": "",
                    "campusCode": code,
                    "refs": all_refs,
                }
            )
    if args.type in ("unit", "all"):
        recent = all_refs[-args.months :]
        for u in units:
            sigla = str(u.get("sglund") or "").strip()
            if not sigla:
                continue
            scopes.append(
                {
                    "key": f"unit-{sigla}",
                    "type": "unit",
                    "name": str(u.get("nomabvund") or "").strip(),
                    "campus": unit_campus.get(sigla, ""),
                    "unidade": sigla,
                    "campusCode": "",
                    "refs": recent,
                }
            )

    # carrega estado e monta a fila
    state = {}
    jobs = []
    for sc in scopes:
        data = read_json(scope_path(sc["key"])) or {"refs": {}}
        state[sc["key"]] = data
        have = data.get("refs") or {}
        for r in sc["refs"]:
            rid = r["id"]
            if rid not in have:
                jobs.append((sc, rid, r["serverDate"]))
    log(f"{len(scopes)} recortes | {len(jobs)} competências a baixar | workers={args.workers}")

    cursor = {"i": 0}
    cursor_lock = threading.Lock()
    dirty: set[str] = set()

    def next_job():
        with cursor_lock:
            if cursor["i"] >= len(jobs):
                return None
            j = jobs[cursor["i"]]
            cursor["i"] += 1
            return j

    def worker(tid: int):
        global done
        sess = Session().warm()
        while True:
            job = next_job()
            if job is None:
                break
            sc, rid, server_date = job
            try:
                cats = fetch_ref(sess, server_date, sc["unidade"], sc["campusCode"])
            except Exception as exc:  # noqa: BLE001
                log(f"  ! {sc['key']} {rid}: {exc}")
                continue
            with lock:
                data = state[sc["key"]]
                data.setdefault("refs", {})[rid] = cats
                data.update(
                    {
                        "key": sc["key"],
                        "type": sc["type"],
                        "name": sc["name"],
                        "campus": sc["campus"],
                        "unidade": sc["unidade"],
                    }
                )
                dirty.add(sc["key"])
                done += 1
                n = done
                if n % 25 == 0:
                    for k in list(dirty):
                        write_json(scope_path(k), state[k])
                    dirty.clear()
            if n % 100 == 0:
                rate = n / max(1e-6, time.time() - t0)
                eta = (len(jobs) - n) / max(0.1, rate)
                log(f"  {n}/{len(jobs)} ({rate:.1f}/s) ETA {eta/60:.0f} min")

    threads = [threading.Thread(target=worker, args=(i,), daemon=True) for i in range(args.workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # flush final
    for k, v in state.items():
        write_json(scope_path(k), v)
    log(f"concluído em {(time.time()-t0)/60:.1f} min — {done} competências novas")


if __name__ == "__main__":
    main()
